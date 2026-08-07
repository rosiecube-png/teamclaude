# Contract — proxy-originated error envelope (M1)

Defined **before** the implementation tasks, per the API-first guardrail. `task-3`, `task-4`
and `task-5` all emit against this shape.

## Envelope

Unchanged from what the proxy already emits, so clients that parse Anthropic errors keep
working:

```json
{ "type": "error", "error": { "type": "<class>", "message": "<human sentence>" } }
```

Existing examples this follows: `src/server.js:745` (credential refused), `:759` (pinned
account), `:114` (bad proxy key).

## Classes

`error.type` is the machine-readable discriminator. FR-17.1 requires every proxy-originated
failure to be distinguishable, so each row below is a distinct value.

| HTTP | `error.type` | Raised when | Requirement |
| --- | --- | --- | --- |
| 403 | `destination_not_allowed` | CONNECT or forward target is not on the allowlist | FR-07.4 |
| 403 | `destination_address_blocked` | Target resolved to a loopback, link-local or private address | NFR-21.1 |
| 403 | `destination_port_not_allowed` | Target port is not 443 | NFR-21.3 |
| 407 | `authentication_error` | Non-loopback client presented no or wrong proxy key | existing |
| 502 | `upstream_unreachable` | The proxy could not reach the upstream | FR-17.1 |
| 502 | `proxy_internal_error` | Fault inside the proxy | FR-17.3 |
| 429 | `rate_limit_error` | Quota exhausted or throttled | existing |

`upstream_unreachable` and `proxy_internal_error` split what `src/server.js:276`, `:551`,
`:659` and `:489` currently all report as `proxy_error` with one of two messages.

## Message rules

**FR-17.2 — actionable failures name the step.** The model is the existing 403 handler:

> `Upstream refused the credential for account "x" (403). Check the account, then re-add it with: teamclaude login`

State, then the command or setting to change.

**FR-17.3 — non-actionable failures carry a correlation id.**

```json
{ "type": "error",
  "error": { "type": "proxy_internal_error",
             "message": "The proxy failed to handle this request. Retry shortly. Reference: 7f3a9c21." } }
```

| | |
| --- | --- |
| Field | Appended to `message`, not a new key — the envelope stays as clients expect |
| Format | 8 hex characters, unique per request |
| Also written to | The server log line for that request, so an operator can find it |

A destination refusal carries **no** id: the user can act on it, so FR-17.2 applies instead.

## Why `403` is used here, when the codebase avoids it elsewhere

`src/server.js` deliberately does **not** pass an upstream `403` to the client:

> Claude Code reads a 403 as "your session is dead", drops its own login and asks for a
> re-login over an account problem it has no part in.

That lesson is about a `403` on the **API response** path. These three are `403` on a
**CONNECT**, which F09 measured: refused CONNECTs were answered `403` and the client
carried on normally.

The tension is real and the measurement is thin — one `-p` run, telemetry hosts only
(ASM-23). Two things keep it bounded:

- The upstream host is **always** `intercept`, so it can never be refused. The dangerous
  case cannot arise from this policy.
- If a client is ever seen dropping its login after a refusal, the fix is a different
  status, not a different message — the class names above stay.

## Headers

No new headers. `retry-after` keeps its current meaning on 429.

**`error.type` may reach the operator and not the user (ASM-29).** Nothing confirms the
client branches on it rather than showing `message` alone. So the `message` has to carry
the whole story on its own, and `error.type` is treated as a log and support affordance
rather than the primary channel.

## Not in scope

Client version enforcement ([#16](../../../issues/16), M2) will add a class here. Reserve
`client_version_unsupported`; do not implement it in M1.
