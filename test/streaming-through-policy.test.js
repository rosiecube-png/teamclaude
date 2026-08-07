import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Two task-3 acceptance criteria named a requirement and nothing in test/ ever
// named it back. Found by mapping every id in the plan's criteria against the
// suite rather than by reading:
//
//   NFR-07  an SSE response survives the new path; no idle timeout is
//           introduced below the client watchdogs
//   NFR-06  resolution does not add a DNS lookup per request; results are
//           reused for the life of a tunnel at minimum
//
// NFR-07 is the one that matters. Every Claude Code response arrives as
// `text/event-stream`, and task-3 put a policy decision in front of the CONNECT
// that carries them. The MITM integration suite covers that path but sends only
// whole bodies, so a change that broke streaming would have gone green.

process.env.TEAMCLAUDE_CONFIG = join(mkdtempSync(join(tmpdir(), 'tc-sse-')), 'config.json');

const { createConnectHandler } = await import('../src/mitm.js');
const { createDestinationPolicy } = await import('../src/destination-policy.js');
const { AccountManager } = await import('../src/account-manager.js');
const { generateCertChain } = await import('../src/x509.js');

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const closeHard = (s) => { try { s.closeAllConnections?.(); s.close(); } catch { /* going */ } };
const chain = generateCertChain(['localhost', '127.0.0.1']);

function connectThroughProxy(proxyPort, target, alpn = ['http/1.1']) {
  return new Promise((resolve, reject) => {
    const raw = net.connect(proxyPort, '127.0.0.1');
    raw.once('error', reject);
    raw.once('connect', () => raw.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (!buf.includes('\r\n\r\n')) return;
      raw.removeListener('data', onData);
      const sock = tls.connect({ socket: raw, servername: 'localhost', ca: [chain.caCertPem], ALPNProtocols: alpn },
        () => resolve(sock));
      sock.once('error', reject);
    };
    raw.on('data', onData);
  });
}

/** A proxy whose destination policy is ours, so its lookups can be counted. */
function makeProxy(upPort, { onLookup = () => {} } = {}) {
  const config = { upstream: `http://127.0.0.1:${upPort}` };
  const policy = createDestinationPolicy(config, {
    lookup: async (host) => { onLookup(host); return [{ address: '127.0.0.1', family: 4 }]; },
  });
  const proxy = http.createServer();
  proxy.on('connect', createConnectHandler({
    config,
    accountManager: new AccountManager(
      [{ name: 'a', type: 'oauth', accessToken: 'TOKEN-A', refreshToken: 'r', expiresAt: Date.now() + 3600_000 }], 0.98),
    ensureLeaf: async () => ({ key: chain.leafKeyPem, cert: chain.leafCertPem }),
    log: () => {}, policy,
  }));
  return proxy;
}

// ── NFR-07 ──────────────────────────────────────────────────────────────────

test('NFR-07 — an SSE response still arrives in pieces through the policy path', { timeout: 30000 }, async () => {
  // The upstream writes three events with real gaps between them. If anything
  // on the new path buffered the body, or cut an idle stream, the client would
  // see one chunk at the end or nothing at all.
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    let n = 0;
    const tick = setInterval(() => {
      n++;
      res.write(`event: message\ndata: {"n":${n}}\n\n`);
      if (n === 3) { clearInterval(tick); res.end('event: done\ndata: [DONE]\n\n'); }
    }, 250);
    req.on('close', () => clearInterval(tick));
  });
  const upPort = await listen(upstream);
  const proxy = makeProxy(upPort);
  const proxyPort = await listen(proxy);

  try {
    const sock = await connectThroughProxy(proxyPort, `127.0.0.1:${upPort}`);
    const arrivals = [];
    const body = await new Promise((resolve, reject) => {
      let text = '';
      sock.on('data', (d) => {
        text += d.toString('utf8');
        arrivals.push(Date.now());
        if (text.includes('[DONE]')) resolve(text);
      });
      sock.on('error', reject);
      sock.setTimeout(20000, () => reject(new Error('the stream stalled')));
      sock.write('POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
        'content-type: application/json\r\ncontent-length: 46\r\n\r\n' +
        '{"model":"claude-haiku-4-5","stream":true,"m":1}'.slice(0, 46));
    });

    assert.match(body, /text\/event-stream/, 'the content type did not survive');
    for (const n of [1, 2, 3]) assert.match(body, new RegExp(`"n":${n}`), `event ${n} is missing`);
    assert.match(body, /\[DONE\]/);

    // Delivered as a stream, not assembled and handed over at the end: the
    // first bytes must arrive well before the last.
    assert.ok(arrivals.length >= 2,
      `the whole response arrived in ${arrivals.length} chunk(s) — it was buffered, not streamed`);
    assert.ok(arrivals[arrivals.length - 1] - arrivals[0] > 200,
      'every chunk arrived at once, so the stream was collected before it was relayed');
    sock.destroy();
  } finally { closeHard(proxy); closeHard(upstream); }
});

test('NFR-07 — a stream idle longer than a turn is not cut by anything new', { timeout: 40000 }, async () => {
  // The tunnel has a 30s timeout on the *blind* path. The intercepted path must
  // not acquire one below the client's own watchdogs: a model that thinks for a
  // while before its first token is normal, and cutting it would look like a
  // network fault.
  const IDLE_MS = 6000;
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: ping\ndata: {"n":0}\n\n');
    setTimeout(() => res.end('event: done\ndata: [DONE]\n\n'), IDLE_MS);
  });
  const upPort = await listen(upstream);
  const proxy = makeProxy(upPort);
  const proxyPort = await listen(proxy);

  try {
    const sock = await connectThroughProxy(proxyPort, `127.0.0.1:${upPort}`);
    const started = Date.now();
    const body = await new Promise((resolve, reject) => {
      let text = '';
      sock.on('data', (d) => { text += d.toString('utf8'); if (text.includes('[DONE]')) resolve(text); });
      sock.on('error', reject);
      sock.on('close', () => reject(new Error(`the connection closed after ${Date.now() - started}ms, mid-stream`)));
      sock.setTimeout(30000, () => reject(new Error('stalled')));
      sock.write('POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-length: 2\r\n\r\n{}');
    });
    assert.match(body, /\[DONE\]/);
    assert.ok(Date.now() - started >= IDLE_MS, 'the idle gap was not actually exercised');
    sock.destroy();
  } finally { closeHard(proxy); closeHard(upstream); }
});

// ── NFR-06 ──────────────────────────────────────────────────────────────────

test('NFR-06 — one resolution per tunnel, not one per request', { timeout: 30000 }, async () => {
  // The check runs at CONNECT. Requests inside the tunnel never reach it, which
  // is true by construction and worth holding: moving the call to the request
  // path would add a lookup to every message a session sends.
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const upPort = await listen(upstream);
  const lookups = [];
  const proxy = makeProxy(upPort, { onLookup: (h) => lookups.push(h) });
  const proxyPort = await listen(proxy);

  try {
    const sock = await connectThroughProxy(proxyPort, `127.0.0.1:${upPort}`);
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve, reject) => {
        let text = '';
        const onData = (d) => {
          text += d.toString('utf8');
          if (text.includes('{"ok":true}')) { sock.removeListener('data', onData); resolve(); }
        };
        sock.on('data', onData);
        sock.once('error', reject);
        sock.write('POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-length: 2\r\n\r\n{}');
        setTimeout(() => reject(new Error(`request ${i} got no answer`)), 10000);
      });
    }
    assert.equal(lookups.length, 0,
      `the upstream host is intercepted, so it is never resolved here — got ${lookups.length}`);
    sock.destroy();
  } finally { closeHard(proxy); closeHard(upstream); }
});

test('NFR-06 — a tunnelled destination is resolved once per CONNECT', { timeout: 30000 }, async () => {
  const echo = net.createServer((s) => s.pipe(s));
  const echoPort = await listen(echo);
  const lookups = [];
  // A loopback-shaped config so an unlisted host on an odd port still tunnels.
  const config = { upstream: 'http://127.0.0.1:1', proxy: { host: '127.0.0.1' } };
  const policy = createDestinationPolicy(config, {
    lookup: async (h) => { lookups.push(h); return [{ address: '127.0.0.1', family: 4 }]; },
  });
  const proxy = http.createServer();
  proxy.on('connect', createConnectHandler({
    config, accountManager: new AccountManager([{ name: 'k', type: 'apikey', apiKey: 'sk' }], 0.98),
    ensureLeaf: async () => ({ key: chain.leafKeyPem, cert: chain.leafCertPem }), log: () => {}, policy,
  }));
  const proxyPort = await listen(proxy);

  try {
    const raw = net.connect(proxyPort, '127.0.0.1');
    await new Promise((r) => raw.once('connect', r));
    raw.write(`CONNECT tunnelled.example:${echoPort} HTTP/1.1\r\nHost: x\r\n\r\n`);
    // Push several payloads through the one tunnel.
    const seen = await new Promise((resolve, reject) => {
      let established = false, got = 0, buf = '';
      raw.on('data', (d) => {
        buf += d.toString();
        if (!established && buf.includes('\r\n\r\n')) {
          established = true; buf = '';
          raw.write('ONE'); return;
        }
        if (established && buf.includes('ONE') && got === 0) { got = 1; buf = ''; raw.write('TWO'); return; }
        if (established && buf.includes('TWO')) resolve(2);
      });
      raw.once('error', reject);
      setTimeout(() => reject(new Error('the tunnel never echoed')), 10000);
    });
    assert.equal(seen, 2, 'the tunnel did not carry both payloads');
    assert.equal(lookups.length, 1,
      `one CONNECT must cost one resolution, whatever flows through it — got ${lookups.length}`);
    raw.destroy();
  } finally { closeHard(proxy); echo.close(); }
});
