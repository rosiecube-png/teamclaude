// Minimal pure-JS X.509 certificate generation (no external deps).
//
// node:crypto can create keypairs and sign, but cannot issue certificates, so
// we hand-encode the (small) ASN.1 DER cert envelope and sign the TBS with the
// issuer key. Used only to mint a local CA + a leaf for the MITM proxy, which
// the launched claude process trusts via NODE_EXTRA_CA_CERTS. Nothing here is a
// general-purpose ASN.1 library — just what these two certs need.

import { generateKeyPairSync, sign as cryptoSign, randomBytes, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';

// ── ASN.1 DER primitives ──────────────────────────────────────

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let x = n;
  while (x > 0) { bytes.unshift(x & 0xff); x = Math.floor(x / 256); }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

const seq = (items) => tlv(0x30, Buffer.concat(items));
const set = (items) => tlv(0x31, Buffer.concat(items));
const NULL = Buffer.from([0x05, 0x00]);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octet = (buf) => tlv(0x04, buf);
const bitString = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf])); // 0 unused bits
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const explicit = (n, content) => tlv(0xa0 | n, content);   // [n] constructed
const ctxPrim = (n, content) => tlv(0x80 | n, content);    // [n] primitive

function integer(buf) {
  let b = Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.from([buf]);
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++; // strip leading zeros
  b = b.subarray(i);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); // keep positive
  return tlv(0x02, b);
}

function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const group = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) { group.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    out.push(...group);
  }
  return tlv(0x06, Buffer.from(out));
}

function utcTime(date) {
  const z = (n) => String(n).padStart(2, '0');
  const s = `${z(date.getUTCFullYear() % 100)}${z(date.getUTCMonth() + 1)}${z(date.getUTCDate())}` +
            `${z(date.getUTCHours())}${z(date.getUTCMinutes())}${z(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

function pem(der, label) {
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

// ── cert pieces ───────────────────────────────────────────────

const SIG_ALG = seq([oid('1.2.840.113549.1.1.11'), NULL]); // sha256WithRSAEncryption

function nameCN(cn) {
  return seq([set([seq([oid('2.5.4.3'), utf8(cn)])])]); // RDNSequence with one CN
}

function ext(extOid, critical, valueDer) {
  const items = [oid(extOid)];
  if (critical) items.push(bool(true));
  items.push(octet(valueDer));
  return seq(items);
}

// keyUsage BIT STRING from named bit positions (bit 0 = MSB of first byte).
function keyUsage(bits) {
  const max = Math.max(...bits);
  const nbytes = Math.floor(max / 8) + 1;
  const bytes = Buffer.alloc(nbytes);
  for (const b of bits) bytes[Math.floor(b / 8)] |= 0x80 >> (b % 8);
  const unused = nbytes * 8 - (max + 1);
  return tlv(0x03, Buffer.concat([Buffer.from([unused]), bytes]));
}

function buildCert({ subjectCN, issuerCN, spkiDer, signKey, isCA, altDnsNames = [], days }) {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);          // 1h back for clock skew
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const extList = [];
  extList.push(ext('2.5.29.19', true, isCA ? seq([bool(true)]) : seq([]))); // basicConstraints
  extList.push(ext('2.5.29.15', true, isCA
    ? keyUsage([0, 5, 6])   // digitalSignature, keyCertSign, cRLSign
    : keyUsage([0, 2])));   // digitalSignature, keyEncipherment
  if (!isCA) {
    extList.push(ext('2.5.29.37', false, seq([oid('1.3.6.1.5.5.7.3.1')]))); // extKeyUsage serverAuth
    if (altDnsNames.length) {
      extList.push(ext('2.5.29.17', false, seq(altDnsNames.map((d) => ctxPrim(2, Buffer.from(d)))))); // SAN dNSName
    }
  }

  const tbs = seq([
    explicit(0, integer(Buffer.from([2]))),  // version v3
    integer(randomBytes(16)),                // serial
    SIG_ALG,
    nameCN(issuerCN),
    seq([utcTime(notBefore), utcTime(notAfter)]),
    nameCN(subjectCN),
    spkiDer,                                  // SubjectPublicKeyInfo (already DER)
    explicit(3, seq(extList)),
  ]);

  const signature = cryptoSign('sha256', tbs, signKey); // RSASSA-PKCS1-v1_5
  return pem(seq([tbs, SIG_ALG, bitString(signature)]), 'CERTIFICATE');
}

// ── public API ────────────────────────────────────────────────

function newRsaKey() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey,
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    spkiDer: publicKey.export({ type: 'spki', format: 'der' }),
  };
}

// The CA outlives many leaves on purpose: replacing it is the expensive half.
// Today the CA key is discarded and the chain is regenerated freely, so this is
// not an operator-facing number. It becomes one in #5, when the key is
// persisted and enrolled devices trust a specific CA.
export const DEFAULT_CA_DAYS = 3650;

// Was 825. A leaf that long outlives every operator's attention: nobody
// observes a renewal before it bites, so the renewal path is never exercised
// until the day it has to work. 90 days runs it routinely. Nothing durable
// trusts the leaf -- clients hold the CA (ASM-16, verified) -- so shortening it
// costs no client action.
export const DEFAULT_LEAF_DAYS = 90;

export function createCA(cn = 'TeamClaude Local CA', days = DEFAULT_CA_DAYS) {
  const key = newRsaKey();
  const certPem = buildCert({
    subjectCN: cn, issuerCN: cn, spkiDer: key.spkiDer, signKey: key.privateKey,
    isCA: true, days,
  });
  return { cn, certPem, keyPem: key.keyPem, privateKey: key.privateKey };
}

/**
 * Load a CA back from the PEMs it was stored as, so leaves can keep being
 * issued under it.
 *
 * Without this every leaf renewal minted a new CA, because there was no key to
 * sign with — and every enrolled device broke, measured: six rotations, six
 * failures to verify, none of them survivable.
 */
export function loadCA(certPem, keyPem) {
  const cert = new X509Certificate(certPem);
  const privateKey = createPrivateKey(keyPem);
  // The two files are replaced separately, and one can be left over from an
  // earlier chain. Signing with a key that does not belong to the certificate
  // produces a leaf claiming an issuer that cannot have issued it — valid
  // bytes, unusable chain. Cheaper to refuse here than to serve it.
  const fromKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const fromCert = cert.publicKey.export({ type: 'spki', format: 'der' });
  if (!fromKey.equals(fromCert)) throw new Error('the stored CA key does not match the stored CA certificate');
  const cn = (cert.subject.match(/CN=(.*)$/m) || [, 'TeamClaude Local CA'])[1].trim();
  return { cn, certPem, keyPem, privateKey, notAfter: new Date(cert.validTo) };
}

/**
 * Issue a successor CA signed by the one it replaces (cross-signing).
 *
 * A device holds the CA it was handed at enrolment and nothing on it refreshes.
 * When the proxy rotates, serving `leaf + this` lets that device validate a leaf
 * issued by the *new* CA against the *old* one it already trusts — measured
 * `authorized=true`. It is how public CAs change roots, and it is what makes
 * rotation cost the device nothing.
 */
export function crossSignCA(successorCn, successorSpkiDer, issuer, days = DEFAULT_CA_DAYS) {
  return buildCert({
    subjectCN: successorCn, issuerCN: issuer.cn, spkiDer: successorSpkiDer,
    signKey: issuer.privateKey, isCA: true, days,
  });
}

export function createLeaf(hosts, ca, days = DEFAULT_LEAF_DAYS) {
  const list = Array.isArray(hosts) ? hosts : [hosts];
  const key = newRsaKey();
  const certPem = buildCert({
    subjectCN: list[0], issuerCN: ca.cn, spkiDer: key.spkiDer, signKey: ca.privateKey,
    isCA: false, altDnsNames: list, days,
  });
  return { certPem, keyPem: key.keyPem };
}

/**
 * Generate a device key and a PKCS#10 request for it (FR-16.3).
 *
 * The key is made here and stays here — a certificate request is the only thing
 * that can be handed to whatever signs it. A key minted on the server and sent
 * down was, for a moment, the server's, and that is a different asset with a
 * different entry in the inventory.
 *
 *   CertificationRequestInfo ::= SEQUENCE { version, subject, subjectPKInfo, [0] attributes }
 *   CertificationRequest     ::= SEQUENCE { info, signatureAlgorithm, signature }
 *
 * The attributes set is present and empty: it is not OPTIONAL in the grammar,
 * and a request without it is rejected by anything that parses strictly.
 */
export function createCsr(commonName) {
  const key = newRsaKey();
  const info = seq([
    integer(Buffer.from([0])),   // version v1
    nameCN(commonName),
    key.spkiDer,
    explicit(0, Buffer.alloc(0)),
  ]);
  const signature = cryptoSign('sha256', info, key.privateKey);
  return {
    keyPem: key.keyPem,
    publicKey: key.spkiDer,
    csrPem: pem(seq([info, SIG_ALG, bitString(signature)]), 'CERTIFICATE REQUEST'),
  };
}

/** A fresh CA plus a leaf covering `hosts`. Returns PEM strings. */
export function generateCertChain(hosts, { leafDays = DEFAULT_LEAF_DAYS, caDays = DEFAULT_CA_DAYS } = {}) {
  const ca = createCA(undefined, caDays);
  const leaf = createLeaf(hosts, ca, leafDays);
  return {
    caCertPem: ca.certPem,
    caKeyPem: ca.keyPem,
    leafCertPem: leaf.certPem,
    leafKeyPem: leaf.keyPem,
  };
}

/**
 * A successor CA, cross-signed by the CA it replaces.
 *
 * Returns the successor's own self-signed certificate (what a *newly* enrolled
 * device is handed) and the cross-signed one (what is served in the chain, so
 * devices holding the predecessor keep working).
 */
export function succeedCA(previous, { caDays = DEFAULT_CA_DAYS } = {}) {
  // A distinct name per generation, or the cross-signed certificate is
  // indistinguishable from a self-signed root: same subject, same issuer. Path
  // building then treats it as its own anchor, fails to verify it against the
  // CA the device actually trusts, and rejects the connection — measured, eight
  // rotations, eight refusals, with a valid cross-signature sitting right there.
  const next = createCA(`TeamClaude Local CA ${randomBytes(4).toString('hex')}`, caDays);
  return {
    caCertPem: next.certPem,
    caKeyPem: next.keyPem,
    crossCertPem: crossSignCA(next.cn, publicSpkiOf(next.keyPem), previous, caDays),
  };
}

/** The SubjectPublicKeyInfo DER for a private key, as buildCert wants it. */
function publicSpkiOf(keyPem) {
  return createPublicKey(keyPem).export({ type: 'spki', format: 'der' });
}
