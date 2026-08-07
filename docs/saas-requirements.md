# Hosted service — requirements

Requirements for turning the local proxy into a multi-tenant hosted service.

Every architectural claim below is **measured**, not assumed: a real Claude Code process
was driven through a proxy and the handshakes and request paths were observed. Findings
are numbered `F01`–`F18` and referenced from the requirements that rest on them. What
could not be measured is recorded as open rather than filled in with a guess.

| | |
| --- | --- |
| Requirements | 18 functional, 27 non-functional — §4.1, §4.2 |
| Assumptions | 43 — 14 measured, 8 source-read, 4 deferred, 17 unverified or false — §4.3 |
| Constraints | 10 — §4.4 |
| Risks | 8 rated, owned, with residual — §10 |
| Measured findings | 18 — §2 |
| Backlog | 1 — egress IP, §5 |
| Standards audit | [iso-audit.md](iso-audit.md) — 11 absent, 3 unclassified |
| Tracked as issues | [#3](../../issues/3)–[#9](../../issues/9) |
| Pull requests | [#1](../../pull/1), [#2](../../pull/2), [#10](../../pull/10) |

---

## 0. Purpose and goals

### Purpose

Let one person use **their own** Claude accounts from **their own** machines without
installing and maintaining a proxy on each one. The local proxy already pools accounts;
this moves that pooling somewhere central so several machines share it.

### Non-goals

Stated so requirements are not written for them.

- **No billing.** The service is not sold. Funding, if any, is donations.
- **No schedule.** It ships when it is finished; no dates are estimated, so nothing here is
  scoped down to hit one.
- **Not a way to get more quota than the accounts hold.** The product redistributes what
  the accounts already have — see CON-07.

### Two deployment modes

These have very different obligations, and several requirements apply to only one.

**Decided: community-hosted is the target.** Self-hosted is not a fallback — it is the
first milestone on the way there (M1, §6). Everything M1 delivers is needed by the
community-hosted build too; nothing is thrown away. The value of sequencing it that way is
that the project reaches something usable, by its own author, before it takes on anyone
else's credentials.

| | **Self-hosted** | **Community-hosted** |
| --- | --- | --- |
| Who operates it | The account owner | A volunteer, for others |
| Whose credentials it holds | The operator's own | Other people's |
| Multi-tenancy | Optional | Required |
| Per-tenant CA, KMS, audit logging | Optional | Required |
| Privacy policy, DPA, incident process | Not applicable | Required |
| Credential-custody grey area (CON-06) | **Does not arise** | Applies |
| Funding for dedicated egress, KMS, on-call | Operator's own machine | **Donations only** |

The local proxy already supports off-box operation (F13), so M1 is a short distance from
what exists. Community-hosted then adds the control plane, the security boundary, and the
legal exposure — funded by donations.

That funding gap is a real constraint, not a footnote (CON-08). Several requirements here
— per-tenant egress IPs (NFR-08), KMS-held CA keys (NFR-03), incident response (NFR-15) —
carry ongoing cost with no revenue against them. Reaching M1 first means that question can
be answered with a running system rather than an estimate.

### Stakeholders and what they want

Named with their concerns, because two of them want opposite things and the design has to
know which it is serving.

| Stakeholder | Concern | Where it bites |
| --- | --- | --- |
| **Operator** | Runs it, pays for it, carries the on-call | CON-08 — every hardening requirement is their cost |
| **User of a hosted instance** | Their accounts keep working; their prompts stay private | CON-02, CON-06 — they bear a risk they cannot inspect |
| **Self-hosting user** | Wants M1 and none of the rest | The mode fork above; most of M2–M4 is overhead to them |
| **Maintainer of the upstream project** | This is a fork; changes should be contributable back | Keeps M0 fixes separable from hosted-only work |

The operator and the hosted user are in tension: NFR-03, NFR-08 and NFR-15 protect the
user and are paid for by the operator, with no revenue between them (CON-08). That tension
is the M4 gate.

### Success criteria

What "finished" means. Each is checkable.

| | Criterion |
| --- | --- |
| **G-1** | A machine is enrolled and `claude` works with **no process of ours** resident on it. The client may start its own supervisor for background agents (F15); that is not ours to remove (ASM-33) |
| **G-2** | Every request that spends quota is attributed to the account that served it |
| **G-3** | No request is ever served with an account belonging to a different person — **including via a colliding client-supplied session id** (ASM-31) |
| **G-4** | A device can be revoked without disturbing that person's other devices |
| **G-5** | Pooling *N* accounts yields materially more headroom than one — the premise (ASM-09 is the open risk) |
| **G-6** | When the service is unreachable, the failure is legible and recovery does not need the operator |

G-6 is the one with no requirement behind it today; see NFR-12 and NFR-13.

## 1. Scope

Each user registers **accounts they own** and uses them from their own machines. Accounts
are not shared between people. The proxy runs in the cloud and terminates MITM there.

The client carries **no resident process** — three files and one settings block. No agent,
no shell wrapper, no system trust-store installation. This was measured, not assumed.

| On the client | Role |
| --- | --- |
| `tenant-ca.pem` | Trusts the inner MITM leaf |
| `device.crt` / `device.key` | Device identity — per-machine auth and revocation |
| `~/.claude/settings.json` | `env` block holding the proxy URL and the paths above |

> **The outer TLS can use an ordinary public certificate.** When the edge terminates
> outer TLS with a publicly-trusted certificate, the device certificate inside the CONNECT
> tunnel still reaches the backend (F08). So the only CA a client must be given is the
> **inner** one.

---

## 2. Measured findings

| ID | Question | Result | Environment |
| --- | --- | --- | --- |
| **F01** | Does the client present a certificate on the TLS handshake *inside* the CONNECT tunnel? | **Yes** — `CN=device-01` observed on `POST /v1/messages` | 2.1.223, 2.1.193 |
| **F02** | Is an `https://` scheme proxy URL supported? | **Yes** — outer TLS → CONNECT → inner TLS all succeed | 2.1.223, 2.1.193 |
| **F03** | What actually causes the reported `https://` proxy failure? | **Misdiagnosis** — not TLS-in-TLS; the proxy certificate lacked the connect hostname in its SAN | Windows |
| **F04** | Can the proxy be configured purely from the `env` block of `settings.json`? | **Yes** — no shell variables, no wrapper | project scope |
| **F05** | Can 100% of traffic be captured from `settings.json` alone? | **No** — one `/api/eval/*` request fires before settings load and bypasses the proxy. Superseded by F14 | isolated by experiment |
| **F06** | Does mTLS coverage vary by client version? | **Yes** — 2.1.193 omits it on bootstrap paths, but **both** versions send it on `/v1/messages` | 2.1.223 vs 2.1.193 |
| **F07** | Cost of an nginx `stream` passthrough in front? | **None** — 5.00 s vs 5.01 s direct | Linux |
| **F08** | Does device mTLS survive an edge that terminates the outer TLS? | **Yes** — public cert at the edge, plaintext CONNECT to the backend, certificate still arrives | Linux, public path |
| **F09** | Is refusing a non-upstream CONNECT safe? | **For telemetry hosts, yes** — the client carried on. Does **not** extend to every host: `downloads.claude.ai` carries plugin and self-update traffic and was never part of that test | 2.1.223 |
| **F10** | How much traffic gets an account token injected today? | **Too much** — 8 of 12 observed paths, including account-scoped state | live capture |
| **F11** | Does Linux behave differently from Windows? | **No** — identical results | Ubuntu 24.04 |
| **F12** | Is the proxy→upstream leg the latency bottleneck? | **No** — the server leg was slightly faster than a local direct connection | TTFB |
| **F13** | Is remote operation already in scope for this project? | **Yes** — `proxy.host` + `proxy.apiKey` are already documented for off-box clients | code + docs |
| **F14** | Can 100% of traffic be captured at all? | **Yes** — shell env covers the pre-settings window, `settings.json` covers everything after. Both set: **9 of 9** observed paths | 2.1.223 |
| **F15** | Does shell env reach a background agent? | **Yes** — the supervisor cold-started from that shell inherits it; `/v1/messages` included | 2.1.223 |
| **F16** | Does a **project**-scope `settings.json` reach a background agent? | **No** — the agent ran to completion with **zero** proxy traffic. It went direct | 2.1.223 |
| **F17** | Does a **user**-scope `settings.json` reach a background agent? | **Yes** — 33 CONNECTs arrived, and none on the shell listener | 2.1.223 |
| **F18** | Does the upstream allow one account in concurrent sessions? | **Yes** — five concurrent sessions observed on one account, several mid-request | production use |

### What F14–F17 settle: how the client must be configured

F05 read as a trade-off between capture and authentication. Measuring the remaining
combinations dissolved it — the two injection methods cover **different windows**, so
setting both is strictly better than either.

| | Pre-settings window | After settings load | Background agents |
| --- | --- | --- | --- |
| Shell environment | ✅ | ✅ | ✅ (F15) |
| `settings.json`, **project** scope | ✗ | ✅ | ❌ **bypasses** (F16) |
| `settings.json`, **user** scope | ✗ | ✅ | ✅ (F17) |

**Requirement.** The enrollment script must write **both**:

1. `~/.claude/settings.json` — **user scope**. Project scope is not a weaker option, it is
   a silent hole: a background agent configured that way ran to completion having reached
   the upstream directly (F16).
2. A shell `export` — covers the window before settings are read.

Together: 9 of 9 observed paths captured (F14).

mTLS is enforced **on the rotation path**, not at the TLS layer — see §8.1.

---

## 3. Architecture

The load-bearing property is that the two TLS layers are independent (F08). The edge can
therefore be ordinary managed infrastructure, and device authentication still reaches the
backend.

```mermaid
flowchart LR
    C["Client machine<br/><small>claude CLI · no daemon</small>"]
    E["Edge<br/><small>public cert · SNI routing</small>"]
    B["MITM backend<br/><small>CONNECT · account routing</small>"]
    U["Upstream API<br/><small>per-tenant egress</small>"]

    C -->|outer TLS| E
    E -->|plaintext CONNECT| B
    B -->|per-tenant egress| U
```

- **Outer TLS** ends at the edge. It may also be passed straight through — both were
  measured and neither added overhead (F07, F08).
- **Inner MITM TLS plus the device certificate** runs from the client all the way to the
  backend, through whatever the edge does.
- **Only inference paths take a rotated account token.** Everything else travels on the
  client's own credential.

### Trust boundaries

The view above is the request path. This one is where the data sits and who can reach it —
the audit asked for it from two directions, as an architecture viewpoint (H-1) and as a
security asset register (F-1, now §9).

```mermaid
flowchart TB
    subgraph U["User's machine — user controls"]
        C["claude CLI"]
        K["device.key · tenant-ca.pem"]
    end
    subgraph H["Hosting provider — operator controls, provider hosts"]
        E["Edge · TLS terminates"]
        B["MITM backend<br/><small>prompts in plaintext, in memory</small>"]
        S[("Config store<br/><small>refresh tokens</small>")]
        M[["KMS · tenant CA key"]]
    end
    subgraph X["Third parties"]
        A["Upstream API"]
        P["sx.org · ciphertext only"]
    end
    C --> E --> B
    K -.trusts.-> B
    B --> S
    B -.signs via.-> M
    B --> A
    B -.when sx.mode is on.-> P --> A
```

Two boundaries carry the weight. **User to operator** is crossed by refresh tokens, which
the user cannot inspect once handed over (CON-06). **Operator to provider** is crossed by
prompt plaintext, which exists in memory on infrastructure the operator does not own
(CON-02). Neither is avoidable in the community-hosted mode; both are why §9 exists.

---

## 4. Requirements

Four registers, plus the risk register in §10. Every entry traces to a finding, an existing
implementation, or an issue — nothing here is stated without a source. The gap analysis in
§4.5 says which already exist in the codebase.

**Evidence classes.** Every ASM entry carries one, because the first sweep treated a
citation as verification and a citation to someone else's documentation is not that.

| Class | Means | Can it be wrong? |
| --- | --- | --- |
| **measured** | A run against a real client here | Only if the run was unrepresentative |
| **source-read** | Read out of this repository, with a line cited | No, for the state of that line |
| **deferred** | Taken from vendor documentation and never tested here | **Yes** — it bounds what we support on someone else's word |
| **unverified** | Asserted, with nothing behind it | Yes |

`deferred` is the class that hid: three claims sat behind links and read as settled.

**Identifiers.** One scheme, declared here so nothing invents another. A sub-requirement
extends its parent (`FR-07.3`) rather than opening a new space — the specs under
[`specs/`](specs/) decompose these IDs, they do not replace them.

| Prefix | Meaning | Lives in |
| --- | --- | --- |
| `FR-nn` | Functional requirement | §4.1 |
| `NFR-nn` | Non-functional requirement | §4.2 |
| `ASM-nn` | Assumption, with verification status | §4.3 |
| `CON-nn` | Constraint | §4.4 |
| `RSK-nn` | Risk, with likelihood, impact, owner and residual | §10 |
| `G-n` | Success criterion | §0 |
| `Fnn` | Measured finding — no hyphen, e.g. `F14` | §2 |

`R-` is deliberately unused: it was briefly taken by spec sub-requirement IDs (`R-8.1` …),
withdrawn in [#26](../../pull/26) for breaking traceability, and reusing it for risks would
have put `R-8` in the repository twice meaning two different things.

### 4.1 Functional — FR

| ID | Requirement | Source |
| --- | --- | --- |
| **FR-01** | Isolate each tenant's accounts, quota state and rotation from every other tenant | [#4](../../issues/4) |
| **FR-02** | Enrol a device: issue a per-device certificate, and revoke it without touching the tenant's other devices | F01, [#6](../../issues/6) |
| **FR-03** | Enrolment writes the proxy URL to **both** `~/.claude/settings.json` (user scope) **and** a shell `export` | F14–F17 |
| **FR-04** | Terminate MITM with a per-tenant CA and a leaf scoped to the upstream host | F08, [#5](../../issues/5) |
| **FR-05** | Rotate accounts on inference paths only (`/v1/messages`, `count_tokens`, `/v1/complete`) | F10, [#2](../../pull/2) |
| **FR-06** | Relay every other path on the client's own credential | F10, [#2](../../pull/2) |
| **FR-07** | Allow CONNECT only to an allowlist: upstream is MITM-ed, other Anthropic hosts are blind-tunnelled, the rest refused | F09, [#8](../../issues/8) |
| **FR-08** | Enrol an account by OAuth without a hosted callback — PKCE plus manual code entry | `oauth.js` `raceWithStdinCode` |
| **FR-09** | Detect an invalidated token, notify the user, and offer re-authentication from the dashboard | [#7](../../issues/7) |
| **FR-10** | Refuse clients below a published minimum version, naming the version and how to update | §8.4 |
| **FR-11** | Dashboard: accounts, devices, quota, per-tenant status | — |
| **FR-12** | Show each person their own usage and remaining quota — for visibility, not billing (§0 non-goals) | `updateUsage`, SSE parsing |
| **FR-13** | Authenticate to the dashboard. It is the gate in front of every stored credential | — |
| **FR-14** | Offboard: revoke every device, delete stored tokens, and confirm the deletion | G-4 |
| **FR-15** | Remove or disable one account without disturbing the person's others | `disable`/`remove` |
| **FR-16** | Distribute the enrolment artifacts (script, CA, device certificate) over an authenticated channel | FR-02 |
| **FR-17** | Surface why a request failed — exhausted, refused, unreachable — so recovery does not need the operator | G-6 |
| **FR-18** | Detect a machine configured through only one of the two locations, and report which is missing. **Reworded in task-5**: it read *detect a client that reached the proxy…*, which assumed a proxy-side signal that does not exist. Two controlled runs on client 2.1.224 — shell-export only, and project-scope `settings.json` only, with the activity filter off — produced identical request sequences at the proxy, and neither carried the `/api/eval/*` request F05 recorded. The check reads both locations on the machine instead, which also covers the case the spec called harder: settings missing, so background agents never reach the proxy at all | ASM-13, F16 |

### 4.2 Non-functional — NFR

| ID | Requirement | Source |
| --- | --- | --- |
| **NFR-01** | No credential crosses the network in cleartext — the listener speaks TLS | [#1](../../pull/1) |
| **NFR-02** | Enforce mTLS on the rotation path, not at the TLS layer | §8.1, F06 |
| **NFR-03** | Per-tenant CA private key held in a KMS; signing happens inside it | [#5](../../issues/5) |
| **NFR-04** | Refresh tokens stored envelope-encrypted, never plaintext at rest | [#7](../../issues/7) |
| **NFR-05** | Request-body logging off by default; when on, tenant-encrypted with short retention | §7 |
| **NFR-06** | Edge adds no measurable latency — TLS termination or TCP passthrough both ≈0 | F07, F08 |
| **NFR-07** | Survive long-lived SSE responses: no idle timeout below the client's own watchdogs | F07 (`proxy_timeout`) |
| **NFR-08** | Per-tenant egress IP, not a shared NAT | §5 backlog |
| **NFR-09** | Horizontal scaling without double-counting quota — tenant-sticky routing or externalised state | [#4](../../issues/4) |
| **NFR-10** | Canary each new client release before adopting it as the floor | §8.4, F03, F06 |
| **NFR-11** | Audit every access to stored credentials | §7 |
| **NFR-12** | State an availability posture and hold to it. Best-effort is a legitimate answer for a donation-funded service — silence is not | G-6, CON-08 |
| **NFR-13** | Degrade legibly: when the service is unreachable the client must fail with a diagnosable error, and removing the proxy configuration must restore direct operation | G-6 |
| **NFR-14** | Back up tenant configuration and tokens, and rehearse the restore. Losing them means every user re-enrols every account by hand | — |
| **NFR-15** | Have an incident process before holding anyone else's credentials: detection, containment, and notifying the people affected | CON-02, community-hosted only |
| **NFR-16** | Fair-share across tenants. `stormRamp` paces a single **account**; nothing paces a **tenant**, so one can crowd out the rest of a shared egress | `stormRamp` |
| **NFR-17** | Rotate the secrets the design creates — proxy keys, device certificates, the tenant CA — with a defined lifetime and a revocation path | NFR-03 |
| **NFR-18** | Declare where tokens and logs are stored, and keep them there | §7, community-hosted only |
| **NFR-19** | Protect the dashboard itself: session handling, and rate limiting on enrolment and login | FR-13 |
| **NFR-20** | Authenticate every client that is not on loopback, and fail **closed** when no credential is configured | `connectAuthorized` fails open today — `src/mitm.js:294` |
| **NFR-21** | Constrain where the proxy may open a connection: refuse loopback, link-local and private addresses, restrict the port, and connect to the address that was checked | nothing filters today — `src/mitm.js:197`, `src/server.js:247` |
| **NFR-22** | Keep the code that tracks the client's behaviour isolated and independently testable, so a release that moves it is a contained change | ASM-10 is **known false**; F03 and F06 each caught the contract moving |
| **NFR-23** | State a recovery point and recovery time objective, and size the backup mechanism from them | NFR-14 is not implementable without them — §10 |
| **NFR-24** | Identify every third party that handles user data or traffic, and state what each receives | The cloud host terminates TLS; `sx.mode` relays upstream traffic through a residential proxy provider |
| **NFR-25** | Maintain a threat model, and revisit it whenever the trust boundary moves | The SSRF surface was found by reading `mitm.js` closely, not by method |
| **NFR-26** | Where a requirement classifies a range, the tests MUST exercise its boundaries, not only a member of each class | NFR-21.1 sorts addresses into refused and permitted; the defects live at the edges of `127.0.0.0/8`, at `169.254.169.254`, at the `172.16`–`172.31` limits, and in IPv4-mapped IPv6 forms |
| **NFR-27** | A review finding carries a severity, becomes a failing test in the task that owns the behaviour, and a milestone does not close with an unresolved high finding | Nothing said where a security-review finding goes or what it blocks |

**Quality characteristics covered.** Grouped against ISO/IEC 25010 so the shape of the
coverage is visible rather than implied — the audit found maintainability missing precisely
because nothing was classified.

| Characteristic | Entries |
| --- | --- |
| Security | NFR-01, 03, 04, 11, 17, 19, 20, 21, 25, 26, 27 |
| Reliability | NFR-12, 13, 14, 23 |
| Performance efficiency | NFR-06, 07, 16 |
| Maintainability | NFR-22 |
| Compatibility | NFR-10, CON-01, CON-04 |
| Portability | ASM-07, §8.5 |
| Usability | FR-17, FR-11 |
| Functional suitability | the FR register |

### 4.3 Assumptions — ASM

Status is measured, not asserted. An unverified assumption is marked as such.

| ID | Assumption | Status |
| --- | --- | --- |
| **ASM-01** | The client presents its device certificate inside the CONNECT tunnel | ✅ F01 — Windows, Linux, public path, edge-terminated |
| **ASM-02** | An `https://` proxy URL is honoured | ✅ F02 — 2.1.223 and 2.1.193 |
| **ASM-03** | Shell env plus user-scope `settings.json` captures all traffic | ✅ F14 — 9 of 9 paths |
| **ASM-04** | Background agents are reachable by configuration | ✅ F15, F17 — user scope and shell env both reach them; **project scope does not** (F16) |
| **ASM-05** | One account may serve concurrent sessions | ✅ F18 — production use |
| **ASM-06** | Device auth survives an edge that terminates outer TLS | ✅ F08 — the edge terminated with a public certificate, forwarded a plaintext CONNECT, and `CN=device-01` still arrived at the backend on `POST /v1/messages` |
| **ASM-07** | macOS behaves as Windows and Linux do | ❌ **unverified** — §8.5 |
| **ASM-08** | Interactive mode produces the same request pattern as `-p` | ❌ **unverified** — §8.5 |
| **ASM-09** | A datacenter egress IP is treated like any other | ❌ **unverified** — §5, backlog by decision |
| **ASM-10** | Client behaviour is stable across releases | ❌ **false** — F03 and F06 both found it moving. NFR-10 exists because of this |
| **ASM-11** | The upstream's response contract is stable | ❌ **unverified** — quota tracking parses `anthropic-ratelimit-unified-*`. If those headers change, rotation degrades **silently**. The server-side twin of ASM-10, and nothing watches for it |
| **ASM-12** | Headless token refresh keeps working without user interaction | ❌ **unverified** — re-login prompts are already reported in ordinary use |
| **ASM-13** | Enrolment leaves both configuration locations in place | ❌ **unverified** — FR-03 needs both; if one is lost the leak is silent (F16). Nothing detects the half-configured state |
| **ASM-15** | Regenerating a certificate takes effect | ✅ **true, once fixed** — was ❌ false: `certsPromise` and `serverPromises` were both memoised for the process lifetime and the terminating server baked the cert in at creation, so nothing re-read until restart. NFR-17.5 removed the first memo entirely and keyed the second on the leaf. Measured: revalidating costs 0.386 ms against a CONNECT that then does a TLS handshake, so no cache was needed to replace it |
| **ASM-16** | A leaf swap needs no client action | ✅ **verified** — clients are handed `caPath` only (`src/index.js:648`, `:718`); a fresh leaf under the same CA validates with no client change |
| **ASM-17** | An expiring certificate does not disturb work in flight | ✅ **measured** — an established TLS connection carried traffic 2s past `notAfter`; a new connection was refused with `CERT_HAS_EXPIRED`. TLS validates at handshake |
| **ASM-18** | `~/.claude/settings.json` is plain JSON | ❌ **false** — a file containing a `//` comment was accepted and the session ran. `JSON.parse`/`stringify` would drop it silently, so FR-03.3's "preserve every unrelated key" is not sufficient |
| **ASM-19** | The private-address list is complete | ✅ **true, as built** — was ❌ unverified: the spec named `127.0.0.0/8`, `169.254.169.254` and the 172.16–172.31 limits, which is a sample and not a set. `BLOCKED_RANGES` (`src/destination-policy.js`) now enumerates every IANA special-purpose range, each with the reason it is there, and the tests exercise both edges of each rather than one member per class (NFR-26) |
| **ASM-20** | A hostname resolves to addresses of one kind | ✅ **false, and handled** — `lookup(host, {all:true})` can return both, so the assumption was wrong. A name resolving to **any** blocked address is refused even when it also resolves to a permitted one (NFR-21.5); picking the public one would leave the refusal decidable by whichever answer came back first |
| **ASM-21** | Allowlist entries are exact hostnames | ✅ **true, as built** — decided rather than assumed. Entries are exact and a wildcard is not honoured: `*.claude.ai` would admit any host an attacker can get named in that zone. A test asserts a wildcard entry matches nothing |
| **ASM-22** | The certificate directory has one writer | ❌ **false, consequence removed** — `ensureCerts` is still called from the CLI (`src/index.js:648`, `:718`) as well as the server, so there is more than one writer. What it cost has gone: the server held a memo of the old chain and now re-reads, so a chain `teamclaude run` regenerates reaches a server that is already running. The interleaving itself is ASM-30 |
| **ASM-23** | Returning `403` for a refused destination is safe | ❌ **measured false on the request path** — a 403 carrying our envelope produced *"Failed to authenticate."* before the message, which is the misreading `src/server.js` already avoids. On the **CONNECT** path 403 is fine (F09). The contract now uses `400` on the request path, matching the blocked-model precedent (`src/server.js:471`) |
| **ASM-24** | Prompt content is never persisted | ❌ **false** — `src/crash-log.js` writes `err.stack` on a fatal error, and its own comment says "a stack can carry request context". Mode `0600`, but §9 did not list it |
| **ASM-25** | Request logs are short-lived | ❌ **false** — nothing deletes them. `grep` for `unlink`, `rmSync`, `retention`, `prune` across `src/server.js` and `src/request-log.js` finds nothing; `logDir` grows without bound. §9's retention column described the requirement, not the code |
| **ASM-26** | The quota state file is low-sensitivity and disposable | ❌ **false** — `exportQuotaState` (`src/account-manager.js:1276`) writes `accountUuid`, `orgUuid`, `orgName` and `name` beside the counters, and the display name is derived from the account email. It carries identity, not just quota |
| **ASM-27** | The device private key only ever exists on the user's machine | ✅ **true, as built** — was ❌ unverified: FR-16.1 said enrolment "places" `device.key` without saying who generates it, and if the server minted the pair the server held the private key and §9's classification was wrong. FR-16.3 settled it and task-2 built it — `createCsr` (`src/x509.js`) generates the key during enrolment and only the request is passed to whatever signs it. Verified with `openssl`: the request's public key hashes identically to the key left on disk, and the request carries no private material |
| **ASM-28** | A partial unenrol degrades safely | ✅ **measured** — with the proxy removed and `NODE_EXTRA_CA_CERTS` left pointing at a deleted file, the client warned (`Ignoring extra certs … load failed`) and continued. The dangling half does not block direct operation |
| **ASM-29** | Clients act on `error.type` | ❌ **measured false** — the client printed the `message` verbatim and showed no sign of the type. FR-17.1's discriminator is an operator and log affordance; the `message` has to carry the whole story |
| **ASM-30** | The certificate directory is written by one process | ❌ **false, and now handled** — was ❌ unverified, and it reproduces: three processes regenerating concurrently while a reader checked the pair the way every intercepted CONNECT does gave **820 mismatched pairs in 17,249 reads (4.75%)**, plus 4–10 `EPERM` write failures per process on Windows, where a rename over a file another process holds is refused. There is still more than one writer — the CLI and the server both call `ensureCerts` — but they now take an exclusive lock, the rename retries, and a torn pair is re-read before it is believed. `ensureCerts` returns no incoherent chain and throws nothing under contention, held by `test/cert-concurrency.test.js`. **Not fixed:** two processes configured with *different* upstreams sharing one directory ask for incompatible chains and replace each other forever — 3,367 torn reads in 18,130. That is a misconfiguration, not a race |
| **ASM-31** | Session affinity cannot cross tenants | ❌ **unverified** — sessions are keyed by `x-claude-code-session-id`, a header the **client** supplies (`src/server.js:407`), and the map lives on `AccountManager` (`recordSession`, `:364`). It holds only if the per-tenant `AccountManager` in [#4](../../issues/4) also scopes the session map. Nothing says so, and G-3 does not list it |
| **ASM-32** | Quota state is current when the process dies | ❌ **false** — it is written on an interval (`persistQuotaState`, `src/index.js:188`), not on change, so up to one interval is lost. Relevant to NFR-23: the RPO differs by asset, and only tokens are written as they change |
| **ASM-33** | "No resident process" describes the client machine | ⚠️ **imprecise** — F15 measured the client cold-starting its own supervisor daemon for background agents. The claim is true of **our** software and false of the machine; §1 and G-1 do not distinguish |
| **ASM-34** | A config edited while the server runs is picked up | ⚠️ **partly** — `POST /teamclaude/reload` and `atomicConfigUpdate` cover accounts and the sx key (`src/index.js:249`). Whether the M1 additions — the allowlist, certificate lifetimes — are reloadable is unstated, and they are the settings an operator most wants to change under load |
| **ASM-35** | The client cannot chain proxies (CON-01) | ⚠️ **deferred** — derived from the documented variable set, never tested. If some form of chaining exists, CON-01's "cannot use the service" is too strong and an enterprise user is being turned away on a reading |
| **ASM-36** | Cloud sessions ignore the certificate variables (CON-04) | ⚠️ **deferred** — taken from the vendor's network documentation; no cloud session was ever run here. It bounds what the product supports, so it is worth more than a citation |
| **ASM-37** | Buffers are short-lived, so "discard immediately after the response" is nearly true today | ❌ **false** — the body is buffered whole so it can be replayed on another account, so it is held across **every retry**, and `holdSeconds` keeps it for the entire wait while all accounts are exhausted (`src/server.js:445`). The window is bounded by the hold budget, not by the response |
| **ASM-38** | Crash reporting does not capture request bodies, as §7 requires | ❌ **false today** — `src/crash-log.js` writes `err.stack`, and its own comment says a stack can carry request context. §7 stated the requirement as though it described the code (see also ASM-24) |
| **ASM-39** | The client version reaches the rotation path | ✅ **measured** — `user-agent: claude-cli/2.1.223 (external, sdk-cli)` on `POST /v1/messages`, alongside `x-app: cli`. FR-10's carrier is confirmed, and it was an assumption until this run |
| **ASM-40** | The version is the only client identity on that path | ❌ **false, and useful** — the same request carries `x-stainless-package-version`, `x-stainless-runtime-version` and `anthropic-beta` with dated feature flags. A canary (NFR-10) can watch the beta list and the SDK version, not just the CLI version, and those move independently |
| **ASM-41** | `downloads.claude.ai` carries self-update | ⚠️ **deferred** — vendor network documentation. Testing it needs a version-behind client and a real update cycle, which one run cannot produce. FR-07.3 allowlists it on that basis |
| **ASM-42** | The client's SSE watchdog thresholds are 180s / 300s | ⚠️ **deferred** — vendor documentation. NFR-07 sizes the edge timeout against numbers never observed here |
| **ASM-43** | A `502` refusal would be a safe alternative | ❌ **measured false** — with the same body under `502` the client showed nothing immediately and retried, for a destination that will never be allowed. Retrying a policy decision is worse than reporting it |
| **ASM-14** | The hosts observed on the wire are all the hosts a client needs | ❌ **unverified** — every observation came from `-p` and `--bg` runs (ASM-08). An allowlist built from an incomplete list refuses something a real session needs, and FR-07.5 exists to catch that before users do |

### 4.4 Constraints — CON

Fixed properties of the design or its environment. Not problems to solve — bounds to work inside and to state plainly to users.

| ID | Constraint | Consequence |
| --- | --- | --- |
| **CON-01** | `HTTPS_PROXY` holds one value and the client has no proxy chaining | A client behind an **explicit** corporate proxy cannot use the service. Transparent proxies are unaffected — §8.6 |
| **CON-02** | Terminating TLS in the cloud puts every prompt and file in server memory as plaintext; the body is buffered whole so it can be replayed on another account | Unavoidable. Drives NFR-04, NFR-05, NFR-11 and the legal review in §7 |
| **CON-03** | One request fires before `settings.json` is read | Only the shell `export` covers it — hence FR-03 requiring both |
| **CON-04** | Cloud sessions ignore `NODE_EXTRA_CA_CERTS` and the client-certificate variables | Claude Code on the web cannot be routed through the service; support the local CLI only |
| **CON-05** | Issuing leaves server-side requires persisting a CA private key | A regression against the local design, which discards it. Bounded by NFR-03 |
| **CON-06** | Users upload their own refresh tokens to a third party | A grey area under the consumer terms. **Does not arise when self-hosted.** Otherwise mitigate with explicit consent and NFR-11; needs legal review |
| **CON-07** | The quota belongs to the accounts, not to the service | The product redistributes; it cannot create headroom. Everything rests on rotation clearing a limit (G-5, ASM-09) |
| **CON-08** | No revenue | NFR-03, NFR-08 and NFR-15 all carry ongoing cost against donations. Either the community-hosted mode is scoped to what a volunteer can carry, or it is not offered |
| **CON-09** | Blind-tunnelled **payloads** are opaque by design | The destination is not: host and port are known at CONNECT and already logged on failure (`src/mitm.js:204`), so this traffic can be attributed and rate-limited even though its content cannot be inspected. Only the content sits outside the guarantees here |
| **CON-10** | The client is not ours | Its behaviour can change under the service at any time (ASM-10), and there is no way to pin what users run beyond refusing old versions (FR-10) |

### 4.5 Gap analysis

Which of the above already exist in the codebase.

#### A — already present, reusable as-is

| Requirement | Existing implementation |
| --- | --- |
| Off-box binding | `proxy.host`, `TEAMCLAUDE_HOST` |
| Remote client auth | `proxy.apiKey` (`x-api-key`, `Proxy-Authorization`) |
| Egress IP pinning | `egress.pin`, `src/egress-guard.js` |
| Residential egress fallback | `sx.apiKey`, `sx.mode` |
| Quota tracking, rotation, retry | `src/account-manager.js` |
| Concurrency control | `stormRamp`, `admit`/`release` |
| Session affinity | `distributeSessions`, `src/session-tracker.js` |
| Model routing and blocking | `routes`, `blockedModels`, `modelMap` |
| Token refresh, 401 re-auth, 403 failover | `ensureTokenFresh`, `forwardRequest` |
| MITM CA and leaf issuance | `src/mitm.js`, `src/x509.js` |

#### B — present but needs changing for hosted use

| Item | Today | Needed | Tracked |
| --- | --- | --- | --- |
| Config store | one file, process-wide lock | per-tenant store, distributed lock | [#4](../../issues/4) |
| `AccountManager` | a single instance | per-tenant instance and lifecycle | [#4](../../issues/4) |
| CA | one global chain, **CA key discarded** | per-tenant, key in a KMS | [#5](../../issues/5) |
| Path classification | 3 exceptions, everything else rotates | only inference rotates | [PR #2](../../pull/2) |
| CONNECT targets | blind tunnel by default | upstream host allowlist | [#8](../../issues/8) |
| Test-host intercept | answers for a real public domain | remove | [#8](../../issues/8) |
| Loopback auth exemption | always exempt | must be disableable | [#8](../../issues/8) |
| TUI | inside the server process | separate web dashboard | — |

#### C — does not exist yet

| Item | Note | Tracked |
| --- | --- | --- |
| TLS on the proxy listener | without it the off-box mode sends the proxy key in clear | [PR #1](../../pull/1) |
| mTLS device authentication | behavior already measured (F01, F08); only implementation remains | [#6](../../issues/6) |
| Multi-tenancy | there is no tenant concept in the code at all | [#4](../../issues/4) |
| Hosted OAuth enrollment | the current flow is localhost-callback only | [#7](../../issues/7) |
| Token-invalidation detection and re-auth | locally one `login`; hosted it is a dashboard round trip | [#7](../../issues/7) |
| Signup, dashboard, offboarding | the whole control plane. No billing — §0 non-goals | [#7](../../issues/7) |

---

## 5. Open items

### OAuth `redirect_uri` policy — [#7](../../issues/7)

Whether a hosted callback URI is accepted is unconfirmed. An unauthenticated probe cannot
answer it: bot protection returns the same refusal for every value, including the
localhost baseline that is known to work. It needs a real browser session.

Low priority — the paste-the-code flow works either way, so this only decides whether the
dashboard can offer a smoother redirect.

### Backlog — egress IP treatment — [#3](../../issues/3)

How the upstream treats the **source IP** of a request. Locally that is one consumer line
carrying one person's accounts; hosted, it becomes a datacenter address carrying several
people's accounts. `docs/proxy-modes.md` notes that some limits key on the outbound IP
rather than the account, which is what makes it a question at all.

**Deliberately out of scope for the build.** Three reasons:

1. **Nothing is built from the answer.** The mitigations already exist — `egress.pin`
   holds a request rather than sending it from an unexpected address, and
   `sx.mode: "429"` retries through a different egress. A bad result turns a config flag
   on; it does not change the architecture.
2. **No design depends on it.** Every architectural question is settled by F01–F13.
3. **A complete answer is not obtainable yet.** A cheap check — point `upstreamProxy` at
   a proxy on a cloud host and keep using the existing setup — only exercises *one
   person's* accounts behind one address. The concern is *several people's* accounts
   sharing one, which cannot be observed before real multi-tenant traffic exists. So it
   cannot be a prerequisite for the work that produces that traffic. M1 is where it first
becomes observable.

Revisit as a deployment checklist item: set `upstreamProxy`, use it normally, and watch
whether rotation still clears a limit.

---

## 6. Milestones

Community-hosted is the target (§0). The sequence below reaches a **self-hostable** system
first, because everything that milestone needs is needed by the hosted build anyway, and
because it puts a running system in front of the questions that are currently estimates —
egress behaviour (ASM-09) and whether donations can carry the cost (CON-08).

Each milestone is a state the project can stop at without leaving something half-built.

### M0 — Correctness on the current proxy · **done**

Fixes that stand on their own, independent of any hosting plan.

| | Requirement | Landed |
| --- | --- | --- |
| TLS on the listener, so the proxy key never crosses in clear | NFR-01 | [#1](../../pull/1) |
| Rotate only on inference paths | FR-05, FR-06 | [#2](../../pull/2) |
| Verification loop: test isolation, per-test timeout, CI | §8.2 | [#12](../../pull/12) |

### M1 — Self-hostable

Run it on your own host; reach it from your own machines. One operator, own accounts, no
control plane.

| | Requirement | Tracked | Spec |
| --- | --- | --- | --- |
| Decide the internal seams the M1 tasks share, before implementing against them | — | [#31](../../issues/31) | [seams](plans/contracts/m1-internal-seams.md) |
| Enrolment writes **both** config locations, and ships the artifacts | FR-03, FR-16, FR-18 | [#19](../../issues/19) | [enrolment](specs/m1-enrolment.md) |
| CONNECT destination allowlist, address policy, and a listener that fails closed | FR-07, NFR-20, NFR-21 | [#8](../../issues/8) | [hardening](specs/m1-hardening.md) |
| Failures are legible, and removing the config restores direct operation | FR-17, NFR-13 | [#20](../../issues/20) | [failure modes](specs/m1-failure-modes.md) |
| Renew MITM certificates on age, not only on host mismatch | NFR-17 | [#21](../../issues/21) | [certificates](specs/m1-certificates.md) |
| Boundary values exercised wherever a requirement classifies a range | NFR-26 | [#8](../../issues/8) | [hardening](specs/m1-hardening.md) |
| A review finding carries a severity and gates the milestone | NFR-27 | [#8](../../issues/8) | — |
| SSE responses survive the edge — no idle timeout below the client's watchdogs | NFR-07 | [#8](../../issues/8) | — |
| The measured latency headroom is not spent — address resolution must not add a lookup per request | NFR-06 | [#8](../../issues/8) | — |

Each row has a spec in [`docs/specs/`](specs/) decomposing its register entries into
numbered, testable sub-requirements. Every claim in those specs about current behaviour
cites a source line, and the citations are checked against the files.

[#21](../../issues/21) is a defect in the current proxy, found while verifying NFR-17:
`leafCovers()` checks the signature and the SANs but never the validity dates, so an
expired leaf is reused rather than replaced. Locally that costs one `rm`; once devices
have been handed a CA it breaks all of them at once, which is what puts it in M1.

Authentication is already sufficient here: `proxy.apiKey` over the TLS listener
([#1](../../pull/1)) authenticates a remote client and keeps the key off the wire. Device
certificates are **not** an M1 requirement — with one operator and their own machines, a
lost device is handled by rotating the proxy key. Per-device identity only becomes
necessary once devices belong to different people, so mTLS enforcement moves to M2.
Enrolment still places the certificate files, so M2 does not have to redo it.

**Exit:** G-1 (a machine enrolled, no resident process) and G-6 (legible failure). G-5
becomes observable here — this is where ASM-09 stops being an estimate.

### M2 — Multi-tenant core

The point at which it can hold someone else's credentials at all.

| | Requirement | Tracked |
| --- | --- | --- |
| Per-tenant config store, `AccountManager`, distributed locking | FR-01, NFR-09 | [#4](../../issues/4) |
| Device certificates, issued and revocable; mTLS enforced on the rotation path | FR-02, NFR-02 | [#6](../../issues/6) |
| Per-tenant CA with the key in a KMS | FR-04, NFR-03 | [#5](../../issues/5) |
| Envelope-encrypted tokens; audit every credential access | NFR-04, NFR-11 | [#5](../../issues/5) |
| Request-body logging off by default; encrypted and short-lived when on | NFR-05 | [#5](../../issues/5) |
| Keep the client-tracking code isolated and independently testable | NFR-22 | [#16](../../issues/16) |
| Minimum client version, and a canary on each release | FR-10, NFR-10 | [#16](../../issues/16) |
| Watch the upstream response contract | ASM-11 | — |

**Exit:** G-3 (no request ever served with another person's account) and G-4 (revoke one
device without disturbing that person's others).

### M3 — Control plane

| | Requirement | Tracked |
| --- | --- | --- |
| Signup and dashboard authentication | FR-11, FR-13, NFR-19 | [#7](../../issues/7) |
| OAuth enrolment by pasted code; re-auth when a token is invalidated | FR-08, FR-09 | [#7](../../issues/7) |
| Offboarding: revoke devices, delete tokens, confirm | FR-14, FR-15 | [#7](../../issues/7) |
| Per-person usage and quota visibility | FR-12 | — |

### M4 — Operable for other people

Not features — the things that make it defensible to run for anyone but yourself.

| | Requirement | Tracked |
| --- | --- | --- |
| Stated availability posture; recovery objectives; backup and a rehearsed restore | NFR-12, NFR-14, NFR-23 | [#22](../../issues/22) |
| Fair-share between tenants | NFR-16 | [#23](../../issues/23) |
| Secret rotation and revocation | NFR-17 | [#24](../../issues/24) |
| Incident process; declared data residency; third parties identified; threat model maintained | NFR-15, NFR-18, NFR-24, NFR-25 | [#25](../../issues/25) |
| Per-tenant egress | NFR-08 | — |
| Rewrite the compliance documentation | CON-06 | — |

[#3](../../issues/3) stays **out of every milestone**: it is backlog by decision (§5), and
giving it one would present it as scheduled work.

### The M4 decision

The audit noted this was written as a note while being the most consequential decision in
the document (C-1). Stated as a decision:

| | |
| --- | --- |
| **Question** | Is the community-hosted mode offered at all? |
| **Owner** | Repository owner |
| **Inputs** | RSK-01 measured with M1 running · RSK-08 actual cost against actual donations · legal review of RSK-05 · the incident posture in [#25](../../issues/25) |
| **Outcomes** | Offer it · offer it with a scope honestly reduced to what one person can carry · do not offer it, and ship self-hostable only |
| **Not deciding** | is itself an outcome — it leaves M1 shipped and M2–M4 unbuilt, which is a legitimate place to stop |

**Gate.** M4 is where CON-08 has to be answered: NFR-03, NFR-08 and NFR-15 all carry
ongoing cost against donations. Either this milestone is scoped to what a volunteer can
carry, or the community-hosted mode is not offered. Legal review belongs here too — see
[`docs/compliance.md`](compliance.md), which asserts three things a hosted deployment
inverts.

---

## 7. Data protection

Terminating TLS in the cloud means **every prompt and every piece of source code exists in
plaintext in server memory**. The request body is buffered in full so it can be replayed
on another account, so this cannot be avoided.

| Item | Requirement |
| --- | --- |
| Request logging | Off by default. When on: per-tenant encryption, short retention, automatic deletion |
| Memory | Discard buffers immediately after the response; disable core dumps. **Not today**: the body is held across every retry and for the whole `holdSeconds` wait, because it must be replayable on another account (ASM-37) |
| Crash and error reporting | Must not capture request bodies. **Not today**: `crash-log.js` writes a stack that its own comment says can carry request context (ASM-38) |
| Token storage | Envelope encryption — currently plaintext JSON at `0600` |
| Legal | Privacy policy, processor disclosure, DPA |
| Background features | Keep-warm and the quota probe are **not offered** in a hosted product — an always-on server making them on its own reads as unattended automation |

> **Credential custody.** Because each user only ever uses their own accounts, account
> sharing does not arise. What is genuinely unsettled is how uploading one's own refresh
> token to a service is read under the terms. Mitigate with a self-hostable distribution,
> explicit consent, and access audit logging — and **get legal review.**

---

## 8. To settle before building

### 8.1 mTLS enforcement point — settled

Enforce mTLS **on the rotation path**, not at the TLS layer.

Both work on a current client (F14, F17). The rotation path is the durable one:
TLS-layer enforcement fails closed for *every* request the moment a release changes which
paths carry a certificate, and F03 and F06 both found behaviour moving between releases in
exactly this area. Per-request enforcement degrades instead of locking everyone out, and
it is the check that matters — the rotation path is the only one that spends an account.

Unblocks [#6](../../issues/6).

### 8.2 Verification loop — done

Fixed in [#12](../../pull/12): the tests no longer inherit ambient `HTTP(S)_PROXY`, and
the suite carries a per-test timeout. CI is green on Linux across Node 20, 22 and 24, and
runs automatically on push and pull request.

### 8.3 Compliance documentation — done

Scoped to the local proxy in [#13](../../pull/13), pointing here. The full rewrite stays
a milestone-4 gate and wants legal review.

### 8.4 Enforce a minimum client version — open

Supporting only current clients is a deliberate decision. In a hosted product users
install their own client, so "we only run the latest" is not something the operator
observes — it has to be **enforced**, or an old client silently gets a worse contract than
the design assumes.

| Requirement | Note |
| --- | --- |
| Minimum supported version, published | Below it, refuse with an error naming the version and how to update |
| Detect the client version per request | The user agent is the obvious carrier; confirm it reaches the rotation path |
| Version canary before adopting a release | A release that changes which paths carry a device certificate, or how a proxy URL is honoured, must be caught before users hit it. Watch more than the CLI version: the same request carries `x-stainless-package-version` and a dated `anthropic-beta` list, and those move independently (ASM-40) |

The canary is the durable half. Pinning to "latest" trades an old-client problem for a
new-client one: the client can change under the service at any time, so the measurements
here have a shelf life.

Not yet tracked as an issue.

### 8.5 Client platform coverage — open

The thin-client claim (§1) is measured on **Windows and Linux**, in `-p` and background
modes (F01–F04, F08, F14–F17). Two axes remain, both needing a machine or terminal this
work did not have:

- **macOS** — the harness is directly reusable; an afternoon, not a project
- **Interactive mode** — every run was `-p` or `--bg`; request patterns may differ

Either could add a client requirement. Neither can change the architecture.

### 8.6 Corporate proxy — a limitation, not a gap

A client behind an **explicit** corporate proxy cannot use a hosted MITM proxy.
`HTTPS_PROXY` holds one value, and Claude Code has no proxy-chaining setting, so a user
who must traverse a corporate proxy to reach the internet has nowhere to put ours.
Transparent, network-level corporate proxies are unaffected.

The reverse direction — teamclaude itself reaching upstream through another proxy — is
already supported and covered by the existing `upstream-proxy` tests.

Record this as a documented limitation rather than something to solve.

---

## 9. Asset and data inventory

Every control in §7 depends on knowing what is held where, and nothing said so until the
standards audit reached the same gap from two directions — as a missing security asset
register (F-1) and as a missing architecture information view (H-1).

Classification: **critical** means loss or disclosure is unrecoverable for the user.

**Retention is what the requirements ask for, not what the code does today.** ASM-25 records
the gap: nothing deletes a request log. The column is a target until NFR-05 lands.

| Asset | Where it lives | Class | Retention (target) | Protected by |
| --- | --- | --- | --- | --- |
| OAuth refresh tokens | Config store, at rest | **critical** | Life of the account registration; destroyed on offboarding | NFR-04 envelope encryption, NFR-11 audit, FR-14 deletion |
| OAuth access tokens | Memory; written back on refresh | **critical** | Until expiry | NFR-04 |
| Tenant CA private key | KMS from M2; discarded today (`src/mitm.js:83`) | **critical** | Life of the tenant | NFR-03 |
| Device private key | The user's own machine only | high | Life of the device | FR-16.1 owner-only permissions |
| Proxy API key | Config store | high | Until rotated — **no rotation path today** | NFR-17, [#24](../../issues/24) |
| **Prompt and file content** | Server memory, in plaintext, buffered whole | **critical** | Discarded after the response — **not persisted** | CON-02, NFR-05 logging off by default |
| Request logs, when enabled | Disk | **critical** — contains the above | Short, automatic deletion | NFR-05, NFR-18 residency |
| Observed quota state | Disk, `teamclaude.state.json` | **medium** — carries `accountUuid`, `orgName` and the email-derived display name beside the counters (`src/account-manager.js:1276`), so it is identity, not just quota (ASM-26) | Counters are disposable; the identity is not | — |
| Crash log | Disk, `teamclaude-crash.log`, mode `0600` | **critical** — a stack can carry request context, which is why it is `0600` (`src/crash-log.js`) | Until deleted by hand (ASM-24) | mode only |
| Account identity, org names | Config store | medium | Life of the registration | NFR-11 |

**Traffic that leaves without being held.** Blind-tunnelled destinations (FR-07.3) are
spliced, never inspected. CON-09 records that the **payload** is by design outside this
table; the destination is not, and is available for attribution and rate limiting.

### Third parties — NFR-24

| Party | Receives | When |
| --- | --- | --- |
| The hosting provider | Everything in this table; TLS terminates on their infrastructure | Always, community-hosted |
| sx.org | Upstream traffic, as ciphertext — TLS is end-to-end through their tunnel | Only when `sx.mode` is `always` or after a 429 |
| The upstream API | Prompts, and the account token being used | Always — this is the product |

sx.org sees ciphertext, not content. It is listed because relaying a user's traffic is a
data-processing relationship regardless of what is visible in it.

---

## 10. Risk register

The audit found risks identified and treated, but never rated, ordered, owned, or followed
by a statement of what the treatment leaves behind (B-1, B-2, B-3).

**L** likelihood · **I** impact, each low / medium / high.

| | Risk | L | I | Treatment | Residual | Owner | Review when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **RSK-01** | Limits key on the egress IP, so pooling accounts behind one address yields no multiple — the product premise | M | **H** | `egress.pin` holds; `sx.mode` retries from another IP | **Metered per-GB spend against donations** (CON-08) | Operator | M1 running, first real traffic |
| **RSK-02** | The allowlist refuses a host a real session needs | M | M | FR-07.5 composes it by running a client and recording refusals | **Interactive mode is unmeasured** (ASM-08, ASM-14), so the list is incomplete by construction | Operator | Any client release; first interactive use |
| **RSK-03** | A client release moves the behaviour this design rests on | **H** | **H** | NFR-10 canary before adopting a release as the floor; NFR-22 isolates the tracking code. The canary must watch `x-stainless-package-version` and the dated `anthropic-beta` list as well as the CLI version — they move independently (ASM-40) | Detection is reactive — the canary runs after the release exists. NFR-17.5 has landed, so a regenerated chain no longer waits for a restart (ASM-15) | Operator | Every client release |
| **RSK-04** | The upstream response contract changes and quota tracking degrades **silently** | M | **H** | Treatment now scheduled — [#30](../../issues/30), folded into the same canary as RSK-03 | Until #30 lands, still untreated and still silent | Operator | — none defined |
| **RSK-05** | Credential custody is read as prohibited under the consumer terms | L | **H** | Self-hostable build; explicit consent; NFR-11 audit | Interpretation is not the operator's to make; legal review is advisory | Owner | Before community-hosted launch |
| **RSK-06** | Plaintext prompts in server memory are disclosed | L | **H** | NFR-05 logging off, NFR-15 incident process, short retention | **Unavoidable while TLS terminates in the cloud** (CON-02) | Operator | On any incident; M4 gate |
| **RSK-07** | An operator deliberately opens a hardening switch and is compromised | L | M | Defaults derive from `proxy.host`, so the unsafe state needs intent | **No guard rail against the deliberate case** | Operator | — |
| **RSK-08** | Donations do not cover KMS, dedicated egress and on-call | **H** | M | Scope M4 to what a volunteer can carry, or do not offer hosting | This is the M4 gate, not a risk to mitigate away | Owner | M4 gate |

**RSK-04 is the one to act on.** It is the only high-impact risk with no treatment at all, and
its failure mode is silence — rotation degrades and nothing reports it. RSK-03 at least
announces itself when a canary fails.

**RSK-01 and RSK-08 are the same question** seen from two sides: whether the economics work. Both
resolve at the M4 gate, and both are answerable only with M1 running.

### Review

Risks are reviewed at each milestone gate, and on any client or upstream release. RSK-04 has
no trigger because nothing detects it — closing that is what a treatment for RSK-04 would
mean.

---

## 11. Appendix

### Reproducing the measurements

Stand up a dummy MITM proxy, drive Claude Code through it, and observe the handshakes and
request paths. Nothing is forwarded upstream — the intercepted request is answered
locally, so this consumes no quota and needs no real credentials.

1. Generate a CA, a leaf and a device certificate. The leaf's SAN must contain **both the
   upstream hostname and the hostname used to reach the proxy** (F03).
2. Terminate CONNECT with a TLS server configured `requestCert: true`,
   `rejectUnauthorized: false` — the goal is to *observe*, not to enforce.
3. On `secureConnection`, record `getPeerCertificate()`.
4. Point the client at the proxy with the CA and device certificate, and make one request.

Repeat across the environment axes: client version, injection method (shell vs
`settings.json`), OS, and edge configuration (direct / TCP passthrough / TLS termination).

### Traps found while measuring

- **Certificate SAN.** If the hostname used to reach the proxy is absent from the SAN, the
  connection fails in a way that is indistinguishable from "protocol unsupported". A
  public issue appears to have misdiagnosed exactly this (F03).
- **Double TLS termination.** If the edge and the backend both terminate TLS, the backend
  reads a plaintext CONNECT as a TLS record and fails. When the edge terminates, the
  backend must be a plaintext listener.
- **Ambient proxy variables.** Running the test suite with proxy environment variables set
  produces unrelated failures. This affects the repository's existing tests too
  ([#9](../../issues/9)).

### Axes not measured

- macOS — the harness is directly reusable
- Interactive mode — every run was `-p` or `--bg`; request patterns may differ

Both are §8.5. Everything else once listed here has since been measured or resolved:
background agents (F15–F17), concurrent sessions on one account (F18), and corporate
proxy nesting (§8.6, a limitation rather than an open question).

### What the assumption sweep can and cannot establish

Forty-two assumptions were recovered from documents that read as fact. The method that
found them, and its limits, so the next sweep does not repeat the same hole.

**The method.** Extract every absolute claim about behaviour — `never`, `nothing`, `only`,
`cannot`, `every` — and classify each by what stands behind it. 71 were found across the
specs and contracts.

**The hole in the first pass.** Only *unsourced* claims were checked. A claim with a
citation was treated as settled — but a citation to vendor documentation is deference, not
verification. Three claims sat behind links and read as established: CON-01, CON-04, and
`downloads.claude.ai` carrying self-update. They are now the `deferred` class.

**What this cannot do.**

| | |
| --- | --- |
| Prove exhaustion | No count of found assumptions bounds the unfound ones. "The sweep stopped producing new results" is a statement about the sweep |
| Verify an absence in a closed binary | CON-01 claims the client has *no* chaining mechanism. That can be bounded by the documented surface and never proven from outside |
| Survive a change | Every `source-read` entry is true of a line at a commit. The code moves; ASM-10 already records that the client does too |
| Reach what was never written down | Six of these were found by **measuring**, not by reading — ASM-17, ASM-28, ASM-32, ASM-36, ASM-37, ASM-39. A text sweep cannot find an assumption nobody wrote a sentence about |

That last row is the real limit. The sweep finds assumptions that were *stated*
carelessly. Assumptions that were never stated at all only surface when something is run,
which is why measurement kept producing findings after the reading had gone quiet.

**What is enforced instead.** `test/requirements-coverage.test.js` requires every ASM entry
to carry a verdict and its grounds. That does not prove the set is complete; it makes an
unchecked entry fail a run rather than sit quietly, which is the difference between a gap
and a known gap.

### Findings resting on a single observation

Recorded so they are not mistaken for the multi-environment results above:

- **F09** — refusing *telemetry* CONNECTs was observed safe on one `-p` run. It does not
  generalise: `downloads.claude.ai` carries plugin and self-update traffic, and a
  background agent reaches for it. The allowlist in [#8](../../issues/8) has to be
  composed from what the client actually needs, not assumed from this one result.
- **F12** — latency was compared on one network path. Useful as a direction, not a number
  to plan capacity from.
