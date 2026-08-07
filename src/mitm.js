// MITM forward-proxy support: local cert lifecycle + terminating CONNECT proxy.
//
// When a claude instance is launched with HTTPS_PROXY pointed at teamclaude it
// sends `CONNECT api.anthropic.com:443`. Rather than byte-relaying the tunnel, we
// TERMINATE it with a real Node HTTP/2 server (allowHTTP1, so an h1 client works
// too) presenting our locally-minted leaf, then forward each request with a
// buffering, retrying client — the SAME path the base proxy uses
// (createProxyRequestListener). That gives per-request account selection, body
// account_uuid rewriting, and — critically — the ability to resend a request on a
// different account when one returns a quota 429, instead of surfacing it. A host
// routing table decides per-CONNECT behavior:
//   api.anthropic.com → terminate + forward,  www.example.org → local test server,
//   anything else      → blind tunnel.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { dirname, join } from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import http2 from 'node:http2';
import { getConfigPath } from './config.js';
import { generateCertChain, DEFAULT_LEAF_DAYS } from './x509.js';
import { createDestinationPolicy, pinnedLookup, TEST_HOST } from './destination-policy.js';
import { createProxyRequestListener, safeKeyEqual, isLoopbackAddr, relayUpgrade, resolveAccountPin } from './server.js';

const CA_CERT = 'teamclaude-ca.pem';
const LEAF_CERT = 'teamclaude-leaf.pem';
const LEAF_KEY = 'teamclaude-leaf.key';

// A built-in host the MITM proxy intercepts and answers itself (never forwarded
// upstream). Lets you verify the proxy + CA end-to-end with no credentials:
//   curl --proxy http://localhost:3456 --cacert <ca.pem> https://www.example.org/
//
// Defined by the destination policy, which is what decides whether it is
// intercepted at all — off by default when the listener is not on loopback
// (FR-07.6), since answering for a domain we do not own is not acceptable on a
// shared node. Re-exported so existing importers are unaffected.
export { TEST_HOST };

const certDir = () => dirname(getConfigPath());
const fpath = (n) => join(certDir(), n);

/** Path to the CA cert clients should trust via NODE_EXTRA_CA_CERTS. */
export function caCertPath() {
  return fpath(CA_CERT);
}

async function readIf(p) {
  try { return await readFile(p, 'utf8'); } catch { return null; }
}

async function atomicWrite(path, data, mode) {
  const tmp = `${path}.tmp${process.pid}`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shipped certificate policy. See `proxy.certs` in docs/configuration.md. */
export const CERT_DEFAULTS = Object.freeze({
  leafDays: DEFAULT_LEAF_DAYS,
  renewBeforeDays: 30,
});

const positiveDays = (v, fallback) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback);

/**
 * Resolve `proxy.certs` against the shipped defaults.
 *
 * `clamped` is the operator's renewBeforeDays when it had to be overridden, so
 * the caller can say so. A window at least as wide as the lifetime makes every
 * freshly minted certificate immediately due for renewal, and ensureCerts would
 * then regenerate the chain on every CONNECT forever. Half the lifetime still
 * renews early and terminates.
 */
export function certOptions(config) {
  const certs = config?.proxy?.certs || {};
  const leafDays = positiveDays(certs.leafDays, CERT_DEFAULTS.leafDays);
  const asked = positiveDays(certs.renewBeforeDays, CERT_DEFAULTS.renewBeforeDays);
  if (asked < leafDays) return { leafDays, renewBeforeDays: asked, clamped: null };
  return { leafDays, renewBeforeDays: Math.max(1, Math.floor(leafDays / 2)), clamped: asked };
}

function expiryProblem(what, cert, renewBeforeDays) {
  const notAfter = new Date(cert.validTo).getTime();
  if (!Number.isFinite(notAfter)) return `the ${what} has no readable expiry date`;
  const left = (notAfter - Date.now()) / DAY_MS;
  if (left <= 0) return `the ${what} has expired`;
  if (left <= renewBeforeDays) {
    return `the ${what} is due for renewal — ${left.toFixed(1)} days left, window ${renewBeforeDays}`;
  }
  return null;
}

/**
 * Why the stored chain cannot be reused, in words, or null when it can be.
 *
 * The old check read two things — signed by our CA, covers the hosts — and no
 * dates at all. So an expired leaf still satisfied it: the signature was intact
 * and the SANs matched, and `ensureCerts` handed it to the terminating server
 * while every intercepted TLS connection failed. The only recovery was deleting
 * the files by hand, and nothing warned as the date approached, because nothing
 * looked at the date (#21).
 *
 * A string rather than a boolean because silent regeneration is how that went
 * unnoticed for as long as it did (NFR-17.3).
 */
export function certReuseProblem(caCertPem, leafCertPem, hosts, { renewBeforeDays } = {}) {
  let ca, leaf;
  try {
    ca = new X509Certificate(caCertPem);
    leaf = new X509Certificate(leafCertPem);
  } catch (err) {
    return `the stored chain could not be read — ${err.message}`;
  }
  if (!leaf.verify(ca.publicKey)) return 'the leaf is not signed by the stored CA';

  const names = (leaf.subjectAltName || '').split(',').map((s) => s.trim());
  const missing = hosts.filter((h) => !names.includes(`DNS:${h}`));
  if (missing.length) return `the leaf does not cover ${missing.join(', ')}`;

  // The CA first: a leaf's own dates say nothing about the certificate that
  // signed it, and a fresh leaf under a lapsed CA is just as unusable (NFR-17.2).
  return expiryProblem('CA', ca, renewBeforeDays) || expiryProblem('leaf', leaf, renewBeforeDays);
}

/**
 * Ensure a CA cert + a leaf for `host` exist in the config dir, generating them
 * if missing/mismatched. The CA *private* key is never persisted — we regenerate
 * the whole chain when needed, so the only on-disk secret is the leaf key (0600),
 * which only authenticates as `host` to a process that already trusts our CA.
 * Returns { caPath, caCertPem, leafCertPem, leafKeyPem }.
 */
// Said once, not once per connection. Nothing memoises the renewal check any
// more (NFR-17.5), so this function runs on every intercepted CONNECT — and a
// misconfiguration that never changes would otherwise print on every one of
// them. Keyed by the value so editing the config still gets an answer.
let warnedClamp = null;

export async function ensureCerts(host, { config = null, log = () => {} } = {}) {
  const hosts = host === TEST_HOST ? [TEST_HOST] : [host, TEST_HOST];
  const opts = certOptions(config);
  if (opts.clamped !== null && warnedClamp !== opts.clamped) {
    warnedClamp = opts.clamped;
    log(`[TeamClaude] proxy.certs.renewBeforeDays ${opts.clamped} is not shorter than leafDays ` +
        `${opts.leafDays}, which would renew on every connection — using ${opts.renewBeforeDays}`);
  }
  const [caCertPem, leafCertPem, leafKeyPem] = await Promise.all([
    readIf(fpath(CA_CERT)), readIf(fpath(LEAF_CERT)), readIf(fpath(LEAF_KEY)),
  ]);

  if (caCertPem && leafCertPem && leafKeyPem) {
    const problem = certReuseProblem(caCertPem, leafCertPem, hosts, opts);
    if (!problem) return { caPath: fpath(CA_CERT), caCertPem, leafCertPem, leafKeyPem };
    log(`[TeamClaude] regenerating the MITM certificate chain: ${problem}`);
  } else {
    log(`[TeamClaude] minting a MITM certificate chain for ${hosts.join(', ')} ` +
        `(${opts.leafDays}-day leaf, renewing ${opts.renewBeforeDays} days early)`);
  }

  const chain = generateCertChain(hosts, { leafDays: opts.leafDays }); // caKeyPem intentionally discarded
  await mkdir(certDir(), { recursive: true });
  await atomicWrite(fpath(CA_CERT), chain.caCertPem, 0o644);
  await atomicWrite(fpath(LEAF_CERT), chain.leafCertPem, 0o644);
  await atomicWrite(fpath(LEAF_KEY), chain.leafKeyPem, 0o600);
  return {
    caPath: fpath(CA_CERT),
    caCertPem: chain.caCertPem,
    leafCertPem: chain.leafCertPem,
    leafKeyPem: chain.leafKeyPem,
  };
}


/**
 * Build a `connect` event handler implementing the terminating MITM described at
 * the top of this file.
 * @param ensureLeaf async () => { key, cert }   // current leaf PEMs, re-read per call
 */
export function createConnectHandler({ config, accountManager, ensureLeaf, logDir = null, hooks = {}, log = () => {}, sx = null, egress = null, policy = null }) {
  const upstream = config.upstream || 'https://api.anthropic.com';
  const proxyApiKey = config.proxy?.apiKey;
  // Injected, but never absent in practice — a handler built without one would
  // be the unrestricted forward proxy this exists to close, so it makes its own.
  const destinations = policy || createDestinationPolicy(config, { log });
  const allowLoopbackClients = destinations.options.allowLoopbackClients;
  const holdMs = (config.holdSeconds || 0) * 1000;

  // One terminating h2/h1 server per pin, minted lazily on the first intercepted
  // CONNECT that needs it (key '' = unpinned, the common case).
  // TLS uses our leaf; ALPN negotiates h2 or http/1.1 (allowHTTP1) with whatever
  // the client offers. It emits 'request' for BOTH protocols, so `forward` — the
  // shared buffering/retrying proxy listener — handles them identically. Each
  // CONNECT feeds it the raw tunnel socket; the client keeps the tunnel open and
  // multiplexes many requests over it, each independently account-selected.
  //
  // Keying by pin is what carries a TC_ACCT pin from the CONNECT to the requests
  // inside the tunnel. The alternative — tagging the raw socket and reading it
  // back from the request — means digging through a TLSSocket and, under h2, a
  // Proxy over the session socket. A listener bound to the account is the same
  // information with none of that. The map is bounded by the account count.
  //
  // The entry carries the leaf it was minted with. A terminating server bakes
  // its certificate in at creation, so a memo keyed by pin alone would keep
  // serving a superseded chain for the life of the process — renewal would
  // happen on disk and never reach a client (NFR-17.5).
  //
  // A superseded server is dropped rather than closed. Sockets already handed to
  // it keep their session: TLS validates at handshake, measured — traffic flowed
  // 2s past `notAfter` on an established connection while a new one was refused
  // (ASM-17) — so a tunnel opened before a renewal is not disturbed by one.
  const serverPromises = new Map();
  const getServer = (pin, key, cert) => {
    const cached = serverPromises.get(pin);
    if (cached && cached.cert === cert) return cached.promise;
    const entry = { cert, promise: null };
    entry.promise = (async () => {
    const srv = http2.createSecureServer({ key, cert, allowHTTP1: true });
    srv.on('request', createProxyRequestListener({ accountManager, upstream, logDir, hooks, sx, holdMs, config, forcedPin: pin || null, egress }));
    // Remote Control's real-time channel is a WebSocket (Upgrade handshake),
    // which never fires 'request' — only 'upgrade', with a raw socket instead
    // of a response object (h1-only; falls back to blind h2 passthrough is not
    // needed since WS clients negotiate h1 for the handshake).
    srv.on('upgrade', (req, socket, head) => relayUpgrade(req, socket, head, upstream, sx));
    srv.on('sessionError', (e) => log(`[TeamClaude] MITM session error: ${e.message}`));
    srv.on('clientError', (e, sock) => { try { sock.destroy(); } catch { /* already gone */ } });
    return srv;
    })().catch((err) => {
      // Don't let a transient cert/disk failure poison the memo forever: drop it
      // so the next intercepted CONNECT retries instead of re-awaiting a cached
      // rejection (which would leave the MITM path dead until a restart).
      // Only if it is still ours — a renewal may already have replaced it.
      if (serverPromises.get(pin) === entry) serverPromises.delete(pin);
      throw err;
    });
    serverPromises.set(pin, entry);
    return entry.promise;
  };

  return async (req, clientSocket, head) => {
    clientSocket.on('error', () => {});

    // Auth gate — mirror the HTTP path: loopback is exempt, everything else must
    // present the proxy apiKey via Proxy-Authorization. Without this, a remote
    // client can CONNECT api.anthropic.com and have a rotated ACCOUNT TOKEN
    // injected (token theft), or blind-tunnel to arbitrary hosts (open relay /
    // SSRF) — the HTTP path already blocks the equivalent for remote clients.
    if (!connectAuthorized(req, clientSocket, proxyApiKey, { allowLoopbackClients })) {
      try {
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="teamclaude"\r\nConnection: close\r\n\r\n');
      } catch { /* client already gone */ }
      clientSocket.destroy();
      return;
    }

    const [host, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr, 10) || 443;

    // FR-07.1 — every destination is classified, and refusal is the default.
    // The verdict carries the address it approved so nothing below re-resolves.
    const verdict = await destinations.classify(host, port);
    if (verdict.action === 'refuse') {
      // FR-07.4 — a status line and nothing else. The tunnel never opens, so
      // there is no body to carry an envelope, and no socket is dialled.
      log(`[TeamClaude] refused CONNECT ${host}:${port} — ${verdict.detail}`);
      try {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      } catch { /* client already gone */ }
      clientSocket.destroy();
      return;
    }
    const mode = verdict.action === 'tunnel' ? 'tunnel' : verdict.mode;

    if (mode === 'tunnel') {
      // Until the upstream connects we still owe the client a CONNECT status
      // line. If we tore the socket down on an upstream failure without one,
      // the client reports "Proxy connection ended before receiving CONNECT
      // response" — so before the tunnel is live, surface failures as a real
      // proxy error status instead of a silent drop.
      let established = false, closed = false;
      // Tear down BOTH sockets when either errors or closes, so a one-sided
      // failure can't leave the paired socket lingering (FD leak). The `closed`
      // guard makes it idempotent (error+close both fire) and ensures we write
      // at most one status line.
      const teardown = (statusLine) => {
        if (closed) return;
        closed = true;
        if (!established && statusLine) {
          try { clientSocket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`); } catch { /* client already gone */ }
        }
        up.destroy(); clientSocket.destroy();
      };
      // NFR-21.2 — the name still travels, but resolution cannot happen twice:
      // `lookup` answers only with what the policy approved.
      const up = net.connect({ port, host, lookup: pinnedLookup(verdict.addresses) }, () => {
        established = true;
        reply200Raw(clientSocket);
        if (head && head.length) up.write(head);
        up.pipe(clientSocket); clientSocket.pipe(up);
      });
      up.on('error', (err) => {
        if (!established) log(`[TeamClaude] tunnel ${host}:${port} failed: ${err.message}`);
        teardown('502 Bad Gateway');
      });
      // A FIN before the tunnel is live (no preceding 'error') is still a failed
      // dial from the client's view — surface a 502 rather than a silent drop.
      up.on('close', () => teardown('502 Bad Gateway'));
      clientSocket.on('close', () => teardown()); // client gone: nothing to write
      up.setTimeout(30_000, () => teardown('504 Gateway Timeout')); // bound a stalled connect/idle tunnel
      return;
    }

    if (mode === 'test') {
      // The built-in test host is answered locally, never forwarded upstream.
      ensureLeaf().then(({ key, cert }) => {
        reply200Raw(clientSocket);
        serveTest(termClaude(clientSocket, head, key, cert, ['http/1.1']));
      }).catch((err) => { log(`[TeamClaude] MITM ${host}: ${err.message}`); reply502Raw(clientSocket); clientSocket.destroy(); });
      return;
    }

    // rewrite: terminate the tunnel and forward each request with buffering +
    // retry. Reply 200, hand the raw socket (ClientHello and all) to the h2/h1
    // server, which does TLS + protocol negotiation itself. If the terminating
    // server can't be minted (cert/disk/TLS-init failure) we haven't replied yet
    // — send a 502 so the client sees a real proxy error instead of "Proxy
    // connection ended before receiving CONNECT response".
    // Pin resolution is deliberately confined to `rewrite`. Clients send
    // Proxy-Authorization on EVERY CONNECT, including blind-tunneled third-party
    // hosts, where an account pin is meaningless — rejecting there would take
    // down unrelated traffic over a typo meant for Anthropic.
    const { pin, error } = resolveConnectPin(req, accountManager, proxyApiKey);
    if (error) {
      log(`[TeamClaude] CONNECT ${host}: ${error}`);
      try {
        clientSocket.write(`HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="teamclaude"\r\nConnection: close\r\n\r\n`);
      } catch { /* client already gone */ }
      clientSocket.destroy();
      return;
    }

    ensureLeaf().then(({ key, cert }) => getServer(pin || '', key, cert)).then((srv) => {
      reply200Raw(clientSocket);
      if (head && head.length) clientSocket.unshift(head);
      srv.emit('connection', clientSocket);
    }).catch((err) => { log(`[TeamClaude] MITM ${host}: ${err.message}`); reply502Raw(clientSocket); clientSocket.destroy(); });
  };
}

// The Basic username from a CONNECT's `Proxy-Authorization`, or null. This is
// the only pin channel expressible in an HTTPS_PROXY URL, which is what
// `teamclaude run` has to work with in MITM mode (there is no request path to
// carry a `/tc-acct/` prefix — inside the tunnel the path is the real upstream
// one). Clients send this preemptively on every CONNECT.
export function connectPinToken(req) {
  const header = (req?.headers?.['proxy-authorization'] || '').trim();
  if (!header.toLowerCase().startsWith('basic ')) return null;
  const dec = Buffer.from(header.slice('basic '.length).trim(), 'base64').toString('utf8'); // "user:pass"
  const colon = dec.indexOf(':');
  return (colon >= 0 ? dec.slice(0, colon) : dec) || null;
}

/**
 * Resolve the account pin on a CONNECT, or a rejection reason.
 *
 * The username slot is overloaded: the documented remote form is
 * `--proxy http://<key>@host:port`, where it holds the proxy apiKey, not an
 * account. So the key wins over any account of the same name — an operator who
 * names an account after their proxy key gets auth, not a surprise pin.
 *
 * An unrecognized username is an ERROR rather than a silently ignored pin: a
 * typo'd account name that quietly served from the wrong account is exactly the
 * failure mode this feature exists to remove.
 *
 * @returns {{pin: string|null, error: string|null}}
 */
export function resolveConnectPin(req, accountManager, proxyApiKey) {
  const token = connectPinToken(req);
  if (!token) return { pin: null, error: null };
  if (proxyApiKey && safeKeyEqual(token, proxyApiKey)) return { pin: null, error: null };
  if (resolveAccountPin(accountManager, token) == null) {
    return { pin: null, error: `Unknown account pin "${token}"` };
  }
  return { pin: token, error: null };
}

// Authorize a CONNECT: no key configured → open (matches the HTTP path); a
// loopback client is exempt; otherwise the proxy apiKey must be presented via
// `Proxy-Authorization` (Bearer <key>, or Basic where the key is the username
// or password — so `--proxy http://<key>@host:port` works). Exported for tests.
export function connectAuthorized(req, socket, proxyApiKey, { allowLoopbackClients = true } = {}) {
  if (!proxyApiKey) return true;
  // NFR-20.2 — right for a local proxy, where the operator's own machine is the
  // client. On a hosted node it means anything sharing that loopback interface
  // — a sidecar, another container in the same namespace, a compromised process
  // — is unauthenticated, so it defaults off whenever the listener is not bound
  // to loopback.
  if (allowLoopbackClients && isLoopbackAddr(socket?.remoteAddress)) return true;
  const m = /^\s*(basic|bearer)\s+(.+?)\s*$/i.exec(req?.headers?.['proxy-authorization'] || '');
  if (!m) return false;
  let presented = m[2];
  if (m[1].toLowerCase() === 'basic') {
    const dec = Buffer.from(m[2], 'base64').toString('utf8'); // "user:pass"
    const i = dec.indexOf(':');
    const user = i >= 0 ? dec.slice(0, i) : dec;
    const pass = i >= 0 ? dec.slice(i + 1) : '';
    presented = pass || user;
  }
  return safeKeyEqual(presented, proxyApiKey);
}

function reply200Raw(sock) { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); }
function reply502Raw(sock) { try { sock.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); } catch { /* client already gone */ } }

function termClaude(clientSocket, head, key, cert, alpn) {
  if (head && head.length) clientSocket.unshift(head);
  const t = new tls.TLSSocket(clientSocket, { isServer: true, key, cert, ALPNProtocols: alpn });
  t.on('error', () => t.destroy());
  return t;
}

// Answer the built-in test host locally over h1 with a canned JSON response.
function serveTest(tlsSock) {
  let buf = Buffer.alloc(0);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const idx = buf.indexOf('\r\n\r\n');
    if (idx < 0) { if (buf.length > 65536) tlsSock.destroy(); return; }
    tlsSock.removeListener('data', onData);
    const reqLine = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1');
    const path = reqLine.split(' ')[1] || '/';
    const body = JSON.stringify({ teamclaude: 'mitm-proxy-ok', host: TEST_HOST, path });
    tlsSock.end(
      `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
    );
  };
  tlsSock.on('data', onData);
  tlsSock.on('error', () => tlsSock.destroy());
}
