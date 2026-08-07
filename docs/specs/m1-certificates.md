# M1 — Certificate lifetime

Detailed requirements for [#21](../../../issues/21), decomposing one register entry:

| Register entry | Decomposed here as |
| --- | --- |
| **NFR-17** — rotate the secrets the design creates, with a defined lifetime and a revocation path | NFR-17.1 … NFR-17.4 |

This spec covers the certificate half only. The proxy-key half is
[#24](../../../issues/24) in M4, because it becomes urgent when keys belong to different
people.

Every statement about current behaviour was read out of the source and cites where.

---

## 1. What the proxy does today

`ensureCerts()` — `src/mitm.js:73` — reuses the stored chain when `leafCovers()` approves
it:

```js
if (caCertPem && leafCertPem && leafKeyPem && leafCovers(caCertPem, leafCertPem, hosts)) {
  return { … };                                    // :79  reuse
}
const chain = generateCertChain(hosts);            // :83  otherwise regenerate
```

`leafCovers()` — `src/mitm.js:54` — checks exactly two things:

```js
if (!leaf.verify(ca.publicKey)) return false;               // :58  signed by our CA
return hosts.every((h) => names.includes(`DNS:${h}`));      // :60  covers the hosts
```

**It never reads the validity dates.** `grep -rn "validTo\|validFrom\|notAfter\|expir"
src/mitm.js src/x509.js` matches only the issuance code in `src/x509.js:97` and `:116`.

Lifetimes at issuance:

| | Value | Source |
| --- | --- | --- |
| CA | **3650 days** | `src/x509.js:141` |
| Leaf | **825 days** | `src/x509.js:151` |

The CA private key is discarded rather than stored — `src/mitm.js:83`, "caKeyPem
intentionally discarded". Only the CA certificate, the leaf certificate and the leaf key
are written (`:85` onward).

---

## 2. What is wrong

### 2.1 An expired leaf is reused, not replaced

825 days after a leaf is first minted it expires. `leafCovers()` still returns true — the
signature is still valid and the SANs still match — so `ensureCerts()` hands the expired
chain to the terminating server. Every intercepted TLS connection then fails, and nothing
regenerates.

The only recovery is deleting the files by hand. Nothing logs a warning as the date
approaches, because nothing looks at the date.

### 2.2 The blast radius grows in M2

Today regeneration is cheap precisely because nothing durable trusts the CA: it is minted
locally, handed to one launched `claude` through `NODE_EXTRA_CA_CERTS`, and the CA key is
discarded (`:83`). Replacing the whole chain costs nothing.

That stops being true once devices are enrolled against a CA they were handed at setup
([#19](../../../issues/19), and the per-tenant CA in [#5](../../../issues/5)). Then:

- an expired **leaf** breaks every enrolled device at once
- an expired or replaced **CA** breaks them until each is given the new one

Which is why this is M1 work — the enrolment story must not be built on a chain that
silently lapses.

---

## 3. Requirements

> **NFR-17.1** `leafCovers()` MUST reject a leaf that has expired, and MUST reject one whose
> remaining life is below a renewal threshold.

Rejecting only on expiry would mean the chain is replaced at the moment it breaks. The
threshold makes renewal happen before anything fails.

> **NFR-17.2** The same check MUST apply to the CA certificate. A leaf signed by an expired
> CA is not usable, and its own dates say nothing about that.

> **NFR-17.3** Renewal MUST be observable: the proxy MUST log when it regenerates a chain
> and why (expired, near expiry, or host mismatch).

Silent regeneration is how the current behaviour went unnoticed. In M2 it also becomes the
signal that enrolled devices are about to need a new CA.

> **NFR-17.4** Certificate lifetimes MUST be configurable, and the shipped defaults MUST be
> shorter than they are today.

> **NFR-17.5** The renewal check MUST NOT be memoised for the process lifetime, and a
> replaced chain MUST reach new connections without a restart.

NFR-17.5 is the one that makes the rest work, and it was missing. Two memos stand between
a regenerated chain and a client: `certsPromise` (`src/server.js:182`) is resolved once,
and `serverPromises` (`src/mitm.js:131`) caches a terminating server that baked the
certificate in at creation. Neither is invalidated by anything except a cert error.

So a shorter lifetime without this is worse than leaving it alone. Measured (ASM-17):

| | |
| --- | --- |
| An **established** connection | survives expiry — traffic flowed 2s past `notAfter` |
| A **new** connection | refused with `CERT_HAS_EXPIRED` |

Claude Code opens tunnels constantly, so the failure would not be a clean stop. Existing
tunnels keep working while every new one fails, which reads as intermittent breakage.

Also unresolved (ASM-22): `ensureCerts` is called from the CLI too (`src/index.js:648`,
`:718`), so `teamclaude run` can regenerate a chain while a running server still serves the
old one from its memo.

825 days for a leaf is long enough that no operator will observe a renewal before it
bites. A shorter lifetime exercises the renewal path routinely, which is what makes it
trustworthy when it matters. The CA's 3650 days is a separate decision — it is bounded by
how often enrolled devices can be asked to accept a new one, which is
[#5](../../../issues/5)'s problem.

---

## 4. Configuration surface

```json
{
  "proxy": {
    "certs": {
      "leafDays": 90,
      "renewBeforeDays": 30
    }
  }
}
```

CA lifetime is deliberately absent: while the CA key is discarded and the chain is
regenerated freely, it is not an operator-facing decision. It becomes one in
[#5](../../../issues/5), when the key is persisted and devices trust it.

---

## 5. Tests

| | Asserts |
| --- | --- |
| A chain whose leaf `notAfter` is in the past is replaced, not returned | NFR-17.1 |
| A chain whose leaf expires within the renewal window is replaced | NFR-17.1 |
| A leaf still inside the window, covering the hosts, is reused — no needless churn | NFR-17.1 |
| A chain replaced while the process runs reaches the next connection, without a restart | NFR-17.5 |
| A connection open across the replacement is not disturbed | NFR-17.5, ASM-17 |
| A chain whose **CA** has expired is replaced even when the leaf is fresh | NFR-17.2 |
| Regeneration logs the reason | NFR-17.3 |
| `leafDays` and `renewBeforeDays` are honoured | NFR-17.4 |

`createLeaf()` (`src/x509.js:146`) takes `days` at issuance, so a test can mint a chain
with a past `notAfter` directly — no clock manipulation needed.

---

## 6. Open

**`leafDays` and `renewBeforeDays` are not an owner decision.** They were listed as one, in
error: a leaf swap needs no client action (ASM-16, verified — clients hold the CA, not the
leaf), so nothing competes with making the lifetime short enough to exercise renewal. The
values follow from NFR-17.5 rather than from preference, and 90 / 30 is proposed on that
basis.

The CA lifetime *is* a decision, and belongs to [#5](../../../issues/5), where the key
stops being disposable and devices start trusting a specific one.
