import { test } from 'node:test';
import assert from 'node:assert/strict';

// #8 — with a valid proxy key, which in a hosted deployment every tenant has, a
// client could reach any host on any port the proxy host can reach. Cloud
// instance metadata at 169.254.169.254, anything on the operator's private
// network, services bound to the proxy's own loopback precisely because they
// are loopback-only, and any port at all: :22, :6379, :5432.
//
// Not "open to the internet" — the key gate stands in front. The accurate
// statement is that any authenticated tenant could use the operator's network
// position as their own, with the operator's address as the source.
//
// The check has to be at the resolved address, and the connection has to be
// made to the address that was checked. `net.connect(port, host)` resolves the
// name itself, so resolve-check-then-connect-by-name resolves twice, and the
// answer may differ between the two.

const {
  createDestinationPolicy, blockedAddressReason, parseIp, BLOCKED_RANGES,
} = await import('../src/destination-policy.js');

const UP = 'https://api.anthropic.com';
// Keys are lowercased because the policy lowercases the name before resolving,
// which is what a resolver would see.
const lookupOf = (map) => {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return async (host) => {
    if (!(host in lower)) { const e = new Error(`ENOTFOUND ${host}`); e.code = 'ENOTFOUND'; throw e; }
    return lower[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
};

// Hosted by default: that is the deployment these requirements exist for, and
// on loopback most of them deliberately do not apply. The loopback cases say so
// explicitly.
const policy = (cfg = {}, map = {}) => createDestinationPolicy(
  { upstream: UP, ...cfg, proxy: { host: '0.0.0.0', apiKey: 'k', ...(cfg.proxy || {}) } },
  { lookup: lookupOf(map) });

// ── NFR-21.6 — the blocked set is enumerated, not sampled ───────────────────

test('every range the spec names is blocked, in v4 and IPv4-mapped v6 form', () => {
  const named = [
    ['0.0.0.0', 'this network'], ['10.0.0.0', 'private'], ['100.64.0.0', 'CGNAT'],
    ['127.0.0.1', 'loopback'], ['169.254.169.254', 'link-local'],
    ['172.16.0.0', 'private'], ['192.168.0.0', 'private'],
  ];
  for (const [ip, why] of named) {
    assert.ok(blockedAddressReason(ip), `${ip} (${why}) is not blocked`);
    assert.ok(blockedAddressReason(`::ffff:${ip}`), `::ffff:${ip} (${why}) is not blocked`);
  }
  for (const ip of ['::1', 'fc00::1', 'fd00::1', 'fe80::1', '::']) {
    assert.ok(blockedAddressReason(ip), `${ip} is not blocked`);
  }
});

// A range test that only ever tries one member per class passes while the
// boundaries are wrong, which is where an off-by-one in a mask actually lives.
test('NFR-26 — the edges of every range, on both sides', () => {
  const inside = [
    '127.0.0.0', '127.255.255.255',           // 127/8
    '10.0.0.0', '10.255.255.255',             // 10/8
    '172.16.0.0', '172.31.255.255',           // 172.16/12
    '192.168.0.0', '192.168.255.255',         // 192.168/16
    '169.254.0.0', '169.254.255.255',         // 169.254/16
    '100.64.0.0', '100.127.255.255',          // 100.64/10
    '0.0.0.0', '0.255.255.255',               // 0/8
  ];
  const outside = [
    '126.255.255.255', '128.0.0.0',
    '9.255.255.255', '11.0.0.0',
    '172.15.255.255', '172.32.0.0',           // the limits the spec called out
    '192.167.255.255', '192.169.0.0',
    '169.253.255.255', '169.255.0.0',
    '100.63.255.255', '100.128.0.0',
    '1.0.0.0', '8.8.8.8', '160.79.104.10',
  ];
  for (const ip of inside) assert.ok(blockedAddressReason(ip), `${ip} should be blocked`);
  for (const ip of outside) assert.equal(blockedAddressReason(ip), null, `${ip} should be allowed`);
});

// One member per class is what the CIDR test above warns against, and this file
// did exactly that for address *spellings*: three `::ffff:` forms and nothing
// else. An independent review found `::169.254.169.254` — the deprecated
// IPv4-compatible form, same bytes, no `ffff` marker — walking straight through.
// A table of the RFC 4291 forms rather than a handful of examples.
test('NFR-21.6 — every IPv6 spelling of a blocked v4 address is blocked', () => {
  for (const v4 of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '192.168.1.1', '172.16.0.1']) {
    for (const form of [`::ffff:${v4}`, `::${v4}`]) {
      assert.ok(blockedAddressReason(form), `${form} is ${v4} and was allowed`);
    }
  }
  // and the two that are addresses in their own right
  for (const a of ['::', '::1']) assert.ok(blockedAddressReason(a), `${a} was allowed`);
});

test('NFR-21.6 — a public address is not blocked by any of those spellings', () => {
  // The widening must not swallow everything: ::ffff:93.184.216.34 is a real
  // public address wearing the same hat, and has to stay reachable.
  assert.equal(blockedAddressReason('::ffff:93.184.216.34'), null);
  assert.equal(blockedAddressReason('2001:db8::1'), null);
});

test('every blocked range records why it is there', () => {
  assert.ok(BLOCKED_RANGES.length > 10, 'that is a sample, not a set');
  for (const r of BLOCKED_RANGES) {
    assert.ok(r.why && r.why.length > 4, `${r.cidr} has no reason recorded`);
  }
});

test('parseIp handles the forms a resolver actually returns', () => {
  assert.deepEqual([...parseIp('1.2.3.4')], [1, 2, 3, 4]);
  assert.equal(parseIp('::1').length, 16);
  assert.equal(parseIp('2001:db8::1').length, 16);
  assert.deepEqual([...parseIp('::ffff:127.0.0.1')].slice(12), [127, 0, 0, 1]);
  assert.deepEqual([...parseIp('::ffff:7f00:1')].slice(12), [127, 0, 0, 1]);
  for (const bad of ['', 'nonsense', '1.2.3', '1.2.3.256', ':::', '1.2.3.4.5']) {
    assert.equal(parseIp(bad), null, `${JSON.stringify(bad)} parsed as an address`);
  }
});

// ── FR-07.1, FR-07.2, FR-07.3 — classify, defaulting to refuse ──────────────

test('FR-07.2 — the upstream host is intercepted, and carries no address', async () => {
  const r = await policy().classify('api.anthropic.com', 443);
  assert.equal(r.action, 'intercept');
  assert.equal(r.address, undefined, 'intercept dials upstream itself; an address here would be ignored');
});

test('FR-07.1 — an unlisted host is refused, not tunnelled', async () => {
  const r = await policy({}, { 'evil.example': ['93.184.216.34'] }).classify('evil.example', 443);
  assert.equal(r.action, 'refuse');
  assert.equal(r.reason, 'not_allowed');
  assert.match(r.detail, /evil\.example/);
});

test('FR-07.3 — an allowlisted host is tunnelled, and the verdict carries the address', async () => {
  const p = policy({ proxy: { connect: { allow: ['downloads.claude.ai'] } } },
    { 'downloads.claude.ai': ['93.184.216.34'] });
  const r = await p.classify('downloads.claude.ai', 443);
  assert.equal(r.action, 'tunnel');
  assert.equal(r.address, '93.184.216.34', 'the caller would have to resolve again');
  assert.equal(r.family, 4);
});

test('FR-07.3 — entries are exact hostnames; no wildcard form is honoured', async () => {
  const p = policy({ proxy: { connect: { allow: ['*.claude.ai', 'downloads.claude.ai'] } } },
    { 'anything.claude.ai': ['93.184.216.34'], 'downloads.claude.ai': ['93.184.216.34'] });
  assert.equal((await p.classify('anything.claude.ai', 443)).action, 'refuse',
    'a wildcard admitted a host nobody listed');
  assert.equal((await p.classify('downloads.claude.ai', 443)).action, 'tunnel');
});

test('the allowlist is matched case-insensitively, as DNS names are', async () => {
  const p = policy({ proxy: { connect: { allow: ['downloads.claude.ai'] } } },
    { 'DOWNLOADS.Claude.AI': ['93.184.216.34'] });
  assert.equal((await p.classify('DOWNLOADS.Claude.AI', 443)).action, 'tunnel');
});

// ── NFR-21.1, NFR-21.5 — the address decides, not the name ──────────────────

test('NFR-21.1 — an allowlisted name resolving somewhere private is still refused', async () => {
  for (const addr of ['127.0.0.1', '169.254.169.254', '10.1.2.3', '192.168.1.1', '::1']) {
    const p = policy({ proxy: { connect: { allow: ['inside.example'] } } },
      { 'inside.example': [addr] });
    const r = await p.classify('inside.example', 443);
    assert.equal(r.action, 'refuse', `${addr} was tunnelled`);
    assert.equal(r.reason, 'address_blocked');
    assert.match(r.detail, /inside\.example/);
  }
});

test('NFR-21.5 — a mixed answer is refused, not filtered down to the public one', async () => {
  // Choosing the public address would leave the refusal decidable by whichever
  // address the resolver happened to return first.
  const p = policy({ proxy: { connect: { allow: ['mixed.example'] } } },
    { 'mixed.example': ['93.184.216.34', '169.254.169.254'] });
  const r = await p.classify('mixed.example', 443);
  assert.equal(r.action, 'refuse');
  assert.equal(r.reason, 'address_blocked');
});

test('NFR-21.1 — a literal private address as the destination is refused', async () => {
  const p = policy({ proxy: { connect: { allow: ['169.254.169.254'] } } });
  assert.equal((await p.classify('169.254.169.254', 443)).reason, 'address_blocked');
});

test('NFR-21.2 — the resolution is returned so the caller never looks it up again', async () => {
  // The rebinding hole: a name answering publicly for the check and privately
  // for the connect. The policy hands back the address it approved, so a caller
  // that uses it cannot be moved by a second answer.
  let call = 0;
  const flipping = async () => (++call === 1
    ? [{ address: '93.184.216.34', family: 4 }]
    : [{ address: '169.254.169.254', family: 4 }]);
  const p = createDestinationPolicy(
    { upstream: UP, proxy: { connect: { allow: ['rebind.example'] } } }, { lookup: flipping });
  const r = await p.classify('rebind.example', 443);
  assert.equal(r.action, 'tunnel');
  assert.equal(r.address, '93.184.216.34');
  assert.equal(call, 1, 'the policy itself resolved more than once');
});

test('a name that does not resolve is refused, and says that is why', async () => {
  // Asserting only "refused" is not enough: a version that fed the unresolved
  // *name* to the address check also refuses it, as `not an address`, and the
  // client is then told its destination is blocked when DNS is what failed.
  const p = policy({ proxy: { connect: { allow: ['gone.example'] } } });
  const r = await p.classify('gone.example', 443);
  assert.equal(r.action, 'refuse');
  assert.equal(r.reason, 'not_allowed');
  assert.match(r.detail, /gone\.example/);
  assert.match(r.detail, /resolve/i, 'the refusal blames the wrong thing');
});

// ── NFR-21.3 — port ─────────────────────────────────────────────────────────

test('NFR-21.3 — an allowlisted host on any port but 443 is refused', async () => {
  const p = policy({ proxy: { connect: { allow: ['ok.example'] } } }, { 'ok.example': ['93.184.216.34'] });
  for (const port of [22, 80, 6379, 5432, 8443]) {
    const r = await p.classify('ok.example', port);
    assert.equal(r.action, 'refuse', `port ${port} was allowed`);
    assert.equal(r.reason, 'port_not_allowed');
  }
  assert.equal((await p.classify('ok.example', 443)).action, 'tunnel');
});

test('the port check runs before the lookup, so a refused port costs no DNS', async () => {
  let looked = 0;
  const p = createDestinationPolicy(
    { upstream: UP, proxy: { host: '0.0.0.0', apiKey: 'k', connect: { allow: ['ok.example'] } } },
    { lookup: async () => { looked++; return [{ address: '93.184.216.34', family: 4 }]; } });
  await p.classify('ok.example', 22);
  assert.equal(looked, 0, 'a destination that can never be allowed was resolved anyway');
});

test('a loopback proxy still tunnels to any port, as it always has', async () => {
  // The blind-tunnel tests dial an ephemeral port on 127.0.0.1, which is what
  // the local forward proxy has always been for.
  const p = policy({ proxy: { host: '127.0.0.1' } }, { 'echo.example': ['127.0.0.1'] });
  assert.equal((await p.classify('echo.example', 54321)).action, 'tunnel');
});

// ── FR-07.6 and the defaults that derive from proxy.host ────────────────────

test('FR-07.6 — the test host is intercepted on loopback and not when bound wider', async () => {
  const local = await policy({ proxy: { host: '127.0.0.1' } }).classify('www.example.org', 443);
  assert.equal(local.action, 'intercept', 'the credential-free local check stopped working');

  const hosted = await policy().classify('www.example.org', 443);
  assert.equal(hosted.action, 'refuse',
    'a shared node answered for a domain it does not own');
});

test('FR-07.6 — the test host can be turned off explicitly on loopback too', async () => {
  const p = policy({ proxy: { host: '127.0.0.1', connect: { testHost: false } } });
  assert.equal((await p.classify('www.example.org', 443)).action, 'refuse');
});

test('with proxy.host on loopback, an unlisted host is still tunnelled', async () => {
  // The local proxy has always been a general forward proxy and people rely on
  // it. Closing that by default would be a silent break for every existing user.
  const p = policy({ proxy: { host: '127.0.0.1' } }, { 'anything.example': ['93.184.216.34'] });
  assert.equal((await p.classify('anything.example', 443)).action, 'tunnel');
});

test('a loopback proxy still reaches the machine it is running on', async () => {
  // The local proxy has tunnelled to 127.0.0.1 since it existed, and the
  // blind-tunnel tests do exactly that. Closing it by default would be a silent
  // break for every existing user, so the address policy derives from
  // proxy.host like the rest of the switches.
  const p = policy({ proxy: { host: '127.0.0.1' } }, { 'inside.example': ['127.0.0.1'] });
  assert.equal((await p.classify('inside.example', 443)).action, 'tunnel');
});

test('a loopback proxy can still be closed explicitly', async () => {
  const p = policy({ proxy: { host: '127.0.0.1', connect: { allowPrivateAddresses: false } } },
    { 'inside.example': ['169.254.169.254'] });
  assert.equal((await p.classify('inside.example', 443)).reason, 'address_blocked');
});

test('allowPrivateAddresses re-opens the address policy for an operator who means it', async () => {
  // Off-box it is closed, and only an explicit opt-in reverses that.
  const shut = policy({ proxy: { connect: { allow: ['inside.example'] } } },
    { 'inside.example': ['10.1.2.3'] });
  assert.equal((await shut.classify('inside.example', 443)).reason, 'address_blocked');

  const open = policy({ proxy: { connect: { allow: ['inside.example'], allowPrivateAddresses: true } } },
    { 'inside.example': ['10.1.2.3'] });
  const r = await open.classify('inside.example', 443);
  assert.equal(r.action, 'tunnel', 'an explicit opt-in was ignored');
  assert.equal(r.address, '10.1.2.3');
});

test('every refusal reason maps onto an error-envelope class', async () => {
  // The envelope names three; a fourth here would reach a client as something
  // the contract does not describe.
  const p = policy({ proxy: { connect: { allow: ['ok.example'] } } },
    { 'ok.example': ['10.0.0.1'], 'other.example': ['93.184.216.34'] });
  const seen = new Set();
  for (const [h, port] of [['other.example', 443], ['ok.example', 22], ['ok.example', 443]]) {
    const r = await p.classify(h, port);
    if (r.action === 'refuse') seen.add(r.reason);
  }
  assert.deepEqual([...seen].sort(), ['address_blocked', 'not_allowed', 'port_not_allowed']);
});

// ── the same policy, through a running proxy ────────────────────────────────

import net from 'node:net';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TEAMCLAUDE_CONFIG = join(mkdtempSync(join(tmpdir(), 'tc-policy-')), 'config.json');
const { createProxyServer } = await import('../src/server.js');
const { AccountManager } = await import('../src/account-manager.js');

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const am = () => new AccountManager([{ name: 'k', type: 'apikey', apiKey: 'sk' }], 0.98);

/** A hosted proxy: bound off-loopback in configuration, listening on loopback. */
function hostedProxy(connect = {}) {
  return createProxyServer(am(), {
    upstream: UP,
    proxy: { host: '0.0.0.0', apiKey: 'k', connect: { allowLoopbackClients: true, ...connect } },
  }, {});
}

function connectRaw(port, target, headers = '') {
  return new Promise((resolve, reject) => {
    const raw = net.connect(port, '127.0.0.1');
    raw.once('error', reject);
    raw.once('connect', () => raw.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${headers}\r\n`));
    raw.once('data', (d) => { const s = d.toString(); raw.destroy(); resolve(s.split('\r\n')[0]); });
  });
}

test('FR-07.4 — a refused CONNECT answers 403 and opens no socket to it', async () => {
  // A listener that must never be reached. Counting connections is the only way
  // to tell "refused" from "dialled, then refused", and the second is the SSRF.
  let dialled = 0;
  const forbidden = net.createServer((s) => { dialled++; s.destroy(); });
  const forbiddenPort = await listen(forbidden);
  const proxy = hostedProxy();
  const port = await listen(proxy);
  try {
    const line = await connectRaw(port, `127.0.0.1:${forbiddenPort}`);
    assert.match(line, / 403 /, `expected a refusal, got ${line}`);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(dialled, 0, 'the proxy connected to a destination it then refused');
  } finally { proxy.close(); forbidden.close(); }
});

test('FR-07.2 — the upstream host is still intercepted on a hosted listener', async () => {
  const proxy = hostedProxy();
  const port = await listen(proxy);
  try {
    assert.match(await connectRaw(port, 'api.anthropic.com:443'), / 200 /);
  } finally { proxy.close(); }
});

test('FR-07.6 — the test host is not intercepted when the listener is not loopback', async () => {
  const proxy = hostedProxy();
  const port = await listen(proxy);
  try {
    assert.match(await connectRaw(port, 'www.example.org:443'), / 403 /,
      'a shared node answered for a domain it does not own');
  } finally { proxy.close(); }
});

test('NFR-21.4 — the request path refuses the same destinations, with 400', async () => {
  // The second egress path. The issue as filed named only the CONNECT tunnel,
  // so closing one without the other would have closed nothing.
  let dialled = 0;
  const forbidden = http.createServer((_q, r) => { dialled++; r.writeHead(200); r.end('reached'); });
  const forbiddenPort = await listen(forbidden);
  const proxy = hostedProxy();
  const port = await listen(proxy);
  try {
    const res = await new Promise((resolve) => {
      const r = http.request({ port, host: '127.0.0.1', method: 'GET',
        path: `http://127.0.0.1:${forbiddenPort}/`, headers: { 'x-api-key': 'k' } },
      (rr) => { let b = ''; rr.on('data', (d) => { b += d; }); rr.on('end', () => resolve({ status: rr.statusCode, body: b })); });
      r.end();
    });
    assert.equal(res.status, 400, `403 makes the client print "Failed to authenticate", 502 is retried`);
    assert.match(res.body, /destination_/);
    assert.equal(dialled, 0, 'the forward path reached a destination the CONNECT path refuses');
  } finally { proxy.close(); forbidden.close(); }
});

test('NFR-20.1 — a non-loopback listener with no proxy.apiKey refuses to start', () => {
  assert.throws(
    () => createProxyServer(am(), { upstream: UP, proxy: { host: '0.0.0.0' } }, {}),
    /proxy\.apiKey/,
    'the error does not name the missing setting');
  // and the safe combinations still start
  createProxyServer(am(), { upstream: UP, proxy: { host: '0.0.0.0', apiKey: 'k' } }, {}).close();
  createProxyServer(am(), { upstream: UP, proxy: { host: '127.0.0.1' } }, {}).close();
});

test('NFR-20.2 — the loopback exemption is off when the listener is not loopback', async () => {
  // Default connect config: allowLoopbackClients derives from proxy.host.
  const proxy = createProxyServer(am(), {
    upstream: UP, proxy: { host: '0.0.0.0', apiKey: 'k' },
  }, {});
  const port = await listen(proxy);
  try {
    const line = await connectRaw(port, 'api.anthropic.com:443');
    assert.match(line, / 407 /, 'a loopback client was let through on a hosted listener');
  } finally { proxy.close(); }
});

test('with proxy.host on loopback, an unlisted host on an odd port still tunnels', async () => {
  const echo = net.createServer((s) => s.pipe(s));
  const echoPort = await listen(echo);
  const proxy = createProxyServer(am(), { upstream: UP, proxy: { host: '127.0.0.1', apiKey: 'k' } }, {});
  const port = await listen(proxy);
  try {
    assert.match(await connectRaw(port, `127.0.0.1:${echoPort}`), / 200 /,
      'the local forward proxy stopped doing what it has always done');
  } finally { proxy.close(); echo.close(); }
});

test('FR-07.5 — the shipped allowlist is composed, and every entry says why', async () => {
  const { SHIPPED_ALLOW } = await import('../src/destination-policy.js');
  assert.ok(SHIPPED_ALLOW.length > 0);
  for (const e of SHIPPED_ALLOW) {
    assert.ok(e.host && !e.host.includes('*'), `${e.host} is not an exact hostname`);
    assert.ok(e.why && e.why.length > 30, `${e.host} records no reason`);
  }
  // and it is in force without the operator restating it
  const p = policy({}, { 'downloads.claude.ai': ['93.184.216.34'] });
  assert.equal((await p.classify('downloads.claude.ai', 443)).action, 'tunnel');
});

test('an operator entry extends the shipped list rather than replacing it', async () => {
  const p = policy({ proxy: { connect: { allow: ['mcp.notion.com'] } } },
    { 'mcp.notion.com': ['93.184.216.34'], 'downloads.claude.ai': ['93.184.216.34'] });
  assert.equal((await p.classify('mcp.notion.com', 443)).action, 'tunnel');
  assert.equal((await p.classify('downloads.claude.ai', 443)).action, 'tunnel',
    'adding an entry dropped the shipped ones');
});
