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
