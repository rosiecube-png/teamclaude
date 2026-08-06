import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProxyTls, createProxyServer } from '../src/server.js';
import { generateCertChain } from '../src/x509.js';

// TLS on the proxy's OWN listener. Without it the documented off-box mode
// (proxy.host 0.0.0.0 + proxy.apiKey) ships the proxy key in clear on every
// request and every CONNECT — see resolveProxyTls's comment.

test('no proxy.tls → null (listener stays plain HTTP)', () => {
  assert.equal(resolveProxyTls({}), null);
  assert.equal(resolveProxyTls({ proxy: {} }), null);
  assert.equal(resolveProxyTls(undefined), null);
});

test('proxy.tls with only one of cert/key is rejected', () => {
  assert.throws(() => resolveProxyTls({ proxy: { tls: { cert: '/c.pem' } } }), /both "cert" and "key"/);
  assert.throws(() => resolveProxyTls({ proxy: { tls: { key: '/k.pem' } } }), /both "cert" and "key"/);
});

test('an unreadable cert is fatal, never a silent fallback to plaintext', () => {
  const missing = () => { const e = new Error('ENOENT: no such file'); throw e; };
  assert.throws(
    () => resolveProxyTls({ proxy: { tls: { cert: '/nope.pem', key: '/k.pem' } } }, missing),
    /proxy\.tls\.cert: cannot read \/nope\.pem/,
  );
});

test('cert, key and optional ca are read from their paths', () => {
  const read = (p) => Buffer.from(`<${p}>`);
  assert.deepEqual(
    resolveProxyTls({ proxy: { tls: { cert: '/c.pem', key: '/k.pem' } } }, read),
    { cert: Buffer.from('</c.pem>'), key: Buffer.from('</k.pem>') },
  );
  const withCa = resolveProxyTls({ proxy: { tls: { cert: '/c', key: '/k', ca: '/a' } } }, read);
  assert.deepEqual(withCa.ca, Buffer.from('</a>'));
});

// The load-bearing assumption: an https.Server is an http.Server on a TLS
// transport, so it still emits 'connect'. If that were false the MITM path
// would go dark the moment TLS was enabled — a silent loss of the feature that
// catches hardcoded api.anthropic.com callers.
test('the real proxy server terminates TLS and still answers CONNECT', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tc-tls-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const chain = generateCertChain(['localhost']);
  const certPath = join(dir, 'leaf.pem');
  const keyPath = join(dir, 'leaf.key');
  await writeFile(certPath, chain.leafCertPem);
  await writeFile(keyPath, chain.leafKeyPem);

  const accountManager = { accounts: [], getStatus: () => ({ accounts: [] }) };
  const server = createProxyServer(accountManager, {
    proxy: { tls: { cert: certPath, key: keyPath } },
    upstream: 'https://api.anthropic.com',
  }, {}, null);
  t.after(() => server.close());

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  // A TLS client that trusts our CA — i.e. exactly what `HTTPS_PROXY=https://…`
  // does — then speaks the proxy protocol inside that TLS session.
  const sock = tls.connect({ host: '127.0.0.1', port, ca: chain.caCertPem, servername: 'localhost' });
  await once(sock, 'secureConnect');
  assert.equal(sock.authorized, true, 'leaf must validate against the generated CA');

  sock.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n');
  const [chunk] = await once(sock, 'data');
  // The MITM handler owns CONNECT: it answers 200 and hands the socket to the
  // terminating server. Reaching a 200 proves 'connect' fired over TLS.
  assert.match(chunk.toString(), /^HTTP\/1\.1 200/);

  sock.destroy();
});

test('a plain-HTTP client gets no TLS listener when proxy.tls is absent', async (t) => {
  const accountManager = { accounts: [], getStatus: () => ({ accounts: [] }) };
  const server = createProxyServer(accountManager, { upstream: 'https://api.anthropic.com' }, {}, null);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  // http.Server, not tls.Server: no 'secureConnection' machinery on it.
  assert.equal(typeof server.setSecureContext, 'undefined');
});
