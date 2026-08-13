# M1 — closure

The gate decision for the first milestone, the baseline it fixes, and what the process got
wrong. ISO 21500 asks for a phase to be closed rather than merely stopped; ISO 38500 asks
for the decision to be recorded with who took it; ISO 31000 asks for the risks to be
re-rated against what is now known rather than what was estimated.

---

## 1. Exit criteria

§6 declares M1's exit as **G-1** and **G-6**, with **G-5** becoming observable.

| | Criterion | Verdict |
| --- | --- | --- |
| **G-1** | A machine is enrolled and `claude` works with **no process of ours** resident | ✅ **met** — a client configured only by enrolment returned `G1-OK` through a proxy on another host, with 0 teamclaude processes among the 23 node processes on the machine |
| **G-6** | When the service is unreachable, the failure is legible and recovery does not need the operator | ✅ **met** — `unenrol` against a proxy that was not there restored direct operation and the next run returned `G6-OK`. In M1 the operator *is* the account owner, so "without the operator" is not a wait on anyone |
| **G-5** | Pooling *N* accounts yields materially more headroom than one | ⬜ **not claimed** — §6 asks only that it become *observable*, and it has: the system runs and can be measured. ASM-09 stays in the backlog ([#3](../../issues/3)) |

**One caveat recorded rather than smoothed over.** G-6's *legible* half is satisfied by the
letter of NFR-13.1 — which explicitly says the proxy cannot shape a message it never
received, and asks instead that enrolment leave something findable. It does: `teamclaude
enrol --check` and a documented `unenrol`. But the measured reality of a proxy that is
simply down is **silence**: exit 124, zero bytes on stdout and stderr. That is a worse
experience than a bad error, and it is a client behaviour we do not control.

## 2. Decision

**Accepted.** Taken by the account owner, who is also the operator and the only stakeholder
at this milestone (§0: self-hosted, *who operates it — the account owner*).

Accepted with the carried-over items in §4 named rather than closed.

## 3. Baseline

This closure fixes the M1 baseline. The requirements **changed during the milestone**, so
what M2 builds on is not what M1 started with:

| Changed | From | To |
| --- | --- | --- |
| **FR-18** | *the proxy must detect a partially configured client* | detection runs on the machine — the proxy provably cannot, measured |
| **FR-16.2** | operator copies the artifacts; distribution is M3 | enrolment fetches the CA; the deferral undercut the purpose |
| **CON-05** | a hypothetical cost of server-side issuance | realised — the CA key is on disk |
| `allowPrivateAddresses`, `restrictPorts` | closed unconditionally | derived from `proxy.host`, or every existing local user breaks |
| **RSK-09** | did not exist | the CA key at rest |
| **NFR-17.6, NFR-17.7** | did not exist | the CA must outlive its leaves, and be succeeded by cross-signature |

Anything reading the register from before this point is reading a different specification.

## 4. Carried over, explicitly

| | Where |
| --- | --- |
| ASM-09 — how a datacenter egress IP is treated | [#3](../../issues/3), backlog by decision |
| macOS and interactive mode unmeasured | no machine, no TTY; every observation is from `-p` runs |
| Four `deferred` assumptions | vendor documentation, not verifiable here; each records why |
| Name constraints on the CA | measured to work, not implemented — RSK-09's residual says so |
| Two processes with **different** upstreams sharing one certificate directory | a misconfiguration, not a race; 3,367 torn reads in 18,130 |
| `an upstream socket that dies mid-relay` is flaky | fails 2 runs in 4 on a clean `master` — pre-existing, not caused by M1, not fixed by it |
| Eight tests fail on Windows | systemd units, shell rc paths, crash-log paths. Identical on a clean `master` worktree; CI on Linux is green |

## 5. Retrospective

### The plan was wrong three times, and each was only found by building

| | |
| --- | --- |
| task-1 | an acceptance criterion named a file the task did not own |
| task-4 | criterion 5 and FR-17.1 could not both hold — one pinned the string the other removed |
| task-5 | the requirement rested on a signal that does not exist |

Two became guards. The third became a reworded requirement. **What they share is that
writing the spec did not check whether what it assumed was true** — and every one was cheap
to check once someone tried.

*For M2: a spec that asserts a signal exists should carry the measurement that saw it.*

### "Done" meant tasks, and tasks were not the milestone

Eight of eight were finished while G-1 had never been attempted. The first attempt found
three defects — enrolment carried no credential, it pointed the client at empty files, and
the client silently ignores a one-sided proxy userinfo. All three were invisible to a green
suite because **nothing had used the result**.

*For M2: the exit criterion is demonstrated before the tasks are called done, not after.*

### Measuring is a skill and I was bad at it

The FR-18.1 measurement took **three attempts**, and the first two would have reached the
same conclusion for the wrong reason. The ASM-30 probe took **four**. Each wrong version
looked convincing: plausible numbers, right format, real-looking failures.

*For M2: a measurement that confirms what was expected deserves the same scrutiny as one
that surprises.*

### The checkers needed checking

A coverage guard matched zero rows for its entire life. A documentation checker reported 18
false problems because `\b` inside a template literal is a backspace. A mutation proof
stopped mutating anything when the tasks it borrowed were completed.

*For M2: every guard is shown to fail against the thing it guards, and that proof does not
depend on data that changes.*

### A service was stopped that should not have been

Twelve minutes, on one weak signal — a start time that matched — with no check made that
would have settled it. `systemctl --user list-units` names it in a line.

*For M2: nothing about a machine's state is inferred from a timestamp when the machine can
be asked.*

### What worked

Mutation testing. Every fix in this milestone was reverted to confirm the suite noticed,
and it caught four tests that asserted nothing. Where a mutation survived, it was recorded
as unpinned rather than dressed up — the two certificate re-checks are redundant with each
other and no single-line mutation shows either working, and the change log says so.
