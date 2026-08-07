# Standards audit of the requirements artifacts

An audit of what has been produced so far — [`saas-requirements.md`](saas-requirements.md),
the four specs under [`specs/`](specs/), and the M1 plan — against the standards this
project's own tooling references.

**This does not claim conformance to anything.** No certification, no assessment. It is a
gap list, produced by reading the artifacts and searching them, with each finding traceable
to what was or was not found.

## Method

Each standard was reduced to the concerns it actually asks about, and the artifacts were
searched for those concerns. Findings are separated into two kinds, because they need
different work:

| | |
| --- | --- |
| **Absent** | Nothing in the artifacts addresses the concern |
| **Unclassified** | The substance exists but is not organised so anyone can see the coverage — which is how gaps hide |

The distinction matters. "No entry mentions reliability" is not the same as "reliability is
unaddressed": NFR-12, NFR-13 and NFR-14 are reliability requirements that simply do not say
so.

---

## 1. ISO 21500 — project management

| Concern | State |
| --- | --- |
| Scope and exclusions | ✅ §0 non-goals, §1 scope |
| Deliverables | ✅ Milestones with exit criteria |
| Dependency mapping | ✅ Plan dependencies, validated for tier monotonicity and scope collision |
| Sequencing | ✅ M0–M4; no dates, deliberately (§0) |
| Stakeholders | ⚠️ Three named — operator, maintainer, future tenants — with no concerns recorded against them |
| Roles and responsibilities | ❌ **Absent.** Tasks carry an `agent`, which is an execution lane, not accountability |
| Communication | ❌ **Absent.** Nothing says who must be informed of what |

**A-1** — Record what each stakeholder cares about, not just that they exist. The operator
and a future tenant want opposite things from CON-08 (one pays the cost, the other receives
the service), and nothing captures that.

---

## 2. ISO 31000 — risk

The plan carries five risks with five treatments. Structurally they are flat strings:

```
top_risks: 5 | treatments: 5
fields present: top_risks, treatments
per-risk structure: no — no likelihood, impact, owner or residual
```

| Concern | State |
| --- | --- |
| Identification | ✅ Five, and they are real ones |
| Treatment | ✅ Each has one |
| Likelihood | ❌ **Absent** |
| Impact rating | ❌ **Absent** |
| Prioritisation | ❌ **Absent** — the list has no order |
| Risk owner | ❌ **Absent** |
| Residual risk | ❌ **Absent** — no treatment says what is left over |
| Review cadence | ❌ **Absent** |

**B-1** — Residual risk is the sharpest omission. Three treatments plainly leave something
behind and none of them says so:

- The allowlist is composed from `-p` and `--bg` observations (ASM-08, ASM-14). Running a
  client to validate it does not cover interactive mode, so **residual: a real session may
  still hit a refusal**
- `sx.mode` mitigates IP-keyed limits at metered per-GB cost — **residual: unbounded
  bandwidth spend against donations** (CON-08)
- Refusing by default and deriving switches from `proxy.host` closes the omission path —
  **residual: an operator who deliberately opens it has no guard rail**

**B-2** — Without likelihood and impact the five risks cannot be ordered, so "which risk
gets attention first" is decided by whoever reads the list.

**B-3** — ASM-10 and ASM-11 are the two assumptions recorded as false-or-unverifiable
about things that change *underneath* the project. Neither has a review trigger. A risk
that changes without anyone looking is the one that becomes an incident.

---

## 3. ISO 38500 — governance

| Concern | State |
| --- | --- |
| Decision owner | ✅ Named |
| Approvals | ✅ Three explicit |
| Accountability | ⚠️ Owner named once, globally; not per decision |
| Oversight | ❌ **Absent.** No checkpoint says when governance looks at this |
| Conformance | ❌ **Absent.** Nothing checks that what gets built matches what was approved |

**C-1** — The M4 gate is the one place a genuine go/no-go exists (CON-08: whether the
community-hosted mode is offered at all). It is written as a note, not as a decision with
an owner, inputs and possible outcomes. It is the most consequential decision in the
document and the least formalised.

---

## 4. ISO/IEC 25010 — product quality

Eight characteristics. The register was written from measurement, so coverage tracks what
was measurable:

| Characteristic | State | Where |
| --- | --- | --- |
| Security | ✅ Strong | NFR-01, 03, 04, 11, 17, 19, 20, 21 |
| Reliability | ⚠️ Unclassified | NFR-12 availability, NFR-13 degradation, NFR-14 backup |
| Performance efficiency | ⚠️ Unclassified | NFR-06 latency, NFR-07 SSE timeouts |
| Functional suitability | ⚠️ Unclassified | The FR register is exactly this |
| Usability | ⚠️ Unclassified | FR-17 legible failure is a usability requirement in all but name |
| Compatibility | ⚠️ Unclassified | CON-01 corporate proxy, CON-04 cloud sessions, FR-10 version floor |
| Portability | ⚠️ Unclassified | ASM-07 macOS, §8.5 platform coverage |
| **Maintainability** | ❌ **Absent** | Nothing |

**D-1** — Maintainability has no entry at all, and this project has a specific reason to
care: **ASM-10 records that client behaviour changes between releases**, and F03 and F06
both caught it moving. A codebase that must track a moving external contract needs
modifiability and testability stated as requirements, not left implicit.

**D-2** — Seven of eight characteristics have substance but no label. That is why
maintainability's absence was invisible: with nothing classified, nothing looks missing.

---

## 5. ISO/IEC 29119 — testing

| Concern | State |
| --- | --- |
| Test strategy | ✅ Plan `testing_strategy`, per-task `test_approach` |
| Traceability requirement → test | ✅ **Strong.** Every spec §5 maps one-to-one, and coverage was checked mechanically |
| Test levels | ✅ Unit and integration named per task |
| Environment needs | ✅ The resolver seam is called out as a prerequisite |
| Completion criteria | ⚠️ An 80% coverage gate exists in the agent protocol, not in the project's own artifacts |
| Test design techniques | ❌ **Absent** |
| Defect management | ❌ **Absent** |

**E-1** — Test design technique matters here specifically. NFR-21.1 classifies addresses
into allowed and refused ranges; that is a boundary problem, and boundary values
(`127.0.0.0/8` edges, `169.254.169.254`, `172.16`–`172.31` limits) are where the bugs
live. The specs say what must be refused, not that the boundaries must be exercised.

**E-2** — No defect handling. When task-6's security review finds something, nothing says
where it goes, who rates it, or what blocks a milestone. The plan says findings become
failing tests, which is good practice, but severity and gating are undefined.

---

## 6. ISO/IEC 27001 / 27002 — information security

The service holds other people's OAuth refresh tokens and terminates their TLS. That places
it squarely in scope for these concerns.

| Control area | State |
| --- | --- |
| Access control | ✅ NFR-20, FR-13 |
| Cryptography | ✅ NFR-03 KMS, NFR-04 envelope encryption, NFR-17 rotation |
| Logging and monitoring | ⚠️ NFR-11 audits credential access; nothing else is monitored |
| Incident management | ✅ NFR-15, issue #25 |
| Continuity | ✅ NFR-14 |
| Data classification and retention | ⚠️ §7 states retention intent; no classification scheme |
| **Asset / data inventory** | ❌ **Absent** |
| **Supplier / third party** | ❌ **Absent** |
| **Secure development** | ❌ **Absent** |

**F-1** — There is no inventory of what is held where. Issue #22 comes closest, listing
what must survive a restore, but that is a backup scope, not an asset register. Nothing
states: refresh tokens live *here*, CA keys *there*, prompt plaintext transits *this*
process and is discarded *then*. Every other control depends on knowing that.

**F-2** — Third parties are unaddressed even though the design names two: the cloud host
that terminates TLS, and sx.org, which relays upstream traffic when `sx.mode` is on.
Traffic routed through a residential proxy provider is a data-processing relationship, and
nothing acknowledges it.

**F-3** — No threat model. SSRF was found by reading `mitm.js` closely, which worked, but
it was luck of attention rather than a method. The design has more attack surface —
CONNECT auth, certificate issuance, config parsing — that has not had the same reading.

---

## 7. ISO 22301 — continuity

| Concern | State |
| --- | --- |
| Backup scope | ✅ #22, and it correctly distinguishes what is recoverable from what is not |
| Restore rehearsal | ✅ Required |
| **RTO / RPO** | ❌ **Absent** |
| **Business impact analysis** | ❌ **Absent** |

**G-1** — NFR-14 says to back up and rehearse, but not how much data may be lost or how
long recovery may take. Those two numbers determine backup frequency and mechanism, so
NFR-14 cannot actually be implemented as written. For refresh tokens the tolerable loss is
plausibly zero — losing them means every user re-enrols every account by hand — and that
is a design input, not a detail.

---

## 8. ISO/IEC 42010 — architecture description

| Concern | State |
| --- | --- |
| Decisions with rationale | ✅ Five in the plan, plus rationale throughout the specs |
| Alternatives considered | ✅ Recorded per decision |
| Stakeholder concerns | ⚠️ Stakeholders listed, concerns not mapped |
| **Multiple viewpoints** | ❌ One diagram, showing the request path only |

**H-1** — The architecture is described entirely from the request-flow view. There is no
deployment view (what runs where, trust boundaries), and no information view (what data
lives where) — the second of which is the same gap as F-1 from the security side. Two
standards asking for the same missing artifact is a signal.

---

## 9. ISO/IEC 42001 — AI management

Marginal. The service is a proxy for AI traffic, not an AI system making decisions; most
of the standard addresses the latter. The one clause that does bite is data handling for AI
workloads, already recorded as CON-02: prompts and source code exist in plaintext in server
memory.

No finding beyond what CON-02 and §7 already carry. Noted so the omission is deliberate
rather than overlooked.

---

## Findings summary

| | Finding | Standard | Kind | Closed by |
| --- | --- | --- | --- | --- |
| **A-1** ✅ | Stakeholder concerns not recorded | 21500 | Unclassified | §0 stakeholder concerns |
| **B-1** ✅ | Residual risk never stated | 31000 | **Absent** | §10 residual column |
| **B-2** ✅ | No likelihood or impact, so risks cannot be ordered | 31000 | **Absent** | §10 L/I rating |
| **B-3** ✅ | No review trigger for assumptions that change externally | 31000 | **Absent** | §10 review triggers |
| **C-1** ✅ | The M4 go/no-go is a note, not a decision with an owner | 38500 | **Absent** | §6 M4 decision |
| **D-1** ✅ | Maintainability has no requirement | 25010 | **Absent** | NFR-22 |
| **D-2** ✅ | Seven of eight quality characteristics unlabelled | 25010 | Unclassified | §4.2 grouping |
| **E-1** ✅ | Boundary-value coverage not required where it matters most | 29119 | **Absent** | NFR-26 |
| **E-2** ✅ | No defect severity or milestone gating | 29119 | **Absent** | NFR-27 |
| **F-1** ✅ | No asset / data inventory | 27001 | **Absent** | §9 inventory |
| **F-2** ✅ | Third parties unaddressed — the cloud host and sx.org | 27001 | **Absent** | NFR-24 + §9 |
| **F-3** ✅ | No threat model; SSRF was found by attention, not method | 27001 | **Absent** | NFR-25 |
| **G-1** ✅ | No RTO / RPO, so NFR-14 is not implementable as written | 22301 | **Absent** | NFR-23 |
| **H-1** ✅ | Single architecture viewpoint; no deployment or information view | 42010 | **Absent** | §3 trust boundaries + §9 |

**11 absent, 3 unclassified — all 14 closed** in the same commit that added this audit's
follow-up. The register grew from 18 FR / 21 NFR / 14 ASM / 10 CON to add **NFR-22 … NFR-27**,
an **asset and data inventory** (§9), and a **risk register** (§10) carrying likelihood,
impact, owner, residual and review trigger for eight risks.

Closing them is not the same as discharging them. **RSK-04 remains untreated** — the upstream
response contract can change and degrade rotation silently, and nothing watches for it. It
is now visible and owned, which is the difference between a gap and a known risk.

## What the pattern says

The absences are not random. Everything derived from **measurement** is strong — security
controls, testing traceability, architecture decisions — because that is how these
artifacts were built. Everything that comes from **organisational practice** rather than
from reading code is missing: risk rating, residual risk, asset inventory, third-party
relationships, recovery objectives, defect handling.

This is the same failure that produced NFR-20, NFR-21 and FR-18 during spec writing, at a
larger scale: a register assembled bottom-up covers what its author could see, and the
gaps are invisible precisely because nothing classifies the space.

Two findings — F-1 and H-1 — are the same missing artifact reached from two directions,
which is the clearest evidence the space was never enumerated.
