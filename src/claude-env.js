// Percent-encode an account name (or key) for a URL, leaving ONLY the unreserved
// set. encodeURIComponent alone is not enough here: it passes `( ) ' ! *`
// through untouched, and these lines are emitted as unquoted shell `export`
// statements for `eval "$(teamclaude env)"` — a name like "work (Acme)" would be
// a shell syntax error. Clients percent-decode userinfo before using it
// (verified against Claude Code 2.1.220), so the extra escaping is transparent.
export function encodePinComponent(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Build the shell `export` lines that point Claude Code — or any tool that
// spawns it, e.g. an agent multiplexer — at the proxy. This is the same
// environment `teamclaude run` sets up, but emitted for `eval "$(teamclaude
// env)"` instead of launching claude directly. Pure and side-effect free so it
// can be unit-tested; the caller resolves the port, cert path, and holdSeconds.
//
// MITM (forward-proxy) mode is the default, matching `teamclaude run`: it routes
// ALL of claude's traffic through the proxy — even hardcoded api.anthropic.com
// endpoints (e.g. the design MCP) — with claude trusting our leaf via
// NODE_EXTRA_CA_CERTS. base-URL mode only redirects the Anthropic base URL and
// leaves other hosts alone.
//
// No ANTHROPIC_API_KEY is emitted: loopback clients are exempt from the proxy's
// key gate, and setting it would drop Claude Code out of subscription mode (and
// its full model access). Remote clients that aren't on loopback must add the
// proxy key themselves.
// `account` pins the session to one account (TC_ACCT), exactly as `teamclaude
// run` does: in MITM mode it rides in the proxy URL's userinfo and reaches the
// proxy as the CONNECT's Basic username; in base-URL mode it becomes a
// `/tc-acct/` prefix. TC_ACCT itself is then unset, so the pin does not leak
// into claude or anything it spawns — same reasoning as `run` deleting it from
// the child environment.
// `host` and `scheme` default to what a local proxy has always been, so nothing
// about `teamclaude env` or `run` changes. Enrolment against a hosted proxy
// (#19) passes its own, and the settings file it writes is derived from these
// same lines — one source, so the two configuration locations cannot disagree.
// `certPath`/`keyPath` are placed by enrolment and unused until mTLS (#6).
export function buildClaudeEnvLines({ port, useMitm = true, caPath = null, holdSeconds = 0, account = null, proxyApiKey = '', host = '127.0.0.1', scheme = 'http', certPath = null, keyPath = null }) {
  const lines = [];
  const pin = (account || '').trim();

  if (useMitm) {
    // Userinfo carries the account pin and the proxy key. With a pin it is
    // `pin:key@`; with only a key it is `key@`, which is the documented remote
    // form (`--proxy http://<key>@host:port`) and what `resolveConnectPin` reads
    // back. Emitting nothing when there is a key but no pin is what left an
    // enrolled machine getting 407 from its own proxy.
    // Both slots are always filled when there is a key, and that is measured.
    // Claude Code **silently ignores** a proxy URL whose userinfo has only one
    // component: `https://<key>@host` and `https://<key>:@host` produced no
    // request at all — no error, no traffic reaching the proxy, the run simply
    // timed out. `https://<key>:<key>@host` worked. Only `user:pass@` is used.
    //
    // The username carries the pin when there is one and the key otherwise,
    // which is what `resolveConnectPin` reads; the password always carries the
    // key, which is what `connectAuthorized` checks. So with no pin the key
    // occupies both, and every reader gets what it looks for.
    const key = (proxyApiKey || '').trim();
    const userinfo = key
      ? `${encodePinComponent(pin || key)}:${encodePinComponent(key)}@`
      : (pin ? `${encodePinComponent(pin)}:@` : '');
    const proxyUrl = `${scheme}://${userinfo}${host}:${port}`;
    lines.push(
      `export HTTPS_PROXY=${proxyUrl}`,
      `export HTTP_PROXY=${proxyUrl}`,
      `export https_proxy=${proxyUrl}`,
      `export http_proxy=${proxyUrl}`,
      'export NO_PROXY=localhost,127.0.0.1,::1',
      'export no_proxy=localhost,127.0.0.1,::1',
    );
    if (caPath) lines.push(`export NODE_EXTRA_CA_CERTS=${caPath}`);
    if (certPath) lines.push(`export CLAUDE_CODE_CLIENT_CERT=${certPath}`);
    if (keyPath) lines.push(`export CLAUDE_CODE_CLIENT_KEY=${keyPath}`);
    // Clear any stale base-URL so the two modes don't stack in one shell.
    lines.push('unset ANTHROPIC_BASE_URL');
  } else {
    const prefix = pin ? `/tc-acct/${encodePinComponent(pin)}` : '';
    lines.push(`export ANTHROPIC_BASE_URL=http://localhost:${port}${prefix}`);
  }

  // The pin is now carried by the routing itself; keep it out of the child.
  if (pin) lines.push('unset TC_ACCT');

  // Parity with `run`: if the proxy may hold the connection on exhaustion, raise
  // the client-side timeout so it doesn't give up mid-hold.
  const holdMs = (holdSeconds || 0) * 1000;
  if (holdMs > 0) lines.push(`export API_TIMEOUT_MS=${holdMs + 60_000}`);

  return lines;
}
