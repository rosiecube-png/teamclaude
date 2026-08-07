# M1 — Client enrolment

Detailed requirements for [#19](../../../issues/19), decomposing three register entries:

| Register entry | Decomposed here as |
| --- | --- |
| **FR-03** — enrolment writes both config locations | FR-03.1 … FR-03.5 |
| **FR-16** — distribute the enrolment artifacts | FR-16.1, FR-16.2 |
| **FR-18** — detect a partially-configured client | FR-18.1 |

FR-18 was **added to the register while writing this spec**. ASM-13 records that nothing
detects a half-configured machine, but no requirement said anything should.

Every statement about current behaviour was read out of the source and cites where.

---

## 1. What exists today

`buildClaudeEnvLines()` — `src/claude-env.js:33` — emits shell `export` lines:

```
export HTTPS_PROXY=…            :41
export NO_PROXY=localhost,…     :45
export NODE_EXTRA_CA_CERTS=…    :48   (only when a CA path is given)
unset ANTHROPIC_BASE_URL        :50
```

That is the whole story. **Nothing in `src/` reads or writes `~/.claude/settings.json`** —
`grep -rn "settings.json\|\.claude/settings" src/` returns nothing.

So FR-03 is not a modification of existing behaviour. The settings-file half is new
capability, and the shell half already exists in a form that only covers a shell.

---

## 2. Why both locations are required

Measured — F14 through F17:

| | Pre-settings window | After settings load | Background agents |
| --- | --- | --- | --- |
| Shell `export` | ✅ | ✅ | ✅ (F15) |
| `settings.json`, **project** scope | ✗ | ✅ | ❌ **bypasses** (F16) |
| `settings.json`, **user** scope | ✗ | ✅ | ✅ (F17) |

With shell and user-scope settings both in place, **9 of 9** observed paths were captured
(F14).

Two findings drive the requirements below.

**F16 — project scope is not a weaker option, it is a silent hole.** A background agent
configured that way ran to completion having reached the upstream directly. Nothing
surfaced an error; the only reason it was noticed is that a proxy was watching.

**F05 — one request fires before settings are read.** `POST /api/eval/*` leaves before
`settings.json` is applied, so only the shell export catches it. It is not an inference
call and spends no quota, but it is the difference between "all traffic" and "almost all".

---

## 3. Requirements

### 3.1 What enrolment writes

> **FR-03.1** Enrolment MUST write the proxy configuration to `~/.claude/settings.json` —
> **user scope**. Project scope MUST NOT be used.

> **FR-03.2** Enrolment MUST also write a shell `export`, covering the window before
> settings are read.

> **FR-03.3** Writing `settings.json` MUST merge into any existing `env` block and preserve
> every unrelated key **and every comment**. It MUST NOT rewrite the file wholesale.

Comments are the part "every unrelated key" misses. A `settings.json` containing a `//`
comment was accepted and the session ran normally (ASM-18), so users may reasonably have
them — and `JSON.parse` followed by `stringify` drops them silently, which is the worst
shape a data-loss bug can take.

The file holds the user's own settings — `model`, `theme`, `autoUpdatesChannel` and so on.
Losing them to enrolment would be a poor trade for a proxy.

> **FR-03.4** Enrolment MUST be idempotent: running it twice MUST leave the same state as
> running it once.

> **FR-03.5** Enrolment MUST be reversible. An `unenrol` path MUST remove exactly what was
> added — the `env` keys, the shell lines, and the artifact files — and leave the machine
> reaching the upstream directly.

FR-03.5 is the escape hatch NFR-13 depends on: when the service is unreachable, undoing
enrolment is how a user gets back to work without the operator
([#20](../../../issues/20)).

### 3.2 Artifacts

> **FR-16.1** Enrolment MUST place `tenant-ca.pem`, and — for M2 — `device.crt` and
> `device.key`, in a stable location referenced from both configuration sites, with the
> private key readable only by the user.

Certificate **files** are placed in M1 even though mTLS enforcement is M2
([#6](../../../issues/6)). Placing them now means M2 does not have to redo enrolment.

> **FR-16.2** For self-hosting the operator copies the artifacts themselves; an
> authenticated distribution channel is **not** an M1 requirement. It becomes one in M3,
> when other people enrol.

### 3.3 Detecting a broken configuration

> **FR-18.1** The proxy MUST detect a client that reached it through only one of the two
> configuration paths, and MUST report it.

ASM-13 is the risk: if one location is lost — an edited `settings.json`, a shell rc that
stopped being sourced — traffic leaks silently and everything still appears to work.

The signal is available without new plumbing: the pre-settings request (`/api/eval/*`)
arrives **only** when the shell export is present. A session whose first contact is the
post-settings burst was configured by `settings.json` alone. The inverse — settings
missing — shows up as a background agent that never appears at all, which is harder, and
is the case FR-18.1 most needs to catch.

---

## 4. Configuration surface

Written into `~/.claude/settings.json`:

```json
{
  "env": {
    "HTTPS_PROXY": "https://proxy.example:8443",
    "NODE_EXTRA_CA_CERTS": "~/.teamclaude/tenant-ca.pem",
    "CLAUDE_CODE_CLIENT_CERT": "~/.teamclaude/device.crt",
    "CLAUDE_CODE_CLIENT_KEY": "~/.teamclaude/device.key"
  }
}
```

And the same values as shell `export` lines. `buildClaudeEnvLines()`
(`src/claude-env.js:33`) already produces that shape for the shell and is the natural place
to extend — note it currently emits `NO_PROXY=localhost,127.0.0.1,::1` (`:45`), which stays
correct.

The client certificate variables are placed in M1 and unused until
[#6](../../../issues/6).

---

## 5. Tests

| | Asserts |
| --- | --- |
| Enrolment writes the `env` block to the user-scope path | FR-03.1 |
| Enrolment emits the shell export | FR-03.2 |
| An existing `settings.json` keeps every unrelated key, and an existing `env` block is merged | FR-03.3 |
| A `settings.json` containing comments still has them afterwards | FR-03.3, ASM-18 |
| Running enrolment twice produces byte-identical output | FR-03.4 |
| `unenrol` restores the file to its pre-enrolment bytes and removes the artifacts | FR-03.5 |
| The private key is written with owner-only permissions | FR-16.1 |
| A session seen only after settings load is reported as partially configured | FR-18.1 |

FR-03.3 and FR-03.5 want a fixture of a realistic settings file — the one on this machine
carries seven unrelated keys — rather than an empty object.

---

## 6. Open

- **FR-18.1's detection of the inverse case** — settings missing, shell present — is stated
  as a requirement without a mechanism. A background agent that never reaches the proxy
  produces no signal at the proxy by definition. It may only be detectable from the client
  side, during enrolment, by launching a background agent and confirming it arrives.
- **Interactive mode is unmeasured** (ASM-08). The window boundaries in §2 come from `-p`
  and `--bg` runs.
