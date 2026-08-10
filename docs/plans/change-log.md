# Change trace

Which finding changed which artifact, and in what order.

This exists because "everything is synchronised" was claimed and could not be checked. A
list of ticks is not traceability: it says a thing was done, not what it followed from or
what else it should have touched. ISO 21500 asks for the second.

**The rule.** A finding is not closed until every row in its line is filled or explicitly
marked not-applicable. The artifacts are fixed, so a blank is visible.

| Artifact | Why it is on the list |
| --- | --- |
| Register | `docs/saas-requirements.md` §4 — the requirement, assumption or constraint itself |
| Risks | §10 — a finding can change a treatment or a residual |
| Governance | plan `iso_38500` — a finding can add or remove an approval |
| Spec | `docs/specs/` — the numbered sub-requirement |
| Contract | `docs/plans/contracts/` — an interface or wire shape |
| Plan | `docs/plans/m1-plan.json` — task acceptance criteria |
| Board | `docs/plans/task-board.md` — regenerated from the plan |
| Issue | GitHub — so the person doing the work sees it |
| Test | `test/` — where the finding can be caught mechanically |

---

## 2026-08-07 — assumption sweep

### ASM-15 · certificate regeneration does not take effect

Two memos, `certsPromise` (`src/server.js:182`) and `serverPromises` (`src/mitm.js:131`).

| | |
| --- | --- |
| Register | ASM-15 added |
| Spec | NFR-17.5 added to `m1-certificates.md` |
| Plan | task-1 acceptance criteria |
| Risks | RSK-03 residual — a detected change may not be deployable without a restart |
| Governance | approval added: whether NFR-17.5 ships in M1 or is deferred |
| Issue | [#21](../../issues/21) |
| Board | regenerated |
| Contract | n/a |
| Test | n/a — behaviour, covered by task-1 |

### ASM-16, ASM-17 · a leaf swap costs the client nothing; expiry does not break work in flight

Measured: an established connection carried traffic 2s past `notAfter`; a new one was
refused with `CERT_HAS_EXPIRED`.

| | |
| --- | --- |
| Register | ASM-16, ASM-17 added |
| Spec | `m1-certificates.md` §6 — the lifetime is derived, not chosen |
| Governance | **approval removed**: certificate lifetimes were listed in error |
| Plan | task-1 criteria; `removed_from_approval` records why |
| Issue | [#21](../../issues/21) |
| Others | n/a |

### ASM-18 · settings.json tolerates comments

| | |
| --- | --- |
| Register | ASM-18 added |
| Spec | FR-03.3 extended in `m1-enrolment.md`, plus a test row |
| Plan | task-2 criteria |
| Issue | [#19](../../issues/19) |
| Others | n/a |

### ASM-19, ASM-20, ASM-21 · the address and allowlist rules were samples, not sets

| | |
| --- | --- |
| Register | ASM-19–21 added |
| Spec | NFR-21.5, NFR-21.6 added; FR-07.3 tightened to exact hostnames |
| Plan | task-3 criteria |
| Issue | [#8](../../issues/8) |
| Governance | approval reworded — the allowlist shape is open |
| Others | n/a |

### ASM-23, ASM-29, ASM-43 · how the client reads a refusal

Measured three statuses with one body. `403` → *"Failed to authenticate."*; `502` →
retried; `400` → the message, clean.

| | |
| --- | --- |
| Register | ASM-23 and ASM-29 resolved by measurement; ASM-43 added |
| Contract | `m1-error-envelope.md` — request path `400`, CONNECT `403`, split |
| Contract | `m1-internal-seams.md` — S2, a CONNECT refusal has no body, so its id is log-only |
| Spec | FR-07.4 split in `m1-hardening.md`; FR-17.1 in `m1-failure-modes.md` — the message carries everything |
| Plan | task-3 and task-4 criteria |
| Issue | [#8](../../issues/8), [#20](../../issues/20) |
| Board | regenerated |
| Risks | n/a |

### ASM-24, ASM-25, ASM-26, ASM-37, ASM-38 · documents describing requirements as if they were code

| | |
| --- | --- |
| Register | added; §7 and §9 marked against reality |
| Register | §9 gained the crash log; the quota state reclassified to medium |
| Others | n/a — these correct descriptions, they do not add work |

### ASM-27 · who generates the device key

| | |
| --- | --- |
| Register | ASM-27 added |
| Spec | FR-16.3 added to `m1-enrolment.md`, plus a test row |
| Plan | task-2 criteria |
| Issue | [#19](../../issues/19) |
| Others | n/a |

### ASM-31 · session affinity is keyed by a client-supplied header

| | |
| --- | --- |
| Register | ASM-31 added; **G-3 reworded** to name it |
| Issue | n/a — lands with [#4](../../issues/4) in M2 |
| Others | n/a — M2 work, no M1 artifact changes |

### ASM-39, ASM-40 · the client version reaches the rotation path, and it is not alone

`user-agent: claude-cli/2.1.223`, beside `x-stainless-package-version` and a dated
`anthropic-beta` list that moves independently.

| | |
| --- | --- |
| Register | ASM-39, ASM-40 added |
| Register | NFR-10 extended — the canary watches all three |
| Risks | RSK-03 treatment widened |
| Governance | M4 gate inputs restated |
| Issue | [#16](../../issues/16) covers the canary; [#30](../../issues/30) the upstream half |
| Others | n/a |

### ASM-35, ASM-36, ASM-41, ASM-42 · claims taken from vendor documentation

| | |
| --- | --- |
| Register | evidence classes introduced; these four marked `deferred` |
| Test | the status test accepts the class and requires grounds |
| Others | n/a — nothing to build; they bound what is supported |

---

## 2026-08-07 — task-1, certificate renewal ([#21](../../issues/21))

The first M1 task built rather than written. NFR-17.1 to NFR-17.5.

| | |
| --- | --- |
| Register | ASM-15 ❌ → ✅, the memos are gone · ASM-22 narrowed to its cause · ASM-30 marked *sampled more often* |
| Risks | RSK-03 residual dropped — a detected client change no longer waits for a restart |
| Spec | `m1-certificates.md` §6 is *what shipped*; §1 and §2 moved to the past tense |
| Plan | task-1 `status: done`; scope gained `src/server.js` and `src/index.js` |
| Board | regenerated — status and scope |
| Test | `requirements-coverage` gained *a task owns the files its acceptance criteria name*, with its mutation proof — the class the scope defect got through |
| Contract | n/a — no interface or wire shape changed |
| Governance | n/a — the one approval here was withdrawn on 2026-08-07, and 90/30 shipped as derived |
| Issue | [#21](../../issues/21) |
| Test | `test/cert-lifetime.test.js`, 15 cases |
| Docs | `docs/configuration.md` — `proxy.certs` and a **MITM certificates** section |

### Two things the plan had wrong, found by building it

**task-1 could not be done inside its own scope.** Acceptance criterion 7 names
`src/server.js:182` and the scope listed four files, none of them that one. The plan's
consistency guard checks that no two tasks in a tier own the same file; nothing checked
that a task owns the files its own criteria name. Scope corrected. No tier-2 collision —
task-2 owns `src/enrol.js` and `src/claude-env.js`; `server.js` is otherwise task-3's, in
a later tier.

**Removing a memo made a warning chatty.** `ensureCerts` runs on every intercepted CONNECT
now, so a one-line complaint about a misconfigured `renewBeforeDays` printed on every
connection. Found while writing the sentence in `configuration.md` that claimed it was
said at startup. Now said once per distinct value, with a test that fails without the
guard.

### The measurement that decided the design

NFR-17.5 forbids memoising the renewal check, and the obvious replacement is a TTL — which
needs a third key under `proxy.certs`, a surface the spec had deliberately closed at two.
Revalidating unconditionally was **measured at 0.386 ms** (three file reads, two X.509
parses; the signature verify is 0.024 ms of it) against a CONNECT that then performs a TLS
handshake. No cache, no third key, no staleness semantics to document.

### The tests were shown to fail first

Four mutations, each reintroducing exactly one piece of the old behaviour:

| Reverted to | Caught by |
| --- | --- |
| The server memo ignores which leaf it baked in | *a chain replaced mid-process reaches the next connection* |
| The cert check is memoised for the process lifetime | the same test — each memo alone is enough to break it |
| The reuse check reads no dates (the #21 bug) | 6 tests |
| `leafDays` ignored at issuance | *leafDays and renewBeforeDays are read from proxy.certs* |

The first version of the file also had a defect of its own: a failing assertion left the
tunnel socket open and Node would not exit, so the run hung for ten minutes instead of
reporting. `--test-timeout` does not reach it — the test had finished; the process could
not leave. Then owning both the raw socket and the TLS socket wrapping it and destroying
each in turn crashed the runner outright, exit `3221225477`. One socket per connection is
owned now.

---

## 2026-08-07 — task-2, client enrolment ([#19](../../issues/19))

FR-03.1 to FR-03.5, FR-16.1 and FR-16.3. New capability: nothing in `src/` read or wrote
`~/.claude/settings.json` before this.

| | |
| --- | --- |
| Register | FR-16.3's generator is now decided in code, not only in prose (ASM-27) |
| Spec | `m1-enrolment.md` — §6 keeps FR-18.1's open mechanism, which is task-5's |
| Plan | task-2 `status: done`; scope gained `src/x509.js` |
| Board | regenerated |
| Contract | n/a — S3 decided the boundary and it was built as decided |
| Governance | n/a |
| Issue | [#19](../../issues/19) |
| Test | `test/enrol.test.js`, 21 cases |
| Risks | n/a |

### settings.json is edited as text, not parsed

FR-03.3 requires every unrelated key **and every comment** to survive. `JSON.parse`
followed by `stringify` drops comments silently, which is the worst shape a data-loss bug
takes, and the file holds the user's own `model`, `theme` and the rest. So the document is
scanned and only the spans that must change are rewritten — strings and comments are
skipped as units, because a brace inside either would otherwise close a block that never
opened.

The `env` written to `settings.json` is **derived from the shell lines** rather than
written twice. FR-03 exists because the two locations cover different windows; letting
them disagree about *what* they set would have been a third failure mode. A mutation that
composed the settings env independently is caught by two tests.

### The certificate request was verified against an independent parser

`createCsr` builds PKCS#10 by hand — checking it with the code that wrote it proves
nothing. `openssl` was asked instead:

```
Certificate request self-signature verify OK
subject=CN=device-abc
```

and the request's public key hashes identically to the private key that stayed on disk,
and `openssl x509 -req` signs it into a real certificate. FR-16.3 holds: only the request
can leave.

### Two mutations survived the first pass

Eight mutations were run against the enrolment tests. Six failed as intended; two did not,
and both were genuine gaps rather than false alarms:

| Survived | Why the tests missed it |
| --- | --- |
| `cutMember` leaves the comma behind | Every removal case removed a *trailing* member, which takes the comma before it instead. The middle-member branch had no test |
| `endOfValue` counts braces without skipping strings | The awkward string was at the top level, where the scan returns before it counts a brace. Only a nested object reaches the depth counter |

Both now have a test, and both mutations fail against them.

### The overlap guard was narrowed, deliberately

task-2 needed `src/x509.js` for the certificate request — the ASN.1 primitives live there
and are not exported, so building it elsewhere meant a second copy of them. task-1 owns
that file in the same tier, and the guard refused.

It refused correctly for the wrong situation: the constraint is about two agents editing
one file *at the same time*, and task-1 was finished. The guard now skips tasks marked
done, and its mutation proof was retargeted at task-6 and task-7, which are both still
open — a mutation using finished tasks would have proved nothing.

---

## 2026-08-07 — task-3, where the proxy may connect ([#8](../../issues/8))

FR-07.1 to FR-07.6, NFR-20.1, NFR-20.2, NFR-21.1 to NFR-21.6. The largest M1 task, and the
one with a security consequence.

| | |
| --- | --- |
| Register | ASM-19, ASM-20, ASM-21 resolved by building them · ASM-30 unchanged |
| Risks | RSK-05 treatment is now code rather than a plan |
| Spec | `m1-hardening.md` — §6's open allowlist question is discharged by measurement |
| Plan | task-3 `status: done`; scope gained `src/destination-policy.js` |
| Board | regenerated |
| Contract | n/a — S1 decided the seam and it was built as decided; the three refusal reasons map one-to-one onto the error envelope, and a test asserts there is no fourth |
| Governance | n/a |
| Issue | [#8](../../issues/8) |
| Test | `test/connect-policy.test.js`, 33 cases |
| Docs | `docs/configuration.md` — `proxy.connect` and a **Where the proxy may connect** section |

### FR-07.5 — the allowlist was composed by running a client

Not guessed. Two `claude -p` runs through a report-only proxy — one plain, one using tools
— while a *hosted* policy classified each CONNECT alongside and recorded what it would
have decided:

```
intercept              api.anthropic.com:443
refuse (not_allowed)   mcp-proxy.anthropic.com:443
refuse (not_allowed)   mcp.notion.com:443
```

A third run with the composed list **enforced** completed normally — the client replied
`enforced-ok` — and issued exactly one refusal:

```
[TeamClaude] refused CONNECT mcp.notion.com:443 — mcp.notion.com is not on the allowlist
```

**That refusal is the finding.** `mcp.notion.com` comes from this machine's `.mcp.json`: a
user's own MCP server, which no release can know about. It is the concrete reason FR-07.3
requires the allowlist to be data rather than code, and it is not in the spec's observed
table — which listed telemetry hosts and `downloads.claude.ai`, neither of which appeared
in these windows.

`downloads.claude.ai` ships allowed anyway, and the entry says so: the update check did not
fire in the window, but refusing it breaks self-update, which then collides with the client
version floor ([#16](../../issues/16)) — clients drift below it and are locked out with no
way back.

### Two defaults were wrong, and the existing suite said so

The address policy and the port restriction were written to be closed unconditionally.
Three blind-tunnel tests failed immediately, and they were right to: acceptance criterion
13 is *with `proxy.host` on loopback every current behaviour is unchanged*, and the local
proxy has tunnelled to `127.0.0.1` on arbitrary ports since it existed.

Both now derive from `proxy.host` like the rest of the switches. That is what §4 of the
spec said all along — "bound to loopback, today's behaviour is preserved" — and reading it
as applying only to the switches listed in its own code block was the error.

### A regression the pin tests caught

Resolving once and dialling `net.connect(port, address)` lost something
`net.connect(port, name)` had: the fallback between a v6 and a v4 answer. `localhost`
answers `::1` first here, and a service listening only on `127.0.0.1` became a 502.

Fixed by pinning `lookup` instead of rewriting the target — the verdict carries **every**
approved address, Node's own connection logic does the fallback, and a second resolution is
impossible because the resolver never runs again. It also keeps the name, and with it the
`Host` header and the TLS servername: rewriting the URL to an address would have reached a
virtual host as an IP it has never heard of. Both egress paths share the one helper.

### NFR-06 — what the check costs

| | |
| --- | --- |
| Warm lookup | **0.212 ms** (200 calls, `api.anthropic.com`) |
| Cold / NXDOMAIN | **6.7 ms** (20 distinct names) |

One resolution per CONNECT, which is one per tunnel — the minimum S1 asked for. No cache
beyond that: S1 left it to task-3 "with measurements in hand", and 0.212 ms against a TLS
handshake does not buy an invalidation policy.

### The mutations

Nine were run against the policy. Eight failed as intended. The survivor — feeding an
unresolved *name* to the address check — still refused the destination, but as
`address_blocked` rather than `not_allowed`, so the client would be told its destination
was blocked when DNS is what failed. The reason reaches a client, so the test now asserts
it.

---

## 2026-08-07 — task-4, legible failure ([#20](../../issues/20))

FR-17.1, FR-17.2, FR-17.3, NFR-13.2.

| | |
| --- | --- |
| Register | ASM-29 already measured; this is what was built on it |
| Contract | `m1-error-envelope.md` — emitted as written, plus two classes it did not name |
| Spec | `m1-failure-modes.md` — marked built |
| Plan | task-4 `status: done`; scope gained `src/request-id.js` and `src/index.js` |
| Board | regenerated |
| Governance | n/a |
| Issue | [#20](../../issues/20) |
| Test | `test/failure-modes.test.js`, 9 cases; `test/enrol.test.js` gained the CLI surface |
| Docs | `docs/usage.md` — **When the proxy is not reachable** and **What a proxy error is telling you** |
| Risks | n/a |

### An acceptance criterion that could not be met as written

Criterion 5 is *existing 403, 429 and pin tests still pass unchanged*. Two of them assert
`/proxy_error/` — the exact string FR-17.1 exists to remove. The two cannot both hold.

Read as intended, the criterion protects the **behaviour** those tests cover: the status,
the account being named, no extra retries. All of that is unchanged. Two assertions were
repointed at the class that replaced the generic one, and nothing else in either file moved.

### Two classes the contract did not name

The contract enumerated six. Reading every site turned up two more the same argument
applies to:

| | |
| --- | --- |
| `upstream_error` | an upstream failure passed along. Distinct from *unreachable* — something answered |
| `egress_not_pinned` | the egress address is not the pinned one. Already had a good message; it was wearing `proxy_error` |

`proxy_error` no longer appears in `src/server.js` at all.

### The documentation named a command that did not exist

NFR-13.2 wants `unenrol` documented as the recovery step. task-2 built the module and
nothing invoked it — writing the sentence is what surfaced that. `teamclaude enrol
--proxy <url>` and `teamclaude unenrol` are dispatched now, and in `--help`.

Wiring them turned up one more: the dispatch ends `process.exit(0)`, which overwrote the
`process.exitCode = 1` a usage error had just set. A script would have been told the
enrolment succeeded when it never ran.

### The mutations

| Reverted to | Caught by |
| --- | --- |
| The id reaches the user but never the log | *the id in the response is the id in the log* |
| Every class treated as actionable, so none carries an id | the same |
| Upstream-unreachable back to the generic class | *every failure class has its own type* |
| The id as a field instead of appended to the message | *the envelope shape clients parse is unchanged* |

---

## 2026-08-07 — task-5, a requirement that could not be built ([#19](../../issues/19))

FR-18.1. The finding is the requirement itself.

| | |
| --- | --- |
| Register | **FR-18 reworded** — it required the *proxy* to detect this, and the proxy cannot |
| Spec | `m1-enrolment.md` §3.3 rewritten, with the two runs that settle it |
| Plan | task-5 rewritten: description, scope and all five criteria; `status: done` |
| Board | regenerated from the plan |
| Contract | n/a — nothing crosses the wire |
| Governance | n/a |
| Issue | [#19](../../issues/19) |
| Test | `test/partial-config.test.js`, 9 cases |
| Docs | `teamclaude enrol --check` in `--help` |
| Risks | n/a — ASM-13's risk is unchanged; what changed is where it is caught |

### The signal FR-18.1 was built on does not exist

The requirement rested on F05: a pre-settings request (`/api/eval/*`) that arrives only
when the shell export is present, making a session whose first contact came later
identifiable as `settings.json`-only.

Two controlled runs on client 2.1.224, with `eventLogging: 'show'` so the activity filter
hid nothing:

| Run | First requests |
| --- | --- |
| Shell export only | `GET /mcp-registry/v0/servers…` · `POST /v1/messages?beta=true` · … |
| Project-scope `settings.json` only | `GET /mcp-registry/v0/servers…` · `POST /v1/messages?beta=true` · … |

Identical, and **neither contained a single `/api/eval` or `/api/event_logging` request.**

The first attempt at this measurement was wrong and would have reached the same conclusion
for the wrong reason: it read the request path from the activity hooks, which suppress
`/api/event_logging` unless `eventLogging` is `show`. A second attempt recorded at the base
server's socket and saw nothing at all, because a client using `HTTPS_PROXY` arrives by
CONNECT and never touches that listener. Only the third setup was measuring the thing.

### Where the check went instead

`teamclaude enrol --check` reads both locations on the machine. Nothing is inferred, and it
covers the case this spec called harder and most important — settings missing means
background agents never contact the proxy, so no proxy-side signal could ever have existed
for it. The report names the consequence, not just the absence: *background agents read
this file and nothing else — without it their traffic reaches the API directly, and nothing
surfaces an error.*

### Reading a settings file the writer refuses to parse

`mergeSettingsEnv` never parses, so comments survive a write. The check has to *read* the
env block, so it strips comments first — skipping strings as units, because a `//` inside a
proxy URL is not a comment. A mutation that removed the string handling failed four tests.

---

## 2026-08-07 — task-6, the M1 boundary attacked

Not described. Twelve cases written from the attacker's side, each an attempt to reach
somewhere the proxy should not go, holding a valid proxy key — which in a hosted
deployment every tenant does.

| | |
| --- | --- |
| Register | n/a — both findings are the implementation not meeting NFR-20, not the requirement being wrong |
| Plan | task-6 `status: done`, with both findings, their severity and their reproduction |
| Board | regenerated |
| Test | `test/m1-boundary-review.test.js`, 12 cases |
| Issue | [#8](../../issues/8), [#20](../../issues/20) |
| Others | n/a |

**Where a refusal status is not enough**, the case counts connections to a listener that
must never be dialled — "refused" and "dialled, then refused" look identical from the
client, and the second is the vulnerability.

### F-1 — high — the upgrade listener authorised nobody

There are **three** egress paths, not two. The request path checks `x-api-key`, the CONNECT
path checks `Proxy-Authorization`, and `server.on('upgrade', …)` checked neither.

Reproduced with a bare WebSocket handshake carrying no key against a hosted listener; the
proxy dialled upstream on the client's behalf:

```
[TeamClaude] Remote Control WebSocket relay error: getaddrinfo ENOTFOUND api.anthropic.comhttp
```

No account token is injected there, so this is not credential theft — it is NFR-20's
fail-closed requirement covering two paths out of three. Fixed with a single
`clientAuthorized()` both paths now consult, and the mutation that removes it fails the
test.

### F-2 — low — the relay concatenated the client's request line

`relayUpgrade` built `${upstream}${req.url}`. An absolute-form request line produced the
hostname `api.anthropic.comhttp`, which failed to resolve rather than reaching anywhere —
luck, not a check. The relay only ever addresses the configured upstream, so a target that
is not a path is a `400` now.

### What was attacked and held

By literal address in both v4 and IPv4-mapped v6 form; by an allowlisted name resolving
inside; by a split answer in both orderings; by a name that answers differently on the
second lookup; by a redirect toward a private address; and by omission — every switch
verified closed when the listener is not loopback, and open exactly as before when it is.

A refusal was also checked for what it gives away: it names the range and the destination
the client already knew, and **not** the address the name resolved to. Handing that back
would turn a refusal into a scan of the operator's network.

### One guard was quietly asleep

The mutation proving *two tasks in one tier owning the same file is caught* borrowed
task-6 and task-7 because they were open. Finishing task-6 stopped it mutating anything.
It now sets the pair open itself, so completing the plan cannot switch it off.

---

## 2026-08-07 — task-7, making the documentation true again

| | |
| --- | --- |
| Docs | `proxy-modes.md` corrected — the one sentence M1 falsified |
| Test | `test/docs-references.test.js`, 6 checks |
| Plan | task-7 `status: done`. **M1 is 8/8** |
| Board | regenerated |
| Others | n/a — nothing behavioural changed |

### One sentence was false, and the check written to find it did not

> Any host other than the upstream is blind-tunnelled.

True until task-3. Off-loopback such a host is refused unless allowlisted, and refused
regardless if it resolves to a private address or asks for a port other than 443.

The check for exactly this claim **passed over it**. The pattern was written from the
requirement's wording (*anything else*) rather than from the document's (*any host other
than the upstream*), so it matched nothing and reported nothing. It was only found by
reading the file the criterion named. Tightened, and shown to fail against the original
sentence.

### The checker was wrong before the documentation was

The first version built its word matcher as ``new RegExp(`${leaf}`)``. Inside a
**template literal** `` is a backspace character, not a word boundary — so it reported
all 18 documented `proxy.*` keys as unread while every one of them existed.

A checker that fails loudly is recoverable. This one failed *convincingly*: eighteen
plausible findings, in the right format, about real keys. It now has a test asserting that
its matcher matches `port` and not `support`, which is a small thing to assert and the only
thing standing between a checker and a generator of confident nonsense.

### What is checked from now on

Relative links resolve · every `src/` file named exists · every `proxy.*` key is read by
the code · every `teamclaude <cmd>` is dispatched · no document still describes what M1
replaced. `docs/plans/` and `docs/specs/` are exempt from the last one on purpose: the
trace and the specs keep a record of what changed, and that is the point of them.

---

## 2026-08-07 — two criteria that were never tested

Asked whether the testing was finished as defined, and checked instead of answering. Every
requirement id named in the plan's acceptance criteria, mapped against every id named
anywhere in `test/`:

| | |
| --- | --- |
| Ids in acceptance criteria | 35 |
| Of those, named nowhere in `test/` | **2** — NFR-06 and NFR-07, both task-3 |

| | |
| --- | --- |
| Plan | task-3 scope gained `test/streaming-through-policy.test.js` |
| Board | regenerated |
| Test | 4 cases |
| Others | n/a — the code was already correct; the verification was missing |

### NFR-07 was the one that mattered

*An SSE response survives the new path.* Every Claude Code response arrives as
`text/event-stream`, and task-3 put a policy decision in front of the CONNECT that carries
them. The MITM integration suite covers that path thoroughly — and sends only whole
bodies. A change that broke streaming would have gone green.

It does survive: three events with real gaps between them arrive in pieces, and a stream
idle for six seconds is not cut. The assertion has teeth — collapsing the upstream's
interval to zero fails it with *every chunk arrived at once, so the stream was collected
before it was relayed*.

### NFR-06 held by construction, which is the weakest kind of true

*Resolution does not add a lookup per request.* The check runs at CONNECT and requests
inside a tunnel never reach it, so it was true because of where the call sits rather than
because anything held it there. Now: three requests through one intercepted tunnel cost
zero lookups, and one tunnelled CONNECT carrying two payloads costs exactly one.

### The audit itself

Both were found by mapping ids, not by reading. The same pass over `docs/specs/` §5 test
tables — 34 rows across four specs — found none uncovered. That is a coverage floor and
not a proof: an id being *named* in the suite is not the same as the behaviour being
tested, which is what the mutation runs are for.

---

## 2026-08-07 — ASM-30, the last thing left open

Carried as ❌ *unverified* since the sweep. It reproduces.

| | |
| --- | --- |
| Register | ASM-30 closed, with what is fixed and what is not |
| Plan | task-5 scope gained `src/mitm.js` and the new test; a criterion added |
| Board | regenerated |
| Test | `test/cert-concurrency.test.js`, 9 cases |
| Others | n/a — no requirement changed, an assumption was settled |

### What it looked like

Three processes regenerating concurrently, with a fourth reading the pair the way every
intercepted CONNECT does:

| | |
| --- | --- |
| Mismatched pairs — a CA from one run beside a leaf from another | **820 in 17,249 reads (4.75%)** |
| Half-written PEM (`ERR_OSSL_PEM_NO_START_LINE`) | 65 more |
| Writers failing outright | **4–10 `EPERM` per process** — on Windows a rename over a file another process holds is refused |

### The fix, and what it does not fix

An exclusive `wx` create around regeneration; a rename that retries on `EPERM`; and a torn
pair re-read once before it is believed. Under contention `ensureCerts` now returns no
incoherent chain and throws nothing, held end to end by two processes churning while a
third checks.

**Two processes configured with different upstreams sharing one directory still churn** —
3,367 torn reads in 18,130. They are asking for incompatible chains and will replace each
other's work forever; no lock fixes a disagreement about what the answer should be. That is
a misconfiguration, and it is written down rather than asserted away.

### Three probes were wrong before one was right

Worth recording, because each was convincing:

| Attempt | What it actually measured |
| --- | --- |
| 1 | 64% "unreadable" — the reader counted the moments **before the first mint**, when the directory was simply empty |
| 2 | The writers planted an inconsistent chain by hand each round, so the residual mismatch was **the probe's own writes**, not `ensureCerts` |
| 3 | Same-host writers after seeding — nobody regenerated at all, so it measured **a quiet directory** and would have passed with the lock removed |

The fourth forced contention the way it arises — the chain falls due, every process notices
at once, all wanting the same host — and only that one distinguishes the fix from its
absence.

### One test was deleted rather than kept green

A unit test wrote a torn pair, restored it on a 2ms timer, and asserted no regeneration.
The first read is itself asynchronous, so the timer usually fired before anything looked:
it passed with the code it was testing removed. Deleted, and the comment in its place says
why.

### What is pinned, and what is only measured

| | |
| --- | --- |
| The lock | pinned — removing it fails three tests |
| The rename retry | pinned — removing it fails the contention test |
| The two re-checks | **not pinned.** They avoid *redundant* minting and measurably do — 1.7% of calls against 4.6%, and roughly twice the throughput, because a keypair is expensive — but that is a rate under a noisy concurrent load, and a threshold would be flaky. They are also redundant with each other, so no single-line mutation can show either working. Recorded in the test rather than asserted |

---

## 2026-08-10 — G-1 demonstrated, and what demonstrating it found

M1's declared exit is **G-1** and **G-6**, not "eight tasks done". Standing a hosted proxy
up and enrolling a machine against it is the only thing that checks the first.

**It passes.** A client on this machine, configured only by enrolment, returned `G1-OK`
through a proxy on another host, with **0 teamclaude processes** among the 23 node
processes running here.

Getting there found three defects and one constraint. Every one of them was invisible to a
green suite.

| | |
| --- | --- |
| Register | FR-03.2 now requires the credential to survive enrolment; FR-16.1 now forbids configuring an empty artifact |
| Test | `test/enrol.test.js` — five cases, each pinned by mutation |
| Docs | `teamclaude enrol --ca <file>` in `--help` |
| Others | n/a — no requirement was withdrawn, three were found to be under-specified |

### 1 — an enrolled machine could not reach its own proxy

`enrol()` never carried the proxy key. A hosted proxy requires it for every non-loopback
client, so the machine it had just configured got **407** on everything.

```
CONNECT as enrolled     407
CONNECT with key@host   200
```

Nothing in FR-03 said the credential had to travel, because nobody had used the result.

### 2 — the client was pointed at empty files

`tenant-ca.pem` and `device.crt` were written as **0 bytes** and named in
`NODE_EXTRA_CA_CERTS` and `CLAUDE_CODE_CLIENT_CERT`. It degrades safely — ASM-28 measured
the client warning and carrying on — but it is a setting naming a file with nothing in it.
Only an artifact with content is configured now, which split `MANAGED_KEYS` into
`ROUTING_KEYS` (always) and `ARTIFACT_KEYS` (when they exist).

### 3 — the client silently ignores a one-sided userinfo

The worst of the three, because it fails without saying anything:

| Proxy URL | Result |
| --- | --- |
| `https://<key>@host:8443` | **no request at all** — no error, nothing reached the proxy, the run timed out |
| `https://<key>:@host:8443` | the same |
| `https://<key>:<key>@host:8443` | the run completed |

The documented remote form is `--proxy http://<key>@host:port`, with the key as the
username — which `curl` sends and the proxy accepts. Claude Code does not use it. Both
slots are filled now: the username carries the pin when there is one and the key otherwise,
the password always carries the key.

### The constraint: the proxy cannot supply the client's own login

Enrolling a **fresh** home produced `Not logged in · Please run /login`. The client checks
its own credentials before it will talk to anything, and the proxy replacing the token
afterwards does not change that. G-1 still holds — a login is not a process of ours — but
the hosted story is "the proxy pools accounts for a client that is already logged in", not
"the proxy is the login".

### What the operator has to copy

FR-16.2 says self-hosting means the operator copies the artifacts. Nothing exposed a way to
*give* enrolment the CA, so `--ca <file>` exists now. Without it the proxy's own leaf is
untrusted inside the tunnel and a run produces **no output at all** rather than an error —
which is how the first attempt failed.

### A service was stopped that should not have been

A process on the host's port 3456 was judged a leftover from an earlier measurement session
because its start time matched. It was a `systemd --user` unit in daily use. It was down
**twelve minutes**. Restored from a backup taken beforehand, verified `active` and serving a
real request; the accounts were checked afterwards and all three are healthy.

The judgement was made on one weak signal and no check that would have settled it —
`systemctl --user list-units` names it in a line. Nothing about the state of a machine
should be inferred from a timestamp when the machine can be asked.

---

## 2026-08-10 — the CA stops changing under the devices that trust it

A device is handed a CA at enrolment and holds it. Renewing the leaf minted a
**new CA** every time, because the CA key was discarded and there was nothing to
re-sign with. With the shipped 90/30 policy that is roughly every 60 days, and
every enrolled machine stops verifying on the day it happens.

Compressed onto a one-minute CA so it could be watched:

```
device enrolled with CA 56AB6F76
 +25s  proxy serves CA 9EC7E162   device can verify: NO
 +50s                  3528CE4D   NO
 +75s                  D3A340F2   NO      … six rotations, six failures
```

| | |
| --- | --- |
| Register | ASM-16 becomes true — "a leaf swap costs the client nothing" was not, because a leaf swap swapped the CA |
| Spec | `m1-certificates.md` — §2.2 anticipated exactly this and nobody closed it |
| Test | `test/cert-lifetime.test.js`, `test/cert-concurrency.test.js` |
| Others | pending — the distribution half is not in this change |

### What it does now

| Situation | Action | Cost to a device |
| --- | --- | --- |
| CA fine, leaf due | re-sign a leaf under the same CA | none |
| CA near its end | issue a successor **cross-signed by the CA being replaced**, serve both | none |
| nothing usable | mint from scratch | re-enrolment |

Same accelerated clock, after:

```
t+ 13s … t+ 78s   same CA,      chain:1   device connects
t+ 92s … t+118s   successor,    chain:2   device connects
t+118s onward     CERT_HAS_EXPIRED
```

The last line is not a defect. The device's **own anchor** was a 120-second
certificate; cross-signing carries a device across rotations, not past the
expiry of the thing it trusts. That boundary is real and is the one reason a
re-enrolment is ever needed.

### Four defects found by running it rather than reasoning about it

| | |
| --- | --- |
| Every CA used the same CN | The cross-signed certificate had identical subject and issuer, indistinguishable from a self-signed root. Path building treated it as its own anchor and refused — eight rotations, eight refusals, with a valid cross-signature sitting in the chain |
| `positiveDays` floored its input | `1/2880` became **0**, so the leaf was born expired and every handshake failed `CERT_HAS_EXPIRED` while the crypto underneath was correct |
| The cross-signature was dropped on the next leaf renewal | Chain went back to one certificate and devices lost the bridge mid-flight: connects, connects, connects, `UNABLE_TO_VERIFY` |
| `loadCA` did not check the key against the certificate | The two files are written separately, so one can be left over. Signing with a mismatched key yields a leaf claiming an issuer that cannot have issued it — valid bytes, unusable chain. Found by a concurrency test that plants exactly that state |

None of these is visible from the code. Each needed a rotation to actually
happen, which is what the accelerated clock is for.

### A test that destabilised its neighbours

The contention test spawns processes that mint RSA keypairs, and under the full
suite that was enough to make a timing-sensitive relay test fail — in CI once,
and locally. It passes 3/3 alone. The work is halved; the relay test is quiet
again. A test that is correct and still breaks the run is not finished.

### Not in this change

`/teamclaude/ca` and enrolment fetching it. The CA is stable now, so a device
needs it **once** rather than every two months — which is what made the manual
copy the blocker. Automating that copy is the next piece, not this one.

---

## Open at the end of this sweep

| | |
| --- | --- |
| `deferred` × 4 | Not verifiable here. Each records why |
| macOS, interactive mode | No machine, no TTY |
| ASM-20, ASM-21, ASM-22, ASM-34 | Decided during implementation; each names its task |

**Exhaustion is not claimed.** §9's appendix records what the sweep can and cannot
establish. Six of these were found by measuring rather than reading, and a text sweep
cannot find an assumption nobody wrote a sentence about.

---

## Reverse index — what shaped each artifact

Forward tracing answers "did this finding reach everywhere it should". It cannot answer
"why does this file say what it says", which is the question someone asks when they open it
cold. ISO 21500 wants both directions.

| Artifact | Shaped by |
| --- | --- |
| `docs/saas-requirements.md` §4.1 FR | FR-16.3 ← ASM-27 · FR-18 ← ASM-13, F16 |
| §4.2 NFR | NFR-17.5 ← ASM-15 · NFR-21.5 ← ASM-20 · NFR-21.6 ← ASM-19 · NFR-20/21 ← the SSRF read of `mitm.js` · NFR-22 ← ASM-10 · NFR-23 ← G-1 audit · NFR-24 ← ASM-36 · NFR-25 ← no threat model · NFR-26/27 ← ISO 29119 audit |
| §4.3 ASM | 43 entries; 14 measured here, 8 read from source, 4 deferred to vendor documentation |
| §4.4 CON | CON-09 narrowed ← `mitm.js:204` logs the destination · CON-01/04 reclassified deferred ← ASM-35, ASM-36 |
| §7 Data protection | Two rows marked *not today* ← ASM-37 (buffers held across retries), ASM-38 (crash stacks) |
| §9 Asset inventory | Exists at all ← ISO 27001 F-1 and ISO 42010 H-1 reaching the same gap · crash log row ← ASM-24 · quota state reclassified ← ASM-26 · retention marked a target ← ASM-25 |
| §10 Risk register | Exists at all ← ISO 31000 B-1/B-2/B-3 · RSK-03 widened ← ASM-40 · RSK-03 residual ← ASM-15 · RSK-04 treated ← [#30](../../issues/30) |
| §6 M1 exit criteria | G-1 reworded ← ASM-33 · G-3 reworded ← ASM-31 |
| `specs/m1-certificates.md` | NFR-17.5 ← ASM-15 · lifetime derived not chosen ← ASM-16, ASM-17 |
| `specs/m1-enrolment.md` | FR-03.3 comments ← ASM-18 · FR-16.3 ← ASM-27 · both-locations rule ← F14–F17 |
| `specs/m1-hardening.md` | FR-07.4 split ← ASM-23, ASM-43 · NFR-21.5 ← ASM-20 · NFR-21.6 ← ASM-19 · exact hostnames ← ASM-21 |
| `specs/m1-failure-modes.md` | FR-17.1 message-carries-everything ← ASM-29 · NFR-13.2 partial unenrol ← ASM-28 |
| `contracts/m1-error-envelope.md` | 400 on the request path ← ASM-23, ASM-43 · type is operator-facing ← ASM-29 |
| `contracts/m1-internal-seams.md` | S1 connect-by-address ← `mitm.js:197` · S2 log-only id on CONNECT ← the envelope split · S3 boundary ← `claude-env.js:14`, `alias.js:79` |
| `plans/m1-plan.json` governance | NFR-17.5 approval ← ASM-15 · lifetimes removed ← ASM-16 · M4 inputs ← ASM-40, [#30](../../issues/30) |
| `test/requirements-coverage.test.js` | Each of the nine checks exists because that failure happened once — the comments name which |
| `src/x509.js` | `DEFAULT_LEAF_DAYS` 825 → 90 ← NFR-17.4 · lifetimes became parameters ← NFR-17.4 · `DEFAULT_CA_DAYS` left alone ← [#5](../../issues/5) owns it |
| `src/mitm.js` | `certReuseProblem` replaced `leafCovers` ← NFR-17.1, NFR-17.2, NFR-17.3 · `serverPromises` keyed by leaf ← NFR-17.5 · dropped not closed ← ASM-17 · the clamp said once ← the memo removal made it chatty |
| `src/server.js` | `certsPromise` → in-flight only ← NFR-17.5 · revalidating unconditionally ← 0.386 ms, measured |
| `docs/configuration.md` | `proxy.certs` ← NFR-17.4 · the reason table ← NFR-17.3 · no CA lifetime ← [#5](../../issues/5) |
| `test/cert-lifetime.test.js` | Every case names its requirement; the four the mutations proved are listed above |
| `src/enrol.js` | Exists at all ← FR-03 · text editing rather than parsing ← FR-03.3 and ASM-18 · module boundary ← S3 · settings env derived from the shell lines ← FR-03 wanting the two locations to agree |
| `src/claude-env.js` | `host`/`scheme` ← FR-03.2 against a hosted proxy · `certPath`/`keyPath` ← FR-16.1, unused until [#6](../../issues/6) · still pure ← S3 |
| `src/x509.js` (again) | `createCsr` ← FR-16.3 · verified with openssl ← hand-built DER checked by its own writer proves nothing |
| `src/mitm.js` certificate locking | Exists at all ← ASM-30, measured at 4.75% torn reads · the rename retry ← 4–10 EPERM per process on Windows · the re-read ← a 3-file update is not atomic to a reader · the different-upstream case left open ← it is a disagreement, not a race |
| `src/enrol.js` `checkEnrolment` | Exists at all ← FR-18.1 · on the machine rather than at the proxy ← two runs producing identical traffic · stripping comments to read ← the writer deliberately never parses |
| `src/request-id.js` | Exists at all ← S2 and FR-17.3 · 8 hex rather than a UUID ← it is read aloud and typed back · separate from `reqId` ← that one is a display concern |
| `src/server.js` `FAILURE_CLASSES` | Exists at all ← FR-17.1 · `actionable` splitting the table ← FR-17.2 against FR-17.3 · the message carrying everything ← ASM-29, measured · `upstream_error` and `egress_not_pinned` ← reading every site, not the contract |
| `src/index.js` enrol/unenrol | Exist at all ← NFR-13.2 needing a command to document · the exit code ← `process.exit(0)` swallowing a usage failure |
| `src/destination-policy.js` | Exists at all ← S1 · the verdict carrying the address ← NFR-21.2 · the enumerated range list ← NFR-21.6 and ASM-19 · every default derived from `proxy.host` ← criterion 13 and three failing blind-tunnel tests · `SHIPPED_ALLOW` ← FR-07.5, measured · `pinnedLookup` ← a v6/v4 fallback regression |
| `test/requirements-coverage.test.js` (again) | *a task owns the files its criteria name* ← task-1's scope defect · the overlap guard skipping done tasks ← task-2 needing a file task-1 had finished with |

**Reading it.** A left-hand entry with no right-hand source is a line nobody can explain,
which is how the first register was built and why the audit found eleven gaps in it.

---

## The guards are shown to fail

A guard that has never failed might be asserting nothing, and one of them was: *a measured
finding that changed a contract is traced* matched **zero rows** for its whole life. The
verdict text is "measured false on the request path" and the pattern wanted "measured
false" straight after a pipe, so it compared an empty list to an empty list and passed
every run.

`test/coverage-guards-catch.test.js` copies the artifacts, writes a real omission into the
copy, asserts the coverage suite goes red against it, and throws the copy away — thirteen
of them, one per guard. It also refuses to pass when its own anchor text has moved, because a
mutation that changes nothing would otherwise look like a successful test.

The copy is not tidiness. The first version mutated the working tree, and Node runs test
files in parallel: the coverage suite read a half-mutated document and failed for reasons
that had nothing to do with it. A test that edits the repository under a parallel runner is
a defect whether or not it reverts.

That does not make the set of guards complete. It makes each of them **demonstrated**
rather than assumed, which is the same distinction this document applies to everything
else.

---

## The gate before master

Everything above is detection after the fact. Each omission entered `master` and was found
by reading; the guards were written afterwards, one shape at a time. Three things were
missing between a change and the branch:

| | Was | Now |
| --- | --- | --- |
| Direct push to `master` | Allowed — CI could be skipped entirely | Refused by the remote, measured below |
| A governing artifact changing untraced | Nothing asked | `scripts/check-change-trace.mjs` fails the PR |
| Which omissions are caught | Only shapes already seen | Still only those — see below |

**What protection enforces**, read back from the API rather than from the request that set
it: required checks `test`, `change trace`, `nix package`; force-push and deletion off;
`enforce_admins` **on**. That last one is the difference between a gate and a suggestion —
with it off the sole repository admin is also the only person who commits here, so every
push would have bypassed the checks and the row above would have been false.

It was tested by pushing this commit straight at `master` and reading the refusal:

```
remote: error: GH006: Protected branch update failed for refs/heads/master.
 ! [remote rejected] HEAD -> master (protected branch hook declined)
```

The same commit then went through a pull request. A protection setting that has never
refused anything is a claim about a configuration page, not about the branch.

The trace gate is the only one that guards a **class** rather than an instance. It does not
know what a change should have touched; it requires that somebody said. That is weaker than
knowing, and it is the difference between an omission that is invisible and one that is
recorded as deliberate — `n/a` is an answer, silence is not.

**What still is not prevented.** An omission of a kind nobody has met yet passes every
check here. The guards enumerate known shapes, and the trace gate only forces a sentence to
be written, not a correct one. This is a floor, not a proof.
