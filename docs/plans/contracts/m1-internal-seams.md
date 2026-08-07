# Contract — internal seams (M1)

Three seams are shared by more than one M1 task. Deciding them here is the same discipline
already applied to the [error envelope](m1-error-envelope.md), turned inward: if each task
invents its own, `task-4` builds something different from `task-3` and `task-5` builds a
third.

Each decision follows a pattern the codebase already uses rather than introducing one.

| | Seam | Needed by | Follows |
| --- | --- | --- | --- |
| **S1** | Destination resolution and policy | task-3 | `createEgressGuard` — an opt-in policy collaborator |
| **S2** | Request correlation | task-4, task-5 | The existing `ctx` object |
| **S3** | Enrolment module boundary | task-2 | `alias.js` writes, `claude-env.js` stays pure |

---

## S1 — destination resolution and policy

### The problem

`net.connect(port, host)` (`src/mitm.js:197`) takes a **hostname** and resolves it itself.
NFR-21.2 requires connecting to the address that was checked, so resolution has to happen
where the policy can see it — and a test has to be able to force a name to a private
address, and to answer differently on a second lookup.

There is no DNS handling in `src/` today, so this is new code rather than a change.

### The decision

A policy collaborator, injected through the options bag both entry points already use
(`src/mitm.js:113`, `src/server.js:327`), exactly as `egress` is:

```js
// src/destination-policy.js
export function createDestinationPolicy(config, { lookup = dnsLookup, log } = {}) { … }
```

```js
/**
 * Decide what to do with a CONNECT or forward target, resolving it once.
 *
 * Returns the address to dial, so the caller never re-resolves — that second
 * lookup is the DNS-rebinding hole NFR-21.2 exists to close.
 *
 * @returns {Promise<
 *   | { action: 'intercept' }
 *   | { action: 'tunnel', address: string, family: 4|6 }
 *   | { action: 'refuse', reason: 'not_allowed'|'address_blocked'|'port_not_allowed', detail: string }
 * >}
 */
policy.classify(host, port)
```

- `intercept` carries no address: the MITM path terminates locally and dials upstream
  through `upstreamFetch`, which has its own proxy and sx handling.
- `tunnel` carries the resolved address, and the caller **must** pass it to `net.connect`
  in place of the hostname.
- `refuse` carries a reason that maps one-to-one onto the error classes in the
  [error envelope](m1-error-envelope.md).

`lookup` is the seam. Default is `node:dns` `promises.lookup(host, { all: true })`;
a test supplies its own and can return a different answer per call.

### Why this shape

The alternative was a boolean guard plus a separate resolve step. That leaves the caller
holding two facts that must agree — "allowed" and "which address" — and nothing forces it
to use the second. Returning the address **with** the verdict makes the safe path the only
path that compiles.

`createEgressGuard(config, log)` (`src/egress-guard.js:122`) is the precedent: opt-in,
constructed from config, injected, inert when unconfigured.

### Caching

NFR-06 requires that this not add a lookup per request. A resolution is reused for the
life of a tunnel at minimum. Anything longer is a cache with an invalidation policy, which
is a decision for task-3 with measurements in hand — not one to make here.

---

## S2 — request correlation

### The problem

FR-17.3 needs the same identifier in the response body and in the server log. Today
`reqId` (`src/server.js:434`) is a process-local counter that reaches the TUI hooks and
**not** the log lines — `console.log` calls at `:779`, `:788`, `:938`, `:941`, `:972` carry
account names and no request identity.

And CONNECT refusals happen in `src/mitm.js` before any request exists, so there is no
`ctx` to hang an id on.

### The decision

```js
// src/request-id.js
export function newCorrelationId() { … }   // 8 lowercase hex characters
```

| | |
| --- | --- |
| **Request path** | Generated where `ctx` is built (`src/server.js:477`) and carried as `ctx.correlationId` |
| **CONNECT path** | Generated per refusal in the connect handler; there is no request to correlate, only the refusal itself |
| **In the log** | Prefixed to any line about a specific request: `[TeamClaude] [7f3a9c21] …` |
| **In the response** | Appended to `message`, never a new field — the envelope stays what clients parse |

`reqId` stays as it is. It numbers requests for the activity stream, which is a display
concern; conflating the two would change TUI behaviour for no benefit.

### Scope

Only failures the user cannot act on carry an id (FR-17.3). A destination refusal names
the host and is actionable, so it carries none — see FR-17.2.

---

## S3 — enrolment module boundary

### The problem

The plan named `src/enrol.js` without deciding anything. Enrolment writes two locations,
and the module that builds the shell lines today declares itself side-effect free.

### The decision

| Module | Role | Precedent |
| --- | --- | --- |
| `src/claude-env.js` | **Unchanged, stays pure.** Keeps building env lines | Its own comment: "Pure and side-effect free so it can be unit-tested" (`:14`) |
| `src/enrol.js` | New. Owns the filesystem: merges `~/.claude/settings.json`, places artifacts, and reverses both | `alias.js` already owns writing to a user's shell rc (`installAlias`, `:79`) |

`enrol.js` composes rather than duplicates: it calls `buildClaudeEnvLines()` for the shell
half and installs the result the way `alias.js` installs its line.

```js
export async function enrol({ proxyUrl, caPath, certPath, keyPath, settingsPath, rcPath }) { … }
export async function unenrol({ settingsPath, rcPath }) { … }
export function mergeSettingsEnv(existing, env) { … }   // pure, so FR-03.3 and FR-03.4 are unit-testable
```

`mergeSettingsEnv` is separated out deliberately. FR-03.3 (preserve unrelated keys) and
FR-03.4 (idempotent) are the properties that break silently, and they are assertable
without touching a filesystem.

### Paths are parameters

Every path is an argument with a default, not a constant. `alias.js` does this already
(`rcPath = rcPathForShell(shell)`, `:79`), and it is what lets FR-03.3's test use a fixture
settings file rather than the developer's own — which matters here more than usual, since
writing to a real `~/.claude/settings.json` during a test run has already broken a live
session once.

---

## What this contract does not decide

- **The allowlist contents** — FR-07.5, composed by running a client (task-3)
- **Cache lifetime beyond one tunnel** — needs measurements (task-3)
- **Certificate lifetime defaults** — NFR-17.4, an owner decision (task-1)

Each is recorded where it is owned rather than guessed here.
