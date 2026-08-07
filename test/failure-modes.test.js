import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// #20 — every proxy-originated failure reported as `proxy_error` with one of two
// messages is a generic proxy error, which is the thing FR-17.1 forbids. Four
// distinct situations shared it: the upstream being unreachable, a fault inside
// the proxy, an upstream error passed along, and the credential being refused.
//
// The message carries the whole story, and that is measured rather than
// stylistic: the client prints `message` verbatim and shows no sign of
// `error.type` (ASM-29). The discriminator is for the operator and the logs.

process.env.TEAMCLAUDE_CONFIG = join(mkdtempSync(join(tmpdir(), 'tc-fail-')), 'config.json');

const { newCorrelationId, CORRELATION_ID_RE } = await import('../src/request-id.js');
const { createProxyServer, describeFailure, FAILURE_CLASSES } = await import('../src/server.js');
const { AccountManager } = await import('../src/account-manager.js');

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

// ── the identifier ──────────────────────────────────────────────────────────

test('a correlation id is 8 hex characters and does not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const id = newCorrelationId();
    assert.match(id, CORRELATION_ID_RE, `${id} is not the documented shape`);
    seen.add(id);
  }
  // 5000 draws from 32 bits: a handful of collisions is expected, a pattern is not.
  assert.ok(seen.size > 4990, `only ${seen.size} distinct ids in 5000 draws`);
});

// ── FR-17.1 — each class is distinguishable ─────────────────────────────────

test('FR-17.1 — every failure class has its own type, and none is the old generic one', () => {
  const types = Object.values(FAILURE_CLASSES).map((c) => c.type);
  assert.equal(new Set(types).size, types.length, `two classes share a type: ${types}`);
  assert.ok(!types.includes('proxy_error'),
    'proxy_error is the generic class FR-17.1 exists to remove');
  for (const name of ['upstream_unreachable', 'proxy_internal_error']) {
    assert.ok(types.includes(name), `the contract names ${name} and nothing emits it`);
  }
});

test('FR-17.2 — an actionable failure names the concrete step', () => {
  for (const [key, cls] of Object.entries(FAILURE_CLASSES)) {
    if (!cls.actionable) continue;
    const body = describeFailure(key, { account: 'work@example.com', host: 'evil.example', detail: 'x' });
    assert.match(body.error.message, /\bteamclaude \w|\bCheck\b|\bSet\b|\bAdd\b|\bRemove\b/,
      `${key} describes a state without naming what to do: ${body.error.message}`);
    assert.doesNotMatch(body.error.message, /Reference: [0-9a-f]{8}/,
      `${key} is actionable, so FR-17.2 applies — sending the user to the operator is the wrong answer`);
  }
});

test('FR-17.3 — a non-actionable failure says so and carries an id', () => {
  for (const [key, cls] of Object.entries(FAILURE_CLASSES)) {
    if (cls.actionable) continue;
    const id = newCorrelationId();
    const body = describeFailure(key, { correlationId: id, detail: 'connect ECONNREFUSED' });
    assert.match(body.error.message, new RegExp(`Reference: ${id}`),
      `${key} gives the operator nothing to correlate: ${body.error.message}`);
    assert.match(body.error.message, /retry|try again|shortly/i,
      `${key} tells the user nothing about what happens next: ${body.error.message}`);
  }
});

test('FR-17.1 — the envelope shape clients parse is unchanged', () => {
  const body = describeFailure('upstream_unreachable', { correlationId: newCorrelationId() });
  assert.equal(body.type, 'error');
  assert.deepEqual(Object.keys(body.error).sort(), ['message', 'type'],
    'the id must be appended to message, never added as a field');
});

test('the message carries the whole story, because error.type does not reach the user', () => {
  // Measured (ASM-29): the client prints `message` verbatim and shows no sign of
  // the type. A message that needs the type to be understood reaches nobody.
  for (const [key, cls] of Object.entries(FAILURE_CLASSES)) {
    const body = describeFailure(key, {
      account: 'work@example.com', host: 'evil.example', detail: 'the underlying detail',
      correlationId: newCorrelationId(),
    });
    const m = body.error.message;
    assert.ok(m.length > 30, `${key}: "${m}" is too terse to stand alone`);
    assert.ok(/[.!]$/.test(m.trim()), `${key}: "${m}" is not a sentence`);
    assert.ok(!m.includes(cls.type), `${key}: the message leans on the type instead of saying it`);
  }
});

// ── through a running proxy ─────────────────────────────────────────────────

const am = () => new AccountManager([{ name: 'k', type: 'apikey', apiKey: 'sk' }], 0.98);

function ask(port, path = '/v1/messages', method = 'POST') {
  return new Promise((resolve) => {
    const r = http.request({ port, host: '127.0.0.1', method, path,
      headers: { 'content-type': 'application/json', 'x-api-key': 'k' } },
    (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', () => resolve({ status: 0, body: '' }));
    r.end(JSON.stringify({ model: 'claude-haiku-4-5-20251001', messages: [] }));
  });
}

test('FR-17.3 — the id in the response is the id in the log', async () => {
  // The forward-proxy path with nothing listening: a deterministic
  // upstream-unreachable that does not go through account rotation or retries.
  const logged = [];
  const realError = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  const proxy = createProxyServer(am(), { upstream: 'https://api.anthropic.com', proxy: { apiKey: 'k' } }, {});
  const port = await listen(proxy);
  try {
    const res = await new Promise((resolve) => {
      const r = http.request({ port, host: '127.0.0.1', method: 'GET',
        path: 'http://127.0.0.1:1/', headers: { 'x-api-key': 'k' } },
      (rr) => { let b = ''; rr.on('data', (d) => { b += d; }); rr.on('end', () => resolve({ status: rr.statusCode, body: b })); });
      r.on('error', () => resolve({ status: 0, body: '' }));
      r.end();
    });
    console.error = realError;
    assert.equal(res.status, 502);
    const body = JSON.parse(res.body);
    assert.equal(body.error.type, 'upstream_unreachable',
      `still the generic class: ${body.error.type}`);
    const id = (body.error.message.match(/Reference: ([0-9a-f]{8})/) || [])[1];
    assert.ok(id, `no correlation id in: ${body.error.message}`);
    assert.ok(logged.some((l) => l.includes(id)),
      `the id ${id} reached the user and not the log, so nobody can correlate it:\n  ` +
      logged.slice(-4).join('\n  '));
  } finally {
    console.error = realError;
    proxy.close();
  }
});

test('an unknown account pin still answers what it always did', async () => {
  // Existing behaviour the 403, 429 and pin suites depend on.
  const proxy = createProxyServer(am(), { upstream: 'http://127.0.0.1:1', proxy: { apiKey: 'k' } }, {});
  const port = await listen(proxy);
  try {
    const res = await ask(port, '/tc-acct/nobody/v1/messages');
    assert.equal(res.status, 404);
    assert.equal(JSON.parse(res.body).error.type, 'not_found_error');
  } finally { proxy.close(); }
});

test('a blocked model is still a 400 the user can act on', async () => {
  const proxy = createProxyServer(am(), {
    upstream: 'http://127.0.0.1:1', proxy: { apiKey: 'k' }, blockedModels: ['*haiku*'],
  }, {});
  const port = await listen(proxy);
  try {
    const res = await ask(port);
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error.type, 'invalid_request_error');
    assert.doesNotMatch(body.error.message, /Reference: [0-9a-f]{8}/,
      'a failure the user can act on should not send them to the operator');
  } finally { proxy.close(); }
});
