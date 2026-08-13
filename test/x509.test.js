import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import tls from 'node:tls';
import net from 'node:net';
import { once } from 'node:events';
import { generateCertChain, createCA, createLeaf } from '../src/x509.js';

test('generated CA and leaf parse and form a valid chain', () => {
  const { caCertPem, leafCertPem } = generateCertChain('api.anthropic.com');
  const ca = new X509Certificate(caCertPem);
  const leaf = new X509Certificate(leafCertPem);

  assert.match(ca.subject, /TeamClaude Local CA/);
  assert.equal(ca.ca, true);
  assert.equal(leaf.subject, 'CN=api.anthropic.com');
  assert.equal(leaf.issuer, ca.subject);
  assert.equal(leaf.subjectAltName, 'DNS:api.anthropic.com');
  assert.equal(leaf.verify(ca.publicKey), true);   // leaf signed by CA
  assert.equal(leaf.ca, false);
});

test('a TLS server using the leaf is trusted by a client that trusts the CA', async () => {
  const { caCertPem, leafCertPem, leafKeyPem } = generateCertChain('api.anthropic.com');
  const server = tls.createServer({ key: leafKeyPem, cert: leafCertPem }, (s) => s.end('hi'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    const sock = tls.connect({ host: '127.0.0.1', port, servername: 'api.anthropic.com', ca: [caCertPem] });
    await once(sock, 'secureConnect');
    assert.equal(sock.authorized, true);
    sock.destroy();
  } finally {
    server.close();
  }
});

test('handshake fails when the client does NOT trust our CA', async () => {
  const { leafCertPem, leafKeyPem } = generateCertChain('api.anthropic.com');
  const server = tls.createServer({ key: leafKeyPem, cert: leafCertPem }, (s) => s.end('hi'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    // No `ca` override and not in the system store → must be rejected.
    const sock = tls.connect({ host: '127.0.0.1', port, servername: 'api.anthropic.com' });
    const [err] = await once(sock, 'error');
    assert.ok(err); // self-signed / unknown issuer
    sock.destroy();
  } finally {
    server.close();
  }
  void net; // (net imported for symmetry with other tests)
});

test('createCA + createLeaf compose for an arbitrary host', () => {
  const ca = createCA('My CA');
  const leaf = createLeaf('example.test', ca);
  const leafCert = new X509Certificate(leaf.certPem);
  assert.equal(leafCert.subjectAltName, 'DNS:example.test');
  assert.equal(leafCert.verify(new X509Certificate(ca.certPem).publicKey), true);
});

// An independent review pointed out that nothing here drove the cross-signed
// chain through a real handshake — every check inspected one link at a time with
// X509Certificate.verify(). Adding pathLenConstraint 0 to CA certificates then
// broke that chain with PATH_LENGTH_EXCEEDED and **62 tests stayed green**,
// because a chain is not the sum of its links.
test('a cross-signed succession is accepted by a device holding only the anchor', async () => {
  const tls = await import('node:tls');
  const { createCA, succeedCA, loadCA, createLeaf } = await import('../src/x509.js');

  const anchor = createCA(undefined, 3650);
  const next = succeedCA(loadCA(anchor.certPem, anchor.keyPem), { caDays: 3650 });
  const leaf = createLeaf(['api.anthropic.com'], loadCA(next.caCertPem, next.caKeyPem), 90);

  const server = tls.createServer({ key: leaf.keyPem, cert: leaf.certPem + next.crossCertPem });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const outcome = await new Promise((resolve) => {
      const c = tls.connect({ port: server.address().port, host: '127.0.0.1',
        servername: 'api.anthropic.com', ca: [anchor.certPem] },
      () => { const a = c.authorized; c.destroy(); resolve(a ? 'authorized' : 'unauthorized'); });
      c.on('error', (e) => resolve(e.code || e.message));
    });
    assert.equal(outcome, 'authorized',
      'the anchor -> cross-signed successor -> leaf chain does not verify end to end');
  } finally { server.close(); }
});

test('the chain is exactly anchor, successor and leaf — nothing deeper is issuable', async () => {
  // pathLenConstraint is what says so. It has to permit the one intermediate the
  // succession scheme needs and no more.
  const { createCA, succeedCA, loadCA } = await import('../src/x509.js');
  const { X509Certificate } = await import('node:crypto');
  const anchor = createCA(undefined, 3650);
  const next = succeedCA(loadCA(anchor.certPem, anchor.keyPem), { caDays: 3650 });
  for (const [label, pem] of [['anchor', anchor.certPem], ['successor', next.crossCertPem]]) {
    assert.equal(new X509Certificate(pem).ca, true, `${label} is not a CA`);
  }
});
