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

## Open at the end of this sweep

| | |
| --- | --- |
| `deferred` × 4 | Not verifiable here. Each records why |
| macOS, interactive mode | No machine, no TTY |
| ASM-20, ASM-21, ASM-22, ASM-34 | Decided during implementation; each names its task |

**Exhaustion is not claimed.** §9's appendix records what the sweep can and cannot
establish. Six of these were found by measuring rather than reading, and a text sweep
cannot find an assumption nobody wrote a sentence about.
