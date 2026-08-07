// Where the proxy is allowed to connect (#8).
//
// The tunnel branch dialled `net.connect(port, host)` with no filtering of host
// or port anywhere before it. With a valid proxy key — which in a hosted
// deployment every tenant has — that reaches any host on any port the proxy
// host can reach: cloud instance metadata at 169.254.169.254, the operator's
// private network, services bound to the proxy's own loopback precisely because
// they are loopback-only, and :22, :6379, :5432 alike.
//
// Two things make the check real rather than decorative:
//
//   1. It is applied to the **resolved address**, because an allowlisted name
//      can resolve to 169.254.169.254.
//   2. The verdict **carries** that address, so the caller connects to what was
//      checked. `net.connect(port, host)` resolves the name itself, so
//      resolve-check-then-connect-by-name resolves twice and the second answer
//      can differ from the first. Returning the address with the verdict makes
//      the safe path the only path there is.
//
// Injected through the options bag both entry points already use, exactly as
// `egress` is; `createEgressGuard` is the precedent — constructed from config,
// injected, inert when unconfigured.

import { promises as dns } from 'node:dns';
import net from 'node:net';

/**
 * Addresses the proxy will not connect to, enumerated rather than sampled.
 *
 * The spec named 127.0.0.0/8, 169.254.169.254 and the 172.16–172.31 limits,
 * which is a sample: 10/8 and 192.168/16 were simply missing (ASM-19). Every
 * IANA special-purpose range is listed here instead, because "the ones we
 * thought of" is the property that made the first list wrong.
 *
 * Each entry says why it is here, so a future reader can judge a removal.
 */
export const BLOCKED_RANGES = [
  { cidr: '0.0.0.0/8', why: 'this network — a source-only range that reaches the local host' },
  { cidr: '10.0.0.0/8', why: 'private — the operator\'s own network' },
  { cidr: '100.64.0.0/10', why: 'carrier-grade NAT — someone else\'s infrastructure' },
  { cidr: '127.0.0.0/8', why: 'loopback — services bound here are unauthenticated because they are' },
  { cidr: '169.254.0.0/16', why: 'link-local — carries cloud instance metadata at .169.254' },
  { cidr: '172.16.0.0/12', why: 'private' },
  { cidr: '192.0.0.0/24', why: 'IETF protocol assignments' },
  { cidr: '192.0.2.0/24', why: 'documentation — never a real destination' },
  { cidr: '192.168.0.0/16', why: 'private' },
  { cidr: '198.18.0.0/15', why: 'benchmarking' },
  { cidr: '198.51.100.0/24', why: 'documentation' },
  { cidr: '203.0.113.0/24', why: 'documentation' },
  { cidr: '224.0.0.0/4', why: 'multicast — not a unicast destination' },
  { cidr: '240.0.0.0/4', why: 'reserved, and carries the broadcast address' },
  { cidr: '::/128', why: 'unspecified' },
  { cidr: '::1/128', why: 'IPv6 loopback' },
  { cidr: 'fc00::/7', why: 'unique local — the IPv6 private range' },
  { cidr: 'fe80::/10', why: 'IPv6 link-local' },
  { cidr: 'ff00::/8', why: 'IPv6 multicast' },
];

/**
 * An address as bytes — 4 for v4, 16 for v6 — or null if it is not one.
 *
 * IPv4-mapped v6 (`::ffff:127.0.0.1`, and its hex form `::ffff:7f00:1`) is why
 * this exists rather than string matching: both are 127.0.0.1 wearing a hat,
 * and a check that only reads the text lets them through.
 */
export function parseIp(ip) {
  if (typeof ip !== 'string' || !ip) return null;
  const bare = ip.replace(/%.*$/, ''); // strip a zone id
  if (net.isIPv4(bare)) {
    const parts = bare.split('.').map(Number);
    return Buffer.from(parts);
  }
  if (!net.isIPv6(bare)) return null;

  // A trailing dotted quad is the v4-mapped form; fold it to two hex groups.
  let text = bare;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v4 = parseIp(dotted[1]);
    if (!v4) return null;
    text = text.slice(0, dotted.index) +
      ((v4[0] << 8 | v4[1]).toString(16)) + ':' + ((v4[2] << 8 | v4[3]).toString(16));
  }

  const [head, tail = null] = text.split('::');
  const toGroups = (s) => (s ? s.split(':').filter((x) => x !== '').map((x) => parseInt(x, 16)) : []);
  const left = toGroups(head);
  const right = tail === null ? [] : toGroups(tail);
  const groups = tail === null
    ? left
    : [...left, ...new Array(8 - left.length - right.length).fill(0), ...right];
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;

  const buf = Buffer.alloc(16);
  groups.forEach((g, i) => buf.writeUInt16BE(g, i * 2));
  return buf;
}

/** The v4 bytes inside an IPv4-mapped v6 address, or null. */
function mappedV4(bytes) {
  if (bytes.length !== 16) return null;
  const prefixZero = bytes.subarray(0, 10).every((b) => b === 0);
  if (!prefixZero) return null;
  if (bytes[10] === 0xff && bytes[11] === 0xff) return bytes.subarray(12); // ::ffff:a.b.c.d
  return null;
}

function inRange(bytes, cidr) {
  const [base, bitsText] = cidr.split('/');
  const baseBytes = parseIp(base);
  if (!baseBytes || baseBytes.length !== bytes.length) return false;
  let bits = parseInt(bitsText, 10);
  for (let i = 0; i < bytes.length && bits > 0; i++) {
    const take = Math.min(8, bits);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (baseBytes[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

/**
 * Why this address may not be dialled, or null when it may be.
 *
 * A v4-mapped v6 address is judged as the v4 address it carries, so
 * `::ffff:169.254.169.254` cannot walk past a v4-only list.
 */
export function blockedAddressReason(ip) {
  const bytes = parseIp(ip);
  if (!bytes) return `not an address: ${ip}`;
  const v4 = mappedV4(bytes);
  const subject = v4 || bytes;
  for (const r of BLOCKED_RANGES) {
    const baseBytes = parseIp(r.cidr.split('/')[0]);
    if (!baseBytes || baseBytes.length !== subject.length) continue;
    if (inRange(subject, r.cidr)) return `${r.cidr} — ${r.why}`;
  }
  return null;
}

/**
 * A `lookup` that answers with the addresses the policy approved, and nothing
 * else.
 *
 * Handing this to `net.connect`/`http.request` keeps Node's own connection
 * logic — including the fallback between a v6 and a v4 answer — while making a
 * second resolution impossible. Rewriting the target to an address instead
 * would lose the name, and with it the Host header and the TLS servername.
 */
export function pinnedLookup(addresses) {
  return (_hostname, options, cb) => {
    if (options && options.all) return cb(null, addresses.map((a) => ({ address: a.address, family: a.family })));
    return cb(null, addresses[0].address, addresses[0].family);
  };
}

const isLoopbackHost = (h) => !h || h === '127.0.0.1' || h === '::1' || h === 'localhost';

function upstreamHostOf(config) {
  try { return new URL(config?.upstream || 'https://api.anthropic.com').hostname; }
  catch { return 'api.anthropic.com'; }
}

/**
 * The shipped allowlist, composed by running a client rather than guessed
 * (FR-07.5). Each entry says why it is here and how it got here.
 *
 * Two `claude -p` runs through a report-only proxy — one plain, one using
 * tools — reached exactly three hosts: `api.anthropic.com` (intercepted, not
 * listed here because it comes from `upstream`), and the two below. A third
 * run with this list enforced completed normally.
 */
export const SHIPPED_ALLOW = [
  { host: 'downloads.claude.ai',
    why: 'plugin downloads and self-update. Not seen in these runs — the update check did not '
       + 'fire in the window — but refusing it breaks self-update, which then collides with the '
       + 'client version floor (#16): clients drift below it and are locked out with no way back' },
  { host: 'mcp-proxy.anthropic.com',
    why: 'observed on every run. Claude Code reaches remote MCP servers through it' },
];

/**
 * A user's own MCP servers are **not** here and cannot be. The enforced run
 * refused exactly one destination — `mcp.notion.com`, from this machine's
 * `.mcp.json` — which is the shape of entry an operator adds and a release
 * cannot know. It is the reason FR-07.3 requires the allowlist to be data.
 */

/** The built-in host answered locally so the CA can be checked without credentials. */
export const TEST_HOST = 'www.example.org';

/**
 * Resolve the switches, deriving every default from `proxy.host`.
 *
 * Bound to loopback, today's behaviour is preserved: the local proxy has always
 * been a general forward proxy and closing that by default would be a silent
 * break for everyone using it. Bound anywhere else, every switch defaults to
 * the closed position — so an operator cannot arrive at the unsafe combination
 * by omission, only deliberately.
 */
export function connectPolicyDefaults(config) {
  const local = isLoopbackHost(config?.proxy?.host ?? '127.0.0.1');
  const c = config?.proxy?.connect || {};
  return {
    local,
    allow: [...SHIPPED_ALLOW.map((e) => e.host), ...(c.allow || []).map(String)]
      .map((h) => h.toLowerCase()),
    tunnelUnlisted: local,                                       // FR-07.1
    // NFR-21.1, and derived like the rest. A loopback-bound proxy tunnelling to
    // 127.0.0.1 is the operator reaching their own machine, and closing that by
    // default would break every existing local user — the blind-tunnel tests
    // caught exactly that. Off-box it is the SSRF this requirement exists for.
    allowPrivateAddresses: c.allowPrivateAddresses ?? local,
    allowLoopbackClients: c.allowLoopbackClients ?? local,       // NFR-20.2
    testHost: c.testHost ?? local,                               // FR-07.6
    // NFR-21.3, derived like the rest. A local proxy has always tunnelled to
    // any port and people use it for that; the blind-tunnel tests dial an
    // ephemeral one. Off-box, :22, :6379 and :5432 are exactly the reach this
    // requirement exists to remove.
    restrictPorts: c.restrictPorts ?? !local,
  };
}

export function createDestinationPolicy(config, { lookup = null, log = () => {} } = {}) {
  const opts = connectPolicyDefaults(config);
  const upstreamHost = upstreamHostOf(config).toLowerCase();
  const resolve = lookup || ((host) => dns.lookup(host, { all: true, verbatim: true }));

  const refuse = (reason, detail) => ({ action: 'refuse', reason, detail });

  return {
    options: opts,

    /**
     * @returns {Promise<
     *   | { action: 'intercept', mode: 'rewrite'|'test' }
     *   | { action: 'tunnel', address: string, family: 4|6 }
     *   | { action: 'refuse', reason: 'not_allowed'|'address_blocked'|'port_not_allowed', detail: string }
     * >}
     */
    async classify(host, port, { ports = [443] } = {}) {
      const name = String(host || '').toLowerCase();
      if (name === upstreamHost) return { action: 'intercept', mode: 'rewrite' };
      if (name === TEST_HOST && opts.testHost) return { action: 'intercept', mode: 'test' };

      if (!opts.tunnelUnlisted && !opts.allow.includes(name)) {
        return refuse('not_allowed', `${host} is not on the allowlist`);
      }
      // Before the lookup: a destination that can never be allowed should not
      // cost a DNS round trip, and should not be observable as one either.
      if (opts.restrictPorts && !ports.includes(Number(port))) {
        return refuse('port_not_allowed',
          `${host}:${port} — destinations are limited to port ${ports.join(' or ')}`);
      }

      // A literal address is already resolved. Handing it to a resolver would
      // be a round trip to be told what we were given, and would make the
      // address policy depend on DNS answering at all.
      let answers;
      if (net.isIP(name)) {
        answers = [{ address: name, family: net.isIPv6(name) ? 6 : 4 }];
      } else {
        try {
          answers = await resolve(name);
        } catch (err) {
          return refuse('not_allowed', `${host} could not be resolved: ${err.code || err.message}`);
        }
      }
      if (!answers?.length) return refuse('not_allowed', `${host} resolved to nothing`);

      // NFR-21.5 — any blocked answer refuses the whole name. Picking the public
      // one from a mixed answer would leave the refusal decidable by whichever
      // address the resolver happened to return first.
      if (!opts.allowPrivateAddresses) {
        for (const a of answers) {
          const why = blockedAddressReason(a.address);
          if (why) {
            log(`[TeamClaude] refused ${host}: resolves to ${a.address} — ${why}`);
            return refuse('address_blocked', `${host} resolves to a blocked address (${why})`);
          }
        }
      }
      // Every approved address, not just the first. `net.connect(port, name)`
      // used to try them in turn — `localhost` answers ::1 before 127.0.0.1 on
      // some hosts, and a service bound only to v4 is still reachable. Picking
      // one address silently dropped that fallback, which the pin tests caught
      // as a 502. The caller dials these in order and no others.
      const approved = answers.map((a) => ({ address: a.address, family: a.family }));
      return { action: 'tunnel', address: approved[0].address, family: approved[0].family, addresses: approved };
    },
  };
}
