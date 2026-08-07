# Configuration

## Where it lives

Config is stored at `~/.config/teamclaude.json` (or `$XDG_CONFIG_HOME/teamclaude.json`). A random proxy API key is generated on first use.

Volatile runtime state (observed quota) is written separately to `teamclaude.state.json` alongside the config, so the config file stays clean and hand-editable. The state file is safe to delete — quota is simply re-learned from traffic.

## Format

```json
{
  "proxy": {
    "port": 3456,
    "apiKey": "tc-auto-generated-key"
  },
  "upstream": "https://api.anthropic.com",
  "switchThreshold": 0.98,
  "sx": { "apiKey": "your-sx-org-api-key", "mode": "always" },
  "accounts": [
    {
      "name": "user@example.com (Acme)",
      "type": "oauth",
      "accountUuid": "...",
      "orgUuid": "...",
      "orgName": "Acme",
      "priority": 0,
      "accessToken": "sk-ant-oat01-...",
      "refreshToken": "sk-ant-ort01-...",
      "expiresAt": 1774384968427
    }
  ]
}
```

## Fields

| Field | Description |
| --- | --- |
| `proxy.port` | Local port the proxy listens on |
| `proxy.host` | Interface to bind. Defaults to `127.0.0.1` (localhost only). Set to `0.0.0.0` (or override with env `TEAMCLAUDE_HOST`) to accept off-box clients — in which case **set `proxy.apiKey`**, since remote clients must present it (via `x-api-key`, or `Proxy-Authorization` for CONNECT/HTTPS-proxy usage); loopback is always exempt |
| `proxy.apiKey` | API key clients use to authenticate with the proxy (required for any non-loopback client; the proxy injects real account tokens, so an unauthenticated open port would leak them) |
| `proxy.tls` | Serve the proxy itself over TLS: `{ "cert": "/path/fullchain.pem", "key": "/path/privkey.pem", "ca": "optional-chain.pem" }`. **Set this whenever `proxy.host` is not loopback** — on a plain listener `proxy.apiKey` travels in clear on every request (`x-api-key`) and every `CONNECT` (`Proxy-Authorization`), and that key is permission to have account tokens injected. Clients then use `https://host:port` (Claude Code accepts an `https://` proxy URL). Paths are re-read only at startup, so reload after an ACME renewal; an unreadable file is a startup error rather than a silent fall back to plaintext |
| `proxy.connect` | Where the proxy may connect: `{ "allow": [], "allowPrivateAddresses": …, "allowLoopbackClients": …, "restrictPorts": …, "testHost": … }`. **Every default derives from `proxy.host`** — on loopback nothing changes from how the proxy has always behaved; bound anywhere else each one starts closed. See [Where the proxy may connect](#where-the-proxy-may-connect) |
| `proxy.certs` | Lifetime of the MITM certificate chain the proxy mints for itself: `{ "leafDays": 90, "renewBeforeDays": 30 }` (the defaults). The leaf is replaced once it has fewer than `renewBeforeDays` left, so renewal happens before anything breaks rather than at the moment it does — see [MITM certificates](#mitm-certificates) |
| `upstream` | Upstream API base URL |
| `switchThreshold` | Quota utilization (0–1) at which to switch accounts (TUI settings screen: **Switch threshold**) |
| `quotaProbeSeconds` | Background [quota-probe](quota.md#quota-probe) interval in seconds (`0` = off, the default; CLI `probe`, or the **Quota probe** row on the TUI settings screen) |
| `warmupSeconds` | [Keep-warm](quota.md#keep-warm) interval in seconds (`0` = off, the default; CLI `warmup`). Spawns a minimal `claude` per idle account to start its 5h timer — **spends a little quota**, unlike the probe |
| `holdSeconds` | Maximum seconds to [hold the connection](quota.md#hold-on-exhaustion) when all accounts are exhausted, polling silently until one recovers (`0` = return 429 immediately, the default). `teamclaude run` raises `API_TIMEOUT_MS` automatically to match |
| `distributeSessions` | Spread concurrent Claude Code sessions across equal-priority accounts, each session pinned to one account for cache reuse (`false` = quota-driven rotation only, the default). Session tracking and readout is always on regardless — see [Session-aware routing](routing.md#session-aware-routing) |
| `eventLogging` | How to handle Claude Code's telemetry (`/api/event_logging/*`), which is high-volume activity-log noise: `hide` (default) forwards it but keeps it out of the activity log; `block` answers `200` locally without forwarding (no upstream round-trip); `show` forwards and displays it |
| `blockedModels` | Array of model glob patterns (e.g. `["*fable*"]`) whose requests are rejected with a fast, non-retryable `400` instead of being forwarded — avoids a model no account can serve getting rate-limited upstream and hanging the pipeline. Empty (the default) blocks nothing |
| `stormRamp` | Optional [storm-control](routing.md#storm-control) tuning (on by default). Object: `{ enabled, startConc, stepConc, stepMs, windowMs }` |
| `routes` | Optional list of [routing rules](routing.md#model-routes) that pin model patterns to specific accounts |
| `autoUpdate` | Set to `false` to disable the background [self-update](usage.md#auto-update) check |
| `upstreamProxy` | Outbound HTTP proxy for **everything TeamClaude sends to Anthropic** — request forwarding, OAuth login, token refresh, profile and usage. `"http://user:pass@host:3128"`, or just `"host:3128"`. `false` disables it *and* ignores the environment. Unset = use `HTTPS_PROXY`/`ALL_PROXY` if present. TUI settings screen: **Upstream proxy**. See [Upstream proxy](proxy-modes.md#upstream-proxy) |
| `noProxy` | Comma-separated hosts that bypass `upstreamProxy` (suffix match, `*` = all). Defaults to `NO_PROXY` from the environment |
| `sx.apiKey` | [sx.org](https://sx.org) API key. When set, TeamClaude auto-provisions a residential proxy (egress-IP 429 workaround). Absent/empty = off — see [sx.org proxy mode](proxy-modes.md#sxorg-proxy-mode) |
| `sx.mode` | `always` (route all upstream traffic), `429` (direct, fail over to the proxy after a 429), or `off` (keep the key but don't use it). Defaults to `always` when a key is set |
| `accounts[].accountUuid` | Anthropic account (person) id; set automatically from the OAuth profile |
| `accounts[].orgUuid` / `orgName` | Organization the account is scoped to — lets one email hold multiple org accounts |
| `accounts[].priority` | Rotation preference, lower = preferred (default 0) |
| `accounts[].disabled` | If `true`, the account is excluded from rotation until re-enabled |
| `accounts[].upstream` | Alternative upstream base URL for this account (e.g. `https://api.deepseek.com/anthropic`). Overrides the global `upstream` for this account only — see [third-party backends](accounts.md#third-party-backend-accounts) |
| `accounts[].modelMap` | Object mapping Anthropic model names to this backend's model names (e.g. `{"claude-sonnet-4-6": "deepseek-v4-pro[1m]"}`). Applied automatically when requests are routed to this account |
| `accounts[].models` | **Deprecated** — use a [`routes`](routing.md#model-routes) entry with `match` and `accounts` instead. Array of model names this account exclusively handles; kept for backward compatibility with pre-routes configs |

## Environment variables

| Variable | Effect |
| --- | --- |
| `TC_ACCT` | [Pin a session](routing.md#pin-a-session-to-one-account) to **one** account, bypassing rotation. Accepts `accountUuid`, `orgUuid`, `accountUuid/orgUuid`, or a display name/email. Read by `teamclaude run` and `teamclaude env`, then removed from the environment so it never reaches claude |
| `TEAMCLAUDE_CONFIG` | Path to the config file (default `~/.config/teamclaude.json`) |
| `TEAMCLAUDE_HOST` | Override `proxy.host` |
| `TEAMCLAUDE_DISABLE_AUTOUPDATE` | Set to `1` to skip the background self-update check |
| `HTTPS_PROXY` / `ALL_PROXY` | Outbound proxy used when the config sets no `upstreamProxy` (lowercase forms honoured too) |
| `NO_PROXY` | Hosts that bypass the outbound proxy, when the config sets no `noProxy` |

```bash
TEAMCLAUDE_CONFIG=./my-config.json teamclaude server
```

## Where the proxy may connect

A forward proxy will connect wherever it is told to. On loopback that is the point — it is your machine reaching your network. Bound to an interface other people can reach, it means **any client holding `proxy.apiKey` can use this host's network position as their own**, with this host's address as the source: cloud instance metadata on `169.254.169.254`, anything on the private network, services bound to this host's loopback precisely because they are loopback-only, and any port at all.

So every switch below **derives its default from `proxy.host`**. On loopback, nothing changes. Bound anywhere else, each starts closed, and an operator can only arrive at the open combination deliberately.

| Key | On loopback | Bound elsewhere | What it controls |
| --- | --- | --- | --- |
| `allow` | ignored — everything tunnels | the only hosts that tunnel | Extra destinations, as **exact hostnames**. No wildcard form: `*.claude.ai` would admit any host an attacker can get named in that zone |
| `allowPrivateAddresses` | `true` | `false` | Whether a destination may resolve to a loopback, link-local or private address |
| `restrictPorts` | `false` | `true` | Whether tunnels are limited to port 443 |
| `allowLoopbackClients` | `true` | `false` | Whether a client on this host's loopback skips `proxy.apiKey`. Off-box that means any sidecar or container sharing the namespace |
| `testHost` | `true` | `false` | Whether `www.example.org` is answered locally for the credential-free check |

A non-loopback `proxy.host` with no `proxy.apiKey` **fails at startup**. Both auth gates begin "no key configured, allow everything", which is right for a local proxy and an open relay anywhere else.

**The shipped allowlist was composed, not guessed.** Two `claude -p` runs through a report-only proxy reached exactly three hosts; a third run with the list enforced completed normally and refused one destination:

| Host | Disposition | Why |
| --- | --- | --- |
| `api.anthropic.com` | intercepted | comes from `upstream`, never listed |
| `mcp-proxy.anthropic.com` | allowed | observed on every run — remote MCP servers are reached through it |
| `downloads.claude.ai` | allowed | plugin downloads and self-update. Refusing it breaks self-update, which then collides with a client version floor: clients drift below it with no way back |
| `mcp.notion.com` | **refused** | a user's own MCP server. No release can know these — add them to `allow` |

That last row is the one to expect. If you use MCP servers, their hosts are yours to list.

Destinations are resolved **once**, and the connection is made to the address that was checked — not to the name. `net.connect(port, host)` resolves the name itself, so checking an address and then connecting by name resolves twice, and the second answer can differ from the first. A name that resolves to **any** blocked address is refused even when it also resolves to a permitted one.

```json
{
  "proxy": {
    "host": "0.0.0.0",
    "apiKey": "…",
    "connect": { "allow": ["mcp.notion.com"] }
  }
}
```

## MITM certificates

In [MITM mode](proxy-modes.md) the proxy terminates each `CONNECT` with a certificate it mints itself, under a CA it also mints and whose private key it immediately discards. Clients trust that CA via `NODE_EXTRA_CA_CERTS`; nothing durable trusts the leaf.

The chain is checked on every intercepted `CONNECT` and replaced when it can no longer be used. The reason is always logged:

| Reason | What it means |
| --- | --- |
| `the leaf has expired` | It lapsed before anything renewed it — every intercepted TLS connection was failing |
| `the leaf is due for renewal` | Inside `renewBeforeDays`, replaced while it still works |
| `the CA has expired` / `is due for renewal` | The leaf's own dates say nothing about the certificate that signed it |
| `the leaf does not cover …` | `upstream` changed, so the stored leaf is for the wrong host |
| `the leaf is not signed by the stored CA` | The two files no longer belong together |

```json
{ "proxy": { "certs": { "leafDays": 90, "renewBeforeDays": 30 } } }
```

A replaced chain reaches the **next** connection — there is no restart and no cache to clear. Connections already open are not disturbed: TLS validates at handshake, so a tunnel that was established under the old certificate keeps running on it until it closes.

`renewBeforeDays` must be shorter than `leafDays`. If it is not, every freshly minted certificate would be due for renewal the moment it was written and the proxy would regenerate the chain on every connection; the value is reduced to half the lifetime instead, and the proxy says so the first time it applies it.

CA lifetime is deliberately not configurable. While the CA key is discarded and the chain is regenerated freely it is not an operator-facing decision — it becomes one when the key is persisted and enrolled devices trust a specific CA.

## Network resilience

After a host network drop and reconnect, Node's shared connection pool can hold dead keep-alive sockets. Because a request has no default time limit, a retry can land on a dead socket and hang forever — every account and every retry keeps hitting the same poison, so the proxy appears wedged until you restart it. TeamClaude bounds each stage so a stuck request fails fast instead: the failure lets Node evict the dead socket, the client retries, and the next request connects fresh — no restart needed. Recovery is per-socket, so after a flap it can take a few failed-then-retried requests to fully drain, but it always converges.

**Connection pooling under concurrency.** Upstream requests go over a pooled **HTTP/1.1** transport (`node:https`), so each concurrent request gets its own connection. Node's global `fetch` instead multiplexes every request to `api.anthropic.com` over a **single HTTP/2 connection**; under many concurrent large uploads (Claude Code POSTs ~1&nbsp;MB of context per turn) that one connection serializes on HTTP/2's shared flow-control windows, and a trivial request can wait minutes for headers ([#106](https://github.com/KarpelesLab/teamclaude/issues/106)). Independent H1 connections have no such contention — each upload fills its own socket at TCP speed, matching what N direct Claude Code processes do.

The defaults are meant to be left alone; these exist for the rare case where they aren't right for you.

| Variable | Default | Description |
| --- | --- | --- |
| `TEAMCLAUDE_UPSTREAM_HEADERS_TIMEOUT_MS` | `120000` | Max wait for upstream **response headers** (time-to-first-byte). Cleared the instant headers arrive, so a long streaming body is never cut. Streamed completions deliver first byte in seconds; a non-streaming (`stream:false`) request that legitimately generates for longer than this could trip it — raise it for such callers |
| `TEAMCLAUDE_UPSTREAM_BODY_TIMEOUT_MS` | `120000` | Max **idle** gap between response-body chunks. Resets on every chunk, so a slow-but-healthy stream is fine; it fires only when the socket goes silent mid-stream (a drop after headers), turning a hang into a fast, retryable failure |
| `TEAMCLAUDE_UPSTREAM_MAX_SOCKETS` | `256` | Max concurrent upstream connections **per origin** in the pooled path. Requests beyond this queue (raise it if you run more concurrent sessions than this against one host) |
| `TEAMCLAUDE_UPSTREAM_GLOBAL_FETCH` | _(off)_ | Set to `1` to route upstream requests through Node's global `fetch` (single HTTP/2 connection) instead of the pooled H1 transport — an escape hatch, not recommended under concurrency |
| `TEAMCLAUDE_REFRESH_TIMEOUT_MS` | `30000` | Max wait for an OAuth token refresh. A hung refresh is coalesced across all callers, so it would otherwise wedge every request for that account |
| `TEAMCLAUDE_RATE_LIMIT_ABSORB_MAX_SECONDS` | `60` | Longest `retry-after` absorbed inline on the same account before a rate-limit 429 is surfaced to the client — see [the two kinds of 429](routing.md#the-two-kinds-of-429) |
