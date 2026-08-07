# M1 — Failure modes

Detailed requirements for [#20](../../../issues/20), decomposing two register entries:

| Register entry | Decomposed here as |
| --- | --- |
| **FR-17** — surface why a request failed | FR-17.1 … FR-17.3 |
| **NFR-13** — degrade legibly; removing the config restores direct operation | NFR-13.1, NFR-13.2 |

Together these close **G-6**, which had no requirement behind it until the audit.

Every statement about current behaviour was read out of the source and cites where.

---

## 1. What the proxy already does well

`forwardRequest()` distinguishes failure modes rather than passing them through, and
several of its messages are already the shape this spec asks for.

| Situation | Response | Source |
| --- | --- | --- |
| Every account refused (403) | `502` — *"Upstream refused the credential for account "x" (403). Check the account, then re-add it with: `teamclaude login`"* | `src/server.js:745` |
| Pinned account unavailable | `429` — names the cause, says to retry | `:759` |
| Unknown account pin | `404` — quotes the token that did not resolve | `:410`, `:429` |
| Blocked model | `400` — names the model and the pattern it matched | `:471` |
| Bad proxy key | `401` — *"Invalid proxy API key"* | `:114` |

The 403 case is the one to copy. Upstream refusing an **account** is not the client's
fault, and passing the 403 through would make the CLI drop its own login over someone
else's problem — so the proxy answers 502 with an explanation and a command to run.

That judgement is right. What follows extends it to the failures that only exist once the
proxy is somewhere else.

---

## 2. What is missing

### 2.1 Every transport failure looks the same

`proxy_error` / *"Upstream unreachable"* appears at `:276`, `:551` and `:659`, and
*"Internal proxy error"* at `:489`. From the client, a proxy that cannot reach the upstream
is indistinguishable from one that is itself broken.

Locally that is tolerable — the operator is the user, and the logs are on the same
machine. Hosted, the person seeing it has neither.

### 2.2 The hosted failures have no representation at all

None of these can occur today, so nothing produces them:

| | |
| --- | --- |
| The proxy host is unreachable | The client sees a transport error naming a host it was told to trust, with no indication the service is the cause |
| The client is below the version floor | [#16](../../../issues/16) will refuse it; nothing says how to recover |
| The destination was refused by the allowlist | [#8](../../../issues/8) adds `403`; it must say which host and why |
| Tenant fair-share ceiling reached | [#23](../../../issues/23), M4 |

### 2.3 There is no documented way back

Nothing describes how a user returns to working when the service is down. Enrolment writes
two configuration locations ([#19](../../../issues/19)); undoing that is the escape hatch,
and it exists only as an implication.

---

## 3. Requirements

### 3.1 Legible failure

> **FR-17.1** Every failure the proxy originates MUST be distinguishable from every other by
> its response body, and MUST NOT be reported as a generic proxy error.

At minimum: upstream unreachable · all accounts exhausted · credential refused · destination
refused · client version too old · proxy internal fault.

> **FR-17.2** A failure the user can act on MUST say what to do, in the body, naming the
> concrete step.

The 403 message at `:745` is the model: it names the account and gives the command. A
message that only describes the state leaves the user to guess.

> **FR-17.3** A failure the user cannot act on MUST say so, and MUST carry an identifier the
> operator can correlate with server-side logs.

"Retry later, reference `<id>`" is a better answer than a description of an internal fault
the user cannot do anything about. It also gives a donation-funded operator a way to
receive a useful report instead of "it broke".

### 3.2 Degradation

> **NFR-13.1** When the proxy is unreachable, the failure MUST be attributable to the
> proxy rather than presenting as a generic network or credential error.

The client's own transport error is what it is — the proxy cannot shape a message it never
received. What this requires is that enrolment leaves behind something that makes the
answer findable: the documented `unenrol` step, and a name in the configuration that is
obviously the service rather than an opaque host.

> **NFR-13.2** Removing the enrolment MUST restore direct operation completely, and MUST be
> documented as the recovery step.

This is FR-03.5 seen from the other side. It is the requirement that keeps an outage from
becoming a lost day, and it matters more than any availability figure in
[#22](../../../issues/22) — because it is the part that does not depend on the operator
being awake.

---

## 4. Configuration surface

None. This spec changes response bodies and documentation, not configuration.

---

## 5. Tests

| | Asserts |
| --- | --- |
| Each failure class produces a distinct `error.type` and message | FR-17.1 |
| An actionable failure names the step to take | FR-17.2 |
| A non-actionable failure carries a correlation id, and the id appears in the server log | FR-17.3 |
| `unenrol` leaves a machine that reaches the upstream directly | NFR-13.2 |

The existing suite already covers the 403, 429 and pin paths — `test/server-403.test.js`,
`test/server-429.test.js`, `test/account-pin.test.js`. New tests extend that pattern rather
than starting fresh.

NFR-13.1 has no unit test: it is a property of what enrolment leaves behind and of the
documentation, not of a code path.

---

## 6. Open

- **The correlation id in FR-17.3 implies request-scoped logging** that survives to where an
  operator can search it. `logDir` (`src/server.js`) writes per-request files locally; the
  hosted equivalent is not designed and belongs with [#22](../../../issues/22).
- **NFR-13.1 is weaker than it looks.** The proxy cannot shape a message for a request that
  never arrived. What it can do is make the answer findable, and that is documentation more
  than code.
