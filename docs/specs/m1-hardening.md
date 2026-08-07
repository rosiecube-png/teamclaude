# M1 — CONNECT and forward policy

Detailed requirements for [#8](../../../issues/8), decomposing three register entries:

| Register entry | Decomposed here as |
| --- | --- |
| **FR-07** — CONNECT allowlist | FR-07.1 … FR-07.6 |
| **NFR-20** — authenticate non-loopback clients, fail closed | NFR-20.1, NFR-20.2 |
| **NFR-21** — constrain where the proxy may connect | NFR-21.1 … NFR-21.4 |

NFR-20 and NFR-21 were **added to the register while writing this spec**: the behaviours
in §2.1 and §2.2 had no entry covering them, which is why they went unnoticed until the
code was read. Sub-requirements keep the register's IDs rather than inventing a parallel
numbering, so "is FR-07 done?" stays answerable.

Every statement about current behaviour below was read out of the source, and cites where.
Nothing here is from memory.

---

## 1. What the proxy does today

### 1.1 The authorisation gate

`connectAuthorized()` — `src/mitm.js:293`

```js
export function connectAuthorized(req, socket, proxyApiKey) {
  if (!proxyApiKey) return true;                              // :294
  if (isLoopbackAddr(socket?.remoteAddress)) return true;     // :295
  …                                                            // otherwise the key
}
```

Three behaviours, in order:

| | Condition | Result |
| --- | --- | --- |
| a | No `proxy.apiKey` configured | **Everything is allowed, from anywhere** (`:294`) |
| b | Client is on loopback | Allowed regardless of key (`:295`) |
| c | Otherwise | `Proxy-Authorization` must carry the key, else `407` |

The HTTP path has the same shape — `src/server.js:110`, using `isLoopbackAddr` from
`src/server.js:52`.

`createDefaultConfig()` generates a key on first run, so (a) is not the default. It is
reachable by hand-editing the config, and it fails **open**.

### 1.2 Destination selection

`hostMode()` — `src/mitm.js:102`

```js
if (host === TEST_HOST) return 'test';                 // www.example.org  (:33)
if (host === upstreamHostOf(config)) return 'rewrite'; // api.anthropic.com
return 'tunnel';                                        // everything else
```

The `tunnel` branch dials the destination directly:

```js
const [host, portStr] = (req.url || '').split(':');
const port = parseInt(portStr, 10) || 443;   // :175
…
const up = net.connect(port, host, () => {   // :197
```

**There is no filtering of host or port anywhere before that call.** Searching `src/mitm.js`
for `169.254`, `127.`, `10.`, `192.168`, `172.1[6-9]`, `isPrivate` returns nothing.

### 1.3 A second unrestricted path

`relayHttpForward()` — `src/server.js:247` — handles the plain-HTTP forward-proxy form
(`GET http://host/path`, what a client sends when it honours `HTTP_PROXY`). It parses the
absolute URL and forwards it, with no host or port restriction either.

So there are **two** egress paths to close, not one. The issue as originally filed named
only the CONNECT tunnel.

---

## 2. What is wrong with that when hosted

### 2.1 Server-side request forgery

With a valid proxy key — which in a hosted deployment every tenant has — a client can reach
**any host on any port that the proxy host can reach**. That includes:

| Target | Why it matters |
| --- | --- |
| `169.254.169.254` | Cloud instance metadata. On the major providers this serves credentials for the instance role |
| RFC1918 addresses | Anything on the operator's private network |
| `127.0.0.1:<any>` | Services bound to the proxy host's loopback, which are usually unauthenticated *because* they are loopback-only |
| Any port | The tunnel is not restricted to 443 (`:175`) — `:22`, `:6379`, `:5432` are all reachable |

This is not a hypothetical class of bug; it is the standard consequence of an open forward
proxy, and the reason a hosted deployment cannot ship the current `tunnel` default.

Note this is **not** "open to the internet" — the key gate (`:293`) stands in front of it.
The accurate statement is that **any authenticated tenant can use the operator's network
position as their own**, with the operator's address as the source.

### 2.2 Failing open with no key

`:294` means a config without `proxy.apiKey` serves everyone. A hosted node must not have a
configuration in which that is possible.

### 2.3 The loopback exemption

`:295` is right for a local proxy: the operator's own machine is the client. On a hosted
node it means anything sharing that loopback interface — a sidecar, another container in
the same network namespace, a compromised process — is unauthenticated.

### 2.4 The test host

`TEST_HOST = 'www.example.org'` (`:33`) is intercepted and answered locally (`:215`). It
exists so the CA and proxy can be verified without credentials, which is useful locally. A
service that answers for a domain it does not own is not acceptable on a shared node.

---

## 3. Requirements

### 3.1 Destination policy

> **FR-07.1** The proxy MUST classify every CONNECT destination as one of: `intercept`,
> `tunnel`, or `refuse`, and MUST refuse by default.

> **FR-07.2** `intercept` MUST apply only to the configured upstream host.

> **FR-07.3** `tunnel` MUST apply only to hosts on a configured allowlist. The allowlist MUST
> be data, not code, so an operator can extend it without a release.

> **FR-07.4** A refused CONNECT MUST answer `403` with a body naming the host, and MUST NOT
> open a socket to it.

The allowlist has to be *composed*, not guessed. **F09 measured only that telemetry hosts
can be refused safely** — the client carried on. It does not generalise: a background agent
reaches for `downloads.claude.ai`, which carries plugin downloads and self-update
([network requirements](https://code.claude.com/docs/en/corporate-proxy)). Refusing that
breaks self-update, which then collides with the version floor in
[#16](../../../issues/16) — clients drift below it and are locked out with no way to
recover.

Observed on the wire so far, across foreground and background runs:

| Host | Seen | Disposition |
| --- | --- | --- |
| `api.anthropic.com` | always | `intercept` |
| `downloads.claude.ai` | background agent | `tunnel` — self-update depends on it |
| `http-intake.logs.us5.datadoghq.com` | both | refusable (measured, F09) |
| `browser-intake-us5-datadoghq.com` | both | refusable (measured, F09) |

> **FR-07.5** The shipped default allowlist MUST be derived from the documented host list and
> validated by running a client against it — not assumed. Each entry MUST record why it is
> there.

### 3.2 Address policy

> **NFR-21.1** Regardless of the allowlist, the proxy MUST refuse any destination that
> resolves to a loopback, link-local, or private address.

Checking the hostname alone is not sufficient: an allowlisted name can resolve to
`169.254.169.254`. The check belongs at the resolved address.

> **NFR-21.2** The proxy MUST connect to the address it checked, not to the name.

`net.connect(port, host)` (`src/mitm.js:197`) takes a **hostname** and resolves it itself.
So "resolve, check, then connect by name" resolves twice, and a name that answered with a
public address for the check can answer with `169.254.169.254` for the connect. Closing
NFR-21.1 without this leaves the check decorative.

There is no DNS handling in `src/` today (`grep -rn "dns\.\|lookup\|resolve4" src/` finds
nothing), so the resolve-check-connect step is new code rather than a change to existing
behaviour. Blind-tunnelled traffic is spliced without TLS validation by us (CON-09), so
connecting by address costs nothing: the client's own handshake inside the tunnel still
validates the certificate against the name it asked for.

> **NFR-21.3** The proxy MUST restrict tunnelled destinations to port 443.

Nothing legitimate in the observed traffic uses another port, and `:175` currently accepts
any.

> **NFR-21.4** `relayHttpForward()` (`src/server.js:247`) MUST enforce the same host
> allowlist (FR-07.3) and address policy (NFR-21.1–21.3) as the CONNECT path.

### 3.3 Authorisation

> **NFR-20.1** A missing `proxy.apiKey` MUST NOT mean "allow everything". When the listener is
> not bound to loopback, startup MUST fail with an error naming the missing setting.

> **NFR-20.2** The loopback exemption MUST be disableable by configuration, and MUST be off
> whenever the listener is not bound to loopback.

Both are the same shape: the dangerous case is a listener reachable off-box with an
authorisation path that is open. Deriving the default from `proxy.host` means an operator
cannot arrive at the unsafe combination by omission — only deliberately.

### 3.4 Test host

> **FR-07.6** The built-in interception of `www.example.org` MUST be removable by
> configuration, and MUST default to off when the listener is not bound to loopback.

Keeping it available locally preserves the credential-free verification path documented in
[proxy-modes.md](../proxy-modes.md); defaulting it off when remote stops the service
answering for a domain it does not own.

---

## 4. Configuration surface

Existing keys this extends: `proxy.apiKey`, `proxy.host`, `proxy.tls`, `upstream`.

```json
{
  "proxy": {
    "host": "0.0.0.0",
    "connect": {
      "allow": ["downloads.claude.ai"],
      "allowPrivateAddresses": false,
      "allowLoopbackClients": false,
      "testHost": false
    }
  }
}
```

The upstream host is always intercepted and is not listed — it comes from `upstream`.

**Defaults derive from `proxy.host`.** Bound to loopback, today's behaviour is preserved so
local users see no change. Bound anywhere else, every switch above defaults to the closed
position. This is the mechanism behind NFR-20.1, NFR-20.2 and FR-07.6.

---

## 5. Tests

| | Asserts |
| --- | --- |
| An allowlisted host is tunnelled | FR-07.3 |
| A non-allowlisted host gets `403` and **no socket is opened** | FR-07.1, FR-07.4 |
| The upstream host is still intercepted, not tunnelled | FR-07.2 |
| A name resolving to `127.0.0.1` / `169.254.169.254` / RFC1918 is refused even when allowlisted | NFR-21.1 |
| A name that answers with a public address on the check and a private one on the connect is still refused | NFR-21.2 |
| A CONNECT to an allowlisted host on a port other than 443 is refused | NFR-21.3 |
| `relayHttpForward` refuses the same destinations | NFR-21.4/FR-07.7 |
| Non-loopback `proxy.host` with no `proxy.apiKey` fails at startup | NFR-20.1 |
| Loopback exemption is off by default when `proxy.host` is not loopback | NFR-20.2 |
| `www.example.org` is not intercepted when `proxy.host` is not loopback | FR-07.6 |
| With `proxy.host` on loopback, every current behaviour is unchanged | no regression |

FR-07.5 has no row on purpose: it is a validation activity, not a behaviour. It is
discharged by running a client with the allowlist active and recording what got refused —
see §6.

NFR-21.1 and NFR-21.2 need a resolver seam so a test can force a name to a private address
without DNS, and can make it answer differently on the second lookup. That seam is also
what makes NFR-21.2 implementable at all — see §3.2.

---

## 6. Open

- **The allowlist contents are not yet settled** (FR-07.5). Composing it needs a client run
  with the allowlist active, watching what gets refused. That is implementation work, not a
  decision to take now.
- **Interactive mode is unmeasured** (§8.5 of the requirements). Every observation here
  comes from `-p` and `--bg` runs, so the host list may be incomplete. FR-07.5's validation
  step is what would catch that.
