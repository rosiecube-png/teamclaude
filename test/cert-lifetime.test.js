import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';

// #21 — the stored chain was reused on two conditions only: signed by our CA,
// and covering the hosts. Neither reads a date, so 825 days after first launch
// every intercepted TLS connection fails and nothing regenerates. The only
// recovery was deleting the files by hand.
//
// The dates here are real rather than mocked: createLeaf takes `days` at
// issuance, so a chain that expired yesterday is minted with days: -1 and a
// chain inside its renewal window with days: 10. No clock to inject, and the
// certificates under test are the ones the code would actually meet.

const TMP = mkdtempSync(join(tmpdir(), 'tc-certlife-'));
process.env.TEAMCLAUDE_CONFIG = join(TMP, 'config.json');

const { ensureCerts, certReuseProblem, certOptions, CERT_DEFAULTS, TEST_HOST } =
  await import('../src/mitm.js');
const { createCA, createLeaf } = await import('../src/x509.js');
const { AccountManager } = await import('../src/account-manager.js');
const { createProxyServer } = await import('../src/server.js');

const HOST = 'api.anthropic.com';
const HOSTS = [HOST, TEST_HOST];
const DAY = 24 * 60 * 60 * 1000;

/** Mint a chain with chosen lifetimes and write it where ensureCerts looks. */
function planted({ caDays = 3650, leafDays = 90, hosts = HOSTS } = {}) {
  const ca = createCA('Cert Lifetime Test CA', caDays);
  const leaf = createLeaf(hosts, ca, leafDays);
  writeFileSync(join(TMP, 'teamclaude-ca.pem'), ca.certPem);
  writeFileSync(join(TMP, 'teamclaude-leaf.pem'), leaf.certPem);
  writeFileSync(join(TMP, 'teamclaude-leaf.key'), leaf.keyPem);
  return { caCertPem: ca.certPem, leafCertPem: leaf.certPem };
}

const daysLeft = (pem) => (new Date(new X509Certificate(pem).validTo) - Date.now()) / DAY;

/** ensureCerts, capturing what it logged. */
async function ensure(config = {}) {
  const lines = [];
  const out = await ensureCerts(HOST, { config, log: (m) => lines.push(m) });
  return { ...out, lines, logged: lines.join('\n') };
}

// ── NFR-17.1, NFR-17.2 — the reuse decision reads the dates ──────────────────

test('a leaf that expired is replaced, not returned', async () => {
  const before = planted({ leafDays: -1 });
  const after = await ensure();
  assert.notEqual(after.leafCertPem, before.leafCertPem, 'the expired leaf was handed back');
  assert.ok(daysLeft(after.leafCertPem) > 0, 'the replacement is itself expired');
});

test('a leaf inside the renewal window is replaced before it breaks', async () => {
  // 10 days left against a 30-day window: still valid, already due.
  const before = planted({ leafDays: 10 });
  const after = await ensure();
  assert.notEqual(after.leafCertPem, before.leafCertPem);
  assert.ok(daysLeft(after.leafCertPem) > 30);
});

test('a leaf outside the window covering the hosts is reused — no needless churn', async () => {
  const before = planted({ leafDays: 90 });
  const first = await ensure();
  assert.equal(first.leafCertPem, before.leafCertPem, 'a healthy chain was regenerated');
  const second = await ensure();
  assert.equal(second.leafCertPem, before.leafCertPem, 'a second call churned the chain');
});

test('an expired CA is replaced even when the leaf is fresh', async () => {
  // The leaf's own dates say nothing about the CA that signed it.
  const before = planted({ caDays: -1, leafDays: 90 });
  assert.ok(daysLeft(before.leafCertPem) > 80, 'the planted leaf should be fresh');
  const after = await ensure();
  assert.notEqual(after.caCertPem, before.caCertPem, 'the expired CA was kept');
  assert.notEqual(after.leafCertPem, before.leafCertPem, 'the leaf outlived its CA');
});

test('a leaf that does not cover the hosts is still replaced', async () => {
  // The pre-existing reason for regeneration has to survive the new ones.
  const before = planted({ hosts: ['somewhere.else'], leafDays: 90 });
  const after = await ensure();
  assert.notEqual(after.leafCertPem, before.leafCertPem);
});

// ── NFR-17.3 — regeneration says why ─────────────────────────────────────────

test('regeneration logs the reason, distinguishing the three causes', async () => {
  planted({ leafDays: -1 });
  assert.match((await ensure()).logged, /expired/i);

  planted({ leafDays: 10 });
  const near = await ensure();
  assert.match(near.logged, /renew|window|due/i);
  assert.doesNotMatch(near.logged, /\bhas expired\b/i, 'a cert with 10 days left is not expired');

  planted({ hosts: ['somewhere.else'], leafDays: 90 });
  assert.match((await ensure()).logged, /host|cover/i);

  planted({ caDays: -1, leafDays: 90 });
  assert.match((await ensure()).logged, /\bCA\b/);
});

test('reusing a healthy chain is silent', async () => {
  planted({ leafDays: 90 });
  assert.deepEqual((await ensure()).lines, [], 'nothing was regenerated, so nothing to report');
});

// ── NFR-17.4 — lifetimes are configurable, and the defaults are shorter ──────

test('the shipped defaults are shorter than the 825 days they replace', () => {
  assert.ok(CERT_DEFAULTS.leafDays < 825);
  assert.ok(CERT_DEFAULTS.renewBeforeDays < CERT_DEFAULTS.leafDays,
    'a cert that is due for renewal the moment it is minted regenerates forever');
});

test('leafDays and renewBeforeDays are read from proxy.certs', async () => {
  planted({ leafDays: -1 });
  const minted = await ensure({ proxy: { certs: { leafDays: 7 } } });
  const life = daysLeft(minted.leafCertPem);
  assert.ok(life > 6 && life <= 7, `expected ~7 days of life, got ${life.toFixed(2)}`);

  // A 90-day leaf is healthy by default and due under a 120-day window.
  const healthy = planted({ leafDays: 90 });
  const reused = await ensure();
  assert.equal(reused.leafCertPem, healthy.leafCertPem);

  planted({ leafDays: 90 });
  const renewed = await ensure({ proxy: { certs: { leafDays: 365, renewBeforeDays: 120 } } });
  assert.ok(daysLeft(renewed.leafCertPem) > 300, 'the wider window did not trigger renewal');
});

test('a renewal window wider than the lifetime is clamped rather than churning', () => {
  // Otherwise every freshly minted cert is immediately due and ensureCerts
  // regenerates on every single CONNECT.
  const opts = certOptions({ proxy: { certs: { leafDays: 30, renewBeforeDays: 90 } } });
  assert.ok(opts.renewBeforeDays < opts.leafDays);
  assert.equal(opts.clamped, 90, 'the clamp is not reported, so nobody learns the config is wrong');
});

test('the clamp is reported once, not on every connection', async () => {
  // ensureCerts runs on every intercepted CONNECT now that nothing memoises the
  // renewal check, so a warning about a setting that never changes would print
  // on every one of them.
  const bad = { proxy: { certs: { leafDays: 30, renewBeforeDays: 90 } } };
  planted({ leafDays: 90 });
  const first = await ensure(bad);
  assert.equal(first.lines.filter((l) => /renewBeforeDays/.test(l)).length, 1);

  planted({ leafDays: 90 });
  const second = await ensure(bad);
  assert.deepEqual(second.lines.filter((l) => /renewBeforeDays/.test(l)), [],
    'the same misconfiguration was reported twice');
});

test('nonsense values fall back to the defaults instead of minting a broken cert', () => {
  for (const bad of [0, -5, 'ninety', null, NaN, Infinity]) {
    const o = certOptions({ proxy: { certs: { leafDays: bad, renewBeforeDays: bad } } });
    assert.equal(o.leafDays, CERT_DEFAULTS.leafDays, `leafDays: ${String(bad)}`);
    assert.equal(o.renewBeforeDays, CERT_DEFAULTS.renewBeforeDays, `renewBeforeDays: ${String(bad)}`);
  }
});

// ── the decision function on its own ─────────────────────────────────────────

test('certReuseProblem names the problem and returns null when there is none', () => {
  const ca = createCA('Probe CA', 3650);
  const good = createLeaf(HOSTS, ca, 90);
  const opts = { renewBeforeDays: 30 };

  assert.equal(certReuseProblem(ca.certPem, good.certPem, HOSTS, opts), null);
  assert.match(certReuseProblem(ca.certPem, createLeaf(HOSTS, ca, -1).certPem, HOSTS, opts), /expired/i);
  assert.match(certReuseProblem(ca.certPem, createLeaf(HOSTS, ca, 10).certPem, HOSTS, opts), /renew|due/i);
  assert.match(certReuseProblem(ca.certPem, good.certPem, [...HOSTS, 'extra.host'], opts), /extra\.host/);
  assert.match(certReuseProblem(createCA('Other', 3650).certPem, good.certPem, HOSTS, opts), /sign/i);
  assert.match(certReuseProblem('not a certificate', good.certPem, HOSTS, opts), /read|parse/i);

  const expiredCa = createCA('Expired CA', -1);
  assert.match(certReuseProblem(expiredCa.certPem, createLeaf(HOSTS, expiredCa, 90).certPem, HOSTS, opts), /\bCA\b/);
});

// ── NFR-17.5 — a replaced chain reaches new connections without a restart ────

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

/**
 * CONNECT through the proxy, complete TLS, resolve the socket.
 *
 * Every socket it opens goes into `open` and the caller destroys them all. A
 * handshake that fails here leaves the raw tunnel socket behind otherwise, and
 * Node will not exit while one is alive: the first version of this file hung
 * for ten minutes on a failing assertion instead of reporting it. `--test-
 * timeout` does not help — the test had already finished; it was the process
 * that could not leave.
 */
// Exactly one socket per connection is owned here. Holding both the raw tunnel
// and the TLS socket wrapping it and destroying each in turn crashed the runner
// outright — exit 3221225477, an access violation, with test 14 never reported
// because the process was gone. Destroying the wrapper takes the socket under it
// with it, so the raw one is handed over the moment the wrapper exists.
const open = new Set();
function connectTls(port, target, ca, servername) {
  return new Promise((resolve, reject) => {
    const raw = net.connect(port, '127.0.0.1');
    open.add(raw);
    const fail = (err) => {
      open.delete(raw);
      try { raw.destroy(); } catch { /* already gone */ }
      reject(err);
    };
    raw.once('error', fail);
    raw.once('connect', () => raw.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (!buf.includes('\r\n\r\n')) return;
      raw.removeListener('data', onData);
      const sock = tls.connect({ socket: raw, servername, ca: [ca] }, () => {
        open.delete(raw);
        open.add(sock);
        resolve(sock);
      });
      sock.once('error', fail);
    };
    raw.on('data', onData);
  });
}

function closeAll() {
  for (const s of open) { try { s.destroy(); } catch { /* already gone */ } }
  open.clear();
}

function httpOver(sock, hostHeader, path = '/') {
  return new Promise((resolve) => {
    sock.write(`GET ${path} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve(buf));
    sock.on('close', () => resolve(buf));
  });
}

const serial = (pem) => new X509Certificate(pem).serialNumber;

// Two memos stand between a regenerated chain and a client: certsPromise
// (server.js) resolves once, and serverPromises (mitm.js) caches a terminating
// server that baked the certificate in at creation. A shorter lifetime without
// this is worse than leaving it alone — the renewal would happen and never
// arrive.
test('a chain replaced mid-process reaches the next connection without a restart', async () => {
  // upstream is localhost so hostMode() intercepts CONNECT localhost:443 and
  // takes the rewrite path, which is the one that memoises a server — the leaf
  // therefore has to cover localhost rather than the usual host. Nothing is
  // listening upstream and nothing needs to be: the assertion is about which
  // certificate the terminating server presents, which is settled at handshake.
  const LOCAL = ['localhost', TEST_HOST];
  const first = planted({ leafDays: 90, hosts: LOCAL });
  const am = new AccountManager([{ name: 'k', type: 'apikey', apiKey: 'sk' }], 0.98);
  const proxy = createProxyServer(am, { proxy: { apiKey: 'k' }, upstream: 'https://localhost' }, {});
  const port = await listen(proxy);
  try {
    const before = await connectTls(port, 'localhost:443', first.caCertPem, 'localhost');
    assert.equal(before.authorized, true);
    assert.equal(before.getPeerX509Certificate().serialNumber, serial(first.leafCertPem));

    const replacement = planted({ leafDays: 90, hosts: LOCAL });

    const after = await connectTls(port, 'localhost:443', replacement.caCertPem, 'localhost');
    assert.equal(after.authorized, true, 'the new chain never reached a new connection');
    assert.equal(after.getPeerX509Certificate().serialNumber, serial(replacement.leafCertPem));

    // ASM-17, measured: TLS validates at handshake, so a connection opened
    // before the swap is not disturbed by it.
    assert.equal(before.destroyed, false, 'replacing the chain tore down a live tunnel');

  } finally {
    closeAll();
    proxy.close();
  }
});

test('a connection open across a replacement still serves requests', async () => {
  planted({ leafDays: 90 });
  const { caCertPem } = await ensure();
  const am = new AccountManager([{ name: 'k', type: 'apikey', apiKey: 'sk' }], 0.98);
  const proxy = createProxyServer(am, { proxy: { apiKey: 'k' }, upstream: 'https://api.anthropic.com' }, {});
  const port = await listen(proxy);
  try {
    const sock = await connectTls(port, `${TEST_HOST}:443`, caCertPem, TEST_HOST);
    planted({ leafDays: 90 }); // swap underneath the open connection
    const resp = await httpOver(sock, TEST_HOST, '/still-here');
    assert.match(resp, /200/);
    assert.match(resp, /"path":"\/still-here"/);
  } finally {
    closeAll();
    proxy.close();
  }
});
