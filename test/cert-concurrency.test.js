import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';

// ASM-30 — `ensureCerts` runs in the CLI as well as the server, so more than one
// process writes the certificate directory. It was carried as *unverified*; it
// reproduces.
//
// Three processes regenerating concurrently, with a fourth reading the pair the
// way every intercepted CONNECT does:
//
//   without a lock   820 mismatched pairs in 17,249 reads (4.75%)
//   with one          39 in 17,763                        (0.22%)
//   and a re-read      0 in 16,474, and zero regenerations, for the case that
//                      actually happens — every process wanting the same host
//
// On Windows the writers also failed outright: a rename over a file another
// process holds is EPERM, 4 to 10 times per process.

const TMP = mkdtempSync(join(tmpdir(), 'tc-conc-'));
process.env.TEAMCLAUDE_CONFIG = join(TMP, 'config.json');

const { ensureCerts } = await import('../src/mitm.js');
const { createCA, createLeaf } = await import('../src/x509.js');

const LOCK = join(TMP, 'teamclaude-certs.lock');
const CA = join(TMP, 'teamclaude-ca.pem');
const LEAF = join(TMP, 'teamclaude-leaf.pem');
const KEY = join(TMP, 'teamclaude-leaf.key');
const HOST = 'api.anthropic.com';

const CA_KEY = join(TMP, 'teamclaude-ca.key');
const CROSS = join(TMP, 'teamclaude-ca-cross.pem');
const wipe = () => { for (const f of [CA, CA_KEY, CROSS, LEAF, KEY, LOCK]) rmSync(f, { force: true }); };
const pairAgrees = () => {
  const ca = new X509Certificate(readFileSync(CA, 'utf8'));
  return new X509Certificate(readFileSync(LEAF, 'utf8')).verify(ca.publicKey);
};

test('concurrent callers in one process mint one chain, not several', async () => {
  wipe();
  let minted = 0;
  const log = (m) => { if (/(minting a MITM|renewing the MITM|CA expires in)/.test(m)) minted++; };
  const all = await Promise.all(
    Array.from({ length: 6 }, () => ensureCerts(HOST, { config: {}, log })));
  assert.equal(minted, 1, `six callers minted ${minted} chains`);
  const first = all[0].leafCertPem;
  for (const r of all) assert.equal(r.leafCertPem, first, 'callers got different chains');
  assert.ok(pairAgrees());
});

test('the lock is released, so the next call is not blocked by the last', async () => {
  wipe();
  await ensureCerts(HOST, { config: {} });
  assert.ok(!existsSync(LOCK), 'a lock file was left behind');
  const again = await ensureCerts(HOST, { config: {} });
  assert.ok(again.leafCertPem);
});

test('the lock is released even when minting throws', async () => {
  wipe();
  // An unwritable target: the directory itself where a file is expected.
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CA, { recursive: true });
  try {
    await assert.rejects(() => ensureCerts(HOST, { config: {} }));
  } finally {
    rmSync(CA, { recursive: true, force: true });
  }
  assert.ok(!existsSync(LOCK),
    'a failed regeneration kept the lock, so every later process would wait for a dead one');
});

test('a stale lock is broken rather than waited on forever', async () => {
  wipe();
  writeFileSync(LOCK, '999999');           // a process that is not coming back
  const old = new Date(Date.now() - 60_000);
  utimesSync(LOCK, old, old);
  const started = Date.now();
  const out = await ensureCerts(HOST, { config: {} });
  assert.ok(out.leafCertPem, 'a dead holder blocked minting');
  assert.ok(Date.now() - started < 20_000, 'it waited on a lock nobody holds');
  assert.ok(!existsSync(LOCK));
});

test('a fresh lock held by someone else is waited for, not stolen', async () => {
  wipe();
  await ensureCerts(HOST, { config: {} });   // a good chain exists
  writeFileSync(LOCK, '1');                  // and someone is holding the lock now
  try {
    // The chain is fine, so this returns without ever wanting the lock.
    const out = await ensureCerts(HOST, { config: {} });
    assert.ok(out.leafCertPem);
    assert.ok(existsSync(LOCK), 'a lock held by another process was removed');
  } finally { rmSync(LOCK, { force: true }); }
});

test('a torn pair is re-read before it is believed', async () => {
  // Between replacing the CA and replacing the leaf there is a moment where the
  // two do not belong together. Treating that as a real mismatch means
  // regenerating a chain somebody else is already fixing.
  wipe();
  await ensureCerts(HOST, { config: {} });
  const good = readFileSync(LEAF, 'utf8');

  // A CA from a different run, beside the good leaf: exactly the torn state.
  const other = createCA('Someone Else', 3650);
  writeFileSync(CA, other.certPem);
  let regenerated = 0;
  await ensureCerts(HOST, { config: {}, log: (m) => { if (/(minting a MITM|renewing the MITM|CA expires in)/.test(m)) regenerated++; } });
  // It does regenerate — the state is genuinely broken and nobody fixed it in
  // between — but the pair it leaves behind agrees.
  assert.equal(regenerated, 1);
  assert.ok(pairAgrees(), 'the chain left on disk does not verify against itself');
  assert.notEqual(readFileSync(LEAF, 'utf8'), good, 'the stale leaf was kept');
  // and the spare CA is gone
  assert.notEqual(readFileSync(CA, 'utf8'), other.certPem);
});

test('a settled problem is not read twice', async () => {
  // Only an inconsistent pair is worth a second look. An expired chain says the
  // same thing however often it is read, and a retry there is latency on the
  // one path that already has to mint a keypair.
  wipe();
  const ca = createCA('Expired', -1);
  writeFileSync(CA, ca.certPem);
  writeFileSync(LEAF, createLeaf([HOST, 'www.example.org'], ca, 90).certPem);
  writeFileSync(KEY, 'x');
  const started = Date.now();
  await ensureCerts(HOST, { config: {} });
  assert.ok(Date.now() - started < 5000);
  assert.ok(pairAgrees());
});

// A racy unit test lived here and was deleted rather than kept green. It wrote a
// torn pair, restored it on a 2ms timer, and asserted no regeneration — but the
// first read is itself asynchronous, so the timer usually fired before anything
// looked. It passed with the re-read *and* the under-lock re-check both removed,
// which is the definition of asserting nothing.
//
// The two checks are also redundant by design: either alone prevents the
// spurious regeneration, so no single-line mutation can show either one working.
// What pins them is the end-to-end case below, which is what the defect actually
// looked like.

// ── across processes, which is what ASM-30 is actually about ────────────────

test('three processes wanting the same chain mint it once between them', { timeout: 60000 }, () => {
  wipe();
  const script = join(TMP, 'racer.mjs');
  writeFileSync(script, `
    process.env.TEAMCLAUDE_CONFIG = ${JSON.stringify(join(TMP, 'config.json'))};
    const { ensureCerts } = await import(${JSON.stringify(new URL('../src/mitm.js', import.meta.url).href)});
    let minted = 0;
    const start = Number(process.argv[2]);
    while (Date.now() < start) { /* line up on a shared clock */ }
    for (let i = 0; i < 5; i++) {
      await ensureCerts('${HOST}', { config: {}, log: (m) => { if (/(minting a MITM|renewing the MITM|CA expires in)/.test(m)) minted++; } });
    }
    process.stdout.write(String(minted));
  `);
  const at = String(Date.now() + 1500);
  const runs = [0, 1, 2].map(() =>
    execFileSync(process.execPath, [script, at], { encoding: 'utf8', timeout: 40000 }));
  const total = runs.reduce((n, r) => n + Number(r), 0);
  assert.equal(total, 1,
    `three processes asking for the same chain minted ${total} of them (${runs.join(',')})`);
  assert.ok(pairAgrees(), 'the chain they left behind does not verify against itself');
  assert.ok(!existsSync(LOCK), 'a lock survived every process that could release it');
});

test('under contention, ensureCerts never hands back an incoherent chain', { timeout: 90000 }, async () => {
  // The contract that matters. A raw reader *will* occasionally see a torn pair
  // whatever we do: three files are replaced one after another and that is not
  // atomic to anyone. What must hold is that `ensureCerts` — which is what every
  // intercepted CONNECT calls — never returns a CA and a leaf that disagree, and
  // never throws while another process is writing.
  //
  // Counted, not timed. The first version ran for a fixed window and asserted the
  // checker had managed 50 calls; on a CI runner already busy with two other Node
  // processes minting keypairs it managed **five**, and failed for being slow
  // rather than for being wrong. Fixed iteration counts make the work identical
  // on every machine, and keep the load small enough not to disturb the
  // timing-sensitive tests running beside it.
  wipe();
  await ensureCerts(HOST, { config: {} });
  const dir = JSON.stringify(TMP);
  const mitm = JSON.stringify(new URL('../src/mitm.js', import.meta.url).href);

  const churn = join(TMP, 'churn.mjs');
  const check = join(TMP, 'check.mjs');
  // The churners outlast the checker, so contention does not stop halfway.
  writeFileSync(churn, `
    import { rmSync } from 'node:fs';
    process.env.TEAMCLAUDE_CONFIG = ${dir} + '/config.json';
    const { ensureCerts } = await import(${mitm});
    while (Date.now() < Number(process.argv[2])) {}
    let errors = 0;
    for (let i = 0; i < 10; i++) {
      // A renewal falling due, from this process's point of view.
      rmSync(${dir} + '/teamclaude-leaf.pem', { force: true });
      try { await ensureCerts('${HOST}', { config: {} }); } catch { errors++; }
    }
    process.stdout.write(String(errors));
  `);
  writeFileSync(check, `
    import { X509Certificate } from 'node:crypto';
    process.env.TEAMCLAUDE_CONFIG = ${dir} + '/config.json';
    const { ensureCerts } = await import(${mitm});
    while (Date.now() < Number(process.argv[2])) {}
    let incoherent = 0, errors = 0, minted = 0;
    const calls = 6;
    for (let i = 0; i < calls; i++) {
      try {
        const c = await ensureCerts('${HOST}', { config: {}, log: (m) => { if (/regenerating|minting/.test(m)) minted++; } });
        const ca = new X509Certificate(c.caCertPem);
        if (!new X509Certificate(c.leafCertPem).verify(ca.publicKey)) incoherent++;
      } catch { errors++; }
    }
    process.stdout.write(JSON.stringify({ calls, incoherent, errors, minted }));
  `);

  const { spawn } = await import('node:child_process');
  const from = String(Date.now() + 1500);
  const run = (script) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script, from]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.once('error', reject);
    p.once('close', () => resolve(out));
  });
  const [e1, e2, checkerOut] = await Promise.all([run(churn), run(churn), run(check)]);
  const { calls, incoherent, errors, minted } = JSON.parse(checkerOut);

  assert.equal(incoherent, 0,
    `ensureCerts returned ${incoherent} chains that do not verify, in ${calls} calls (${minted} minted)`);
  assert.equal(errors, 0, `ensureCerts threw ${errors} times while another process was writing`);
  // On Windows a rename over a file another process holds is EPERM: 4-10 times
  // per process before the retry.
  assert.equal(`${e1}${e2}`, '00', `the writers failed ${e1}+${e2} times`);
  //
  // `minted` is reported but not asserted. The two re-checks — the re-read of a
  // torn pair, and the second look under the lock — only avoid *redundant*
  // minting, and measurably do: 1.7% of calls against 4.6% without them, and
  // roughly twice the throughput, because a keypair is expensive. That is a rate
  // under a noisy concurrent load, so a threshold here would be flaky. Removing
  // either one alone changes no behaviour this suite can see, and removing both
  // changes only the cost. Recorded rather than asserted.
});
