import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// task-6 — the M1 boundary, attacked rather than described.
//
// Every case here is an attempt to reach somewhere the proxy should not go,
// written from the attacker's side: a tenant who holds a valid proxy key, which
// in a hosted deployment every tenant does. A test that only asserts a refusal
// status can pass while the socket was opened anyway, so where it matters these
// count connections to a listener that must never be dialled.

process.env.TEAMCLAUDE_CONFIG = join(mkdtempSync(join(tmpdir(), 'tc-review-')), 'config.json');

const { createProxyServer } = await import('../src/server.js');
const { createDestinationPolicy } = await import('../src/destination-policy.js');
const { AccountManager } = await import('../src/account-manager.js');

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const am = () => new AccountManager([{ name: 'k', type: 'apikey', apiKey: 'sk' }], 0.98);

/** Hosted: bound off-loopback in configuration, listening on loopback to test. */
const hosted = (connect = {}) => createProxyServer(am(), {
  upstream: 'https://api.anthropic.com',
  proxy: { host: '0.0.0.0', apiKey: 'k', connect: { allowLoopbackClients: true, ...connect } },
}, {});

function connectLine(port, target) {
  return new Promise((resolve, reject) => {
    const raw = net.connect(port, '127.0.0.1');
    raw.once('error', reject);
    raw.once('connect', () => raw.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    raw.once('data', (d) => { raw.destroy(); resolve(d.toString().split('\r\n')[0]); });
  });
}

function forward(port, absoluteUrl) {
  return new Promise((resolve) => {
    const r = http.request({ port, host: '127.0.0.1', method: 'GET', path: absoluteUrl,
      headers: { 'x-api-key': 'k' } },
    (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', () => resolve({ status: 0, body: '' }));
    r.end();
  });
}

// ── 1. SSRF by literal address ──────────────────────────────────────────────

test('review — a literal private address is refused on both egress paths, and never dialled', async () => {
  let dialled = 0;
  const secret = net.createServer((s) => { dialled++; s.destroy(); });
  const secretPort = await listen(secret);
  const proxy = hosted();
  const port = await listen(proxy);
  try {
    assert.match(await connectLine(port, `127.0.0.1:${secretPort}`), / 403 /);
    const f = await forward(port, `http://127.0.0.1:${secretPort}/`);
    assert.equal(f.status, 400);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(dialled, 0, 'a socket was opened to a destination that was then refused');
  } finally { proxy.close(); secret.close(); }
});

test('review — the IPv4-mapped IPv6 spelling of a private address is refused too', async () => {
  const proxy = hosted();
  const port = await listen(proxy);
  try {
    // A check that reads the text rather than the bytes lets these through.
    for (const t of ['[::ffff:127.0.0.1]:443', '[::ffff:169.254.169.254]:443', '[::1]:443']) {
      assert.match(await connectLine(port, t), / 403 /, `${t} was not refused`);
    }
  } finally { proxy.close(); }
});

// ── 2. SSRF by name ─────────────────────────────────────────────────────────

test('review — an allowlisted name that resolves inside is refused, not tunnelled', async () => {
  const p = createDestinationPolicy(
    { upstream: 'https://api.anthropic.com', proxy: { host: '0.0.0.0', apiKey: 'k', connect: { allow: ['metadata.example'] } } },
    { lookup: async () => [{ address: '169.254.169.254', family: 4 }] });
  const v = await p.classify('metadata.example', 443);
  assert.equal(v.action, 'refuse');
  assert.equal(v.reason, 'address_blocked');
});

test('review — a split answer cannot be steered by ordering', async () => {
  // If the public address were chosen from a mixed answer, an attacker who
  // controls the zone decides the verdict by which record comes back first.
  for (const answer of [
    ['93.184.216.34', '169.254.169.254'],
    ['169.254.169.254', '93.184.216.34'],
  ]) {
    const p = createDestinationPolicy(
      { upstream: 'https://api.anthropic.com', proxy: { host: '0.0.0.0', apiKey: 'k', connect: { allow: ['split.example'] } } },
      { lookup: async () => answer.map((address) => ({ address, family: 4 })) });
    assert.equal((await p.classify('split.example', 443)).reason, 'address_blocked',
      `order ${answer.join(',')} decided the verdict`);
  }
});

// ── 3. Rebinding: the answer changes between the check and the connect ──────

test('review — a name that answers differently on a second lookup cannot move the socket', async () => {
  let calls = 0;
  const p = createDestinationPolicy(
    { upstream: 'https://api.anthropic.com', proxy: { host: '0.0.0.0', apiKey: 'k', connect: { allow: ['rebind.example'] } } },
    { lookup: async () => {
      calls++;
      return calls === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }];
    } });
  const v = await p.classify('rebind.example', 443);
  assert.equal(v.action, 'tunnel');
  assert.deepEqual(v.addresses.map((a) => a.address), ['93.184.216.34'],
    'the verdict must carry what was checked, or the caller resolves again');
  assert.equal(calls, 1, 'the policy resolved more than once by itself');

  // and the lookup it hands the caller answers with that, whatever DNS says now
  const { pinnedLookup } = await import('../src/destination-policy.js');
  const pinned = pinnedLookup(v.addresses);
  const all = await new Promise((r) => pinned('rebind.example', { all: true }, (_e, a) => r(a)));
  assert.deepEqual(all.map((a) => a.address), ['93.184.216.34']);
});

// ── 4. Redirect ─────────────────────────────────────────────────────────────

test('review — a redirect toward a private address is not followed by the proxy', async () => {
  // The forward path could be turned into an SSRF primitive if it chased the
  // Location header itself: the check would have been done on the first host.
  let dialled = 0;
  const secret = net.createServer((s) => { dialled++; s.destroy(); });
  const secretPort = await listen(secret);
  const redirector = http.createServer((_q, r) => {
    r.writeHead(302, { location: `http://127.0.0.1:${secretPort}/` });
    r.end();
  });
  const redirectorPort = await listen(redirector);

  // Loopback proxy, so reaching the redirector is allowed and the question is
  // only what happens with the Location it returns.
  const proxy = createProxyServer(am(), {
    upstream: 'https://api.anthropic.com', proxy: { host: '127.0.0.1', apiKey: 'k' },
  }, {});
  const port = await listen(proxy);
  try {
    const r = await forward(port, `http://127.0.0.1:${redirectorPort}/`);
    assert.equal(r.status, 302, 'the proxy resolved the redirect instead of handing it back');
    await new Promise((x) => setTimeout(x, 120));
    assert.equal(dialled, 0,
      'the proxy followed a redirect, so the destination check was done on the wrong host');
  } finally { proxy.close(); redirector.close(); secret.close(); }
});

// ── 5. Nothing open by omission ─────────────────────────────────────────────

test('review — no configuration reachable by omission leaves the listener open off-box', () => {
  // Omission is the realistic path to an unsafe deployment: an operator who
  // sets proxy.host and stops reading.
  assert.throws(() => createProxyServer(am(), { proxy: { host: '0.0.0.0' } }, {}), /proxy\.apiKey/);
});

test('review — every switch defaults closed when the listener is not loopback', async () => {
  const { connectPolicyDefaults } = await import('../src/destination-policy.js');
  const off = connectPolicyDefaults({ proxy: { host: '0.0.0.0', apiKey: 'k' } });
  assert.equal(off.tunnelUnlisted, false, 'unlisted hosts tunnel off-box');
  assert.equal(off.allowPrivateAddresses, false, 'private addresses are reachable off-box');
  assert.equal(off.allowLoopbackClients, false, 'a sidecar on the same loopback is unauthenticated');
  assert.equal(off.restrictPorts, true, 'any port is reachable off-box');
  assert.equal(off.testHost, false, 'a shared node answers for a domain it does not own');

  const on = connectPolicyDefaults({ proxy: { host: '127.0.0.1' } });
  assert.deepEqual(
    [on.tunnelUnlisted, on.allowPrivateAddresses, on.allowLoopbackClients, on.restrictPorts, on.testHost],
    [true, true, true, false, true],
    'the local proxy stopped behaving as it always has');
});

// ── 6. Refusals must not describe the operator's network ────────────────────

test('review — a refusal tells the user their destination was refused, not what is inside', async () => {
  const p = createDestinationPolicy(
    { upstream: 'https://api.anthropic.com', proxy: { host: '0.0.0.0', apiKey: 'k', connect: { allow: ['inside.example'] } } },
    { lookup: async () => [{ address: '10.11.12.13', family: 4 }] });
  const v = await p.classify('inside.example', 443);
  assert.equal(v.reason, 'address_blocked');
  // The range is named, which is a policy statement. The address it actually
  // resolved to is not, because that is a fact about the operator's network
  // that the client did not already have.
  assert.doesNotMatch(v.detail, /10\.11\.12\.13/,
    'the refusal handed back a live internal address, turning a refusal into a scan');
  assert.match(v.detail, /inside\.example/, 'the user cannot tell which destination was refused');
});

test('review — a CONNECT refusal is a status line and carries no detail at all', async () => {
  const proxy = hosted();
  const port = await listen(proxy);
  try {
    const line = await connectLine(port, 'evil.example:443');
    assert.equal(line, 'HTTP/1.1 403 Forbidden',
      `a CONNECT refusal said more than the status: ${line}`);
  } finally { proxy.close(); }
});

// ── 7. Findings ─────────────────────────────────────────────────────────────
//
// F-1 (high) — the `upgrade` listener consulted no authorisation at all. The
// request path checks `x-api-key` and the CONNECT path checks
// `Proxy-Authorization`; `server.on('upgrade', …)` checked neither, so an
// unauthenticated off-box client could open a relay through a hosted proxy.
// Reproduced by sending a bare WebSocket handshake with no key and watching the
// proxy dial upstream on its behalf:
//
//   [TeamClaude] Remote Control WebSocket relay error: getaddrinfo ENOTFOUND …
//
// No account token is injected on that path, so this is not credential theft —
// it is the fail-closed requirement (NFR-20) not covering one of three egress
// paths.
//
// F-2 (low) — `relayUpgrade` builds its target as `${upstream}${req.url}`. A
// client sending an absolute-form request line produced the hostname
// `api.anthropic.comhttp`, which failed to resolve rather than reaching
// anywhere. Harmless as observed, and only because DNS said no.

test('F-1 — an unauthenticated upgrade is refused on a hosted listener', async () => {
  const proxy = hosted({ allowLoopbackClients: false });
  const port = await listen(proxy);
  try {
    const line = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      let buf = '';
      s.on('connect', () => s.write(
        'GET /api/ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
      s.on('data', (d) => { buf += d; });
      const done = () => { s.destroy(); resolve(buf.split('\r\n')[0] || '(nothing)'); };
      s.on('close', done); s.on('error', done);
      setTimeout(done, 2000);
    });
    assert.match(line, / 401 /,
      `an unauthenticated client reached the upgrade relay: ${line}`);
  } finally { proxy.close(); }
});

test('F-2 — an absolute-form upgrade request is rejected, not concatenated', async () => {
  const { relayUpgrade } = await import('../src/server.js');
  const writes = [];
  const socket = {
    write: (s) => writes.push(String(s)), destroy: () => {}, on: () => {}, once: () => {},
    pipe: () => {}, remoteAddress: '10.0.0.9',
  };
  relayUpgrade({ url: 'http://169.254.169.254/latest/meta-data/', headers: {}, method: 'GET' },
    socket, null, 'https://api.anthropic.com', null);
  assert.match(writes.join(''), /400/,
    'an absolute-form request line was appended to the upstream URL instead of refused');
});

// ── task-6, second pass: the certificate surface added after the first ──────
//
// The first review predates the CA work. Since then a private key was put on
// disk that used to be discarded, an endpoint was added that hands out a trust
// anchor, cross-signing was introduced, and the authorisation gate was rewritten
// to be shared. None of that had been attacked.

test('review — the CA endpoint serves the certificate and never the key', async () => {
  const proxy = hosted();
  const port = await listen(proxy);
  try {
    const body = await new Promise((resolve) => {
      const r = http.request({ port, host: '127.0.0.1', path: '/teamclaude/ca',
        headers: { 'x-api-key': 'k' } },
      (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b)); });
      r.end();
    });
    assert.match(body, /BEGIN CERTIFICATE/);
    assert.doesNotMatch(body, /PRIVATE KEY/,
      'the endpoint handed out a private key, which would let anyone impersonate the proxy');
    assert.equal((body.match(/BEGIN CERTIFICATE/g) || []).length, 1,
      'more than the anchor was served');
  } finally { proxy.close(); }
});

test('review — the CA private key is on disk owner-only, and no path serves it', async (t) => {
  const { statSync, existsSync } = await import('node:fs');
  const { caCertPath } = await import('../src/mitm.js');
  const proxy = hosted();
  const port = await listen(proxy);
  try {
    await new Promise((resolve) => {
      const r = http.request({ port, host: '127.0.0.1', path: '/teamclaude/ca',
        headers: { 'x-api-key': 'k' } }, (res) => { res.resume(); res.on('end', resolve); });
      r.end();
    });
    const keyPath = caCertPath().replace(/-ca\.pem$/, '-ca.key');
    assert.ok(existsSync(keyPath), 'the CA key is not being kept, so nothing below is being checked');
    if (process.platform !== 'win32') {
      assert.equal(statSync(keyPath).mode & 0o777, 0o600, 'the CA key is readable by others');
    } else { t.diagnostic('POSIX modes are not meaningful here'); }

    // Nothing under /teamclaude/ reaches it, whatever the path looks like.
    for (const p of ['/teamclaude/ca.key', '/teamclaude/ca/../ca.key', '/teamclaude/ca%2F..%2Fca.key']) {
      const code = await new Promise((resolve) => {
        const r = http.request({ port, host: '127.0.0.1', path: p, headers: { 'x-api-key': 'k' } },
          (res) => { res.resume(); resolve(res.statusCode); });
        r.on('error', () => resolve(0));
        r.end();
      });
      assert.notEqual(code, 200, `${p} answered 200`);
    }
  } finally { proxy.close(); }
});

test('review — the fingerprint header describes the body it came with', async () => {
  // A pin is only worth anything if the header cannot disagree with the bytes.
  const { createHash } = await import('node:crypto');
  const proxy = hosted();
  const port = await listen(proxy);
  try {
    const { header, body } = await new Promise((resolve) => {
      const r = http.request({ port, host: '127.0.0.1', path: '/teamclaude/ca',
        headers: { 'x-api-key': 'k' } }, (res) => {
        let b = ''; res.on('data', (d) => { b += d; });
        res.on('end', () => resolve({ header: res.headers['x-teamclaude-ca-sha256'], body: b }));
      });
      r.end();
    });
    assert.equal(header, createHash('sha256').update(body).digest('hex'));
  } finally { proxy.close(); }
});

test('review — fetching the CA does not follow a redirect', async () => {
  // A proxy that could redirect the fetch could point a machine at somebody
  // else's trust anchor, which is the whole game.
  const { fetchCA } = await import('../src/enrol.js');
  const request = (_o, cb) => {
    const res = { statusCode: 302, headers: { location: 'https://evil.example/ca' },
      on: (e, f) => { if (e === 'end') f(); } };
    queueMicrotask(() => cb(res));
    return { on: () => {}, end: () => {} };
  };
  await assert.rejects(() => fetchCA('https://k@proxy.example:8443', { request }), /answered 302/);
});

test('review — a client cannot choose what the successor CA contains', async () => {
  // succeedCA takes only the outgoing CA. If it accepted a public key or a name
  // from anywhere else, a client could have itself cross-signed.
  // (Function.length would not say this: a parameter with a default is not
  // counted, so an arity check reports 1 whatever the signature is.)
  const { succeedCA, createCA, loadCA } = await import('../src/x509.js');
  const { X509Certificate } = await import('node:crypto');
  const v1 = createCA('v1', 3650);
  const prev = loadCA(v1.certPem, v1.keyPem);

  const a = succeedCA(prev);
  const b = succeedCA(prev);
  assert.notEqual(a.caKeyPem, b.caKeyPem, 'the successor key is not freshly generated each time');

  const cross = new X509Certificate(a.crossCertPem);
  assert.ok(cross.verify(new X509Certificate(v1.certPem).publicKey),
    'the successor is not signed by the CA it replaces');
  assert.notEqual(cross.subject, new X509Certificate(v1.certPem).subject,
    'successor and predecessor share a name, so a verifier cannot tell them apart');
  // The public key in the cross-certificate is the one succeedCA just made, not
  // anything a caller could have supplied.
  assert.ok(cross.publicKey.export({ type: 'spki', format: 'der' })
    .equals(new X509Certificate(a.caCertPem).publicKey.export({ type: 'spki', format: 'der' })),
  'the cross-certificate binds a key other than the successor it returned');
});
