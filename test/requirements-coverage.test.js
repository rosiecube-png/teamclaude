import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The requirements register is only useful if nothing falls out of it silently.
//
// It has fallen out twice. Writing the M1 specs turned up NFR-20, NFR-21 and
// FR-18 — requirements with no register entry, which went unnoticed because the
// specs had invented their own IDs. Then the standards audit added NFR-22..27,
// and the M1 plan had already been validated against the register as it was, so
// two of them (boundary coverage, defect gating) were acceptance conditions for
// tasks that did not mention them.
//
// Both were found by hand. These tests make the next one fail a run instead.

const DOC = 'docs/saas-requirements.md';
const SPEC_DIR = 'docs/specs';

const doc = () => readFileSync(DOC, 'utf8');
const specs = () =>
  readdirSync(SPEC_DIR).filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(join(SPEC_DIR, f), 'utf8')).join('\n');

/** Requirement ids declared in the register, e.g. FR-07, NFR-21. */
function declaredIds(text) {
  return [...new Set((text.match(/^\| \*\*(?:FR|NFR)-\d+\*\*/gm) || [])
    .map((row) => row.replace(/[|*\s]/g, '')))];
}

function section(text, heading, next) {
  const from = text.indexOf(heading);
  const to = text.indexOf(next);
  assert.ok(from >= 0 && to > from, `expected sections ${heading} and ${next}`);
  return text.slice(from, to);
}

test('every declared requirement is claimed by a milestone or a spec', () => {
  const text = doc();
  const ids = declaredIds(text);
  assert.ok(ids.length > 0, 'no requirement ids found — has the register format changed?');

  const milestones = section(text, '## 6. Milestones', '## 7.');
  const spec = specs();

  const orphans = ids.filter((id) => !milestones.includes(id) && !spec.includes(id));
  assert.deepEqual(orphans, [],
    `these requirements are in the register but nothing schedules them:\n  ${orphans.join('\n  ')}\n` +
    'Add them to a milestone table in §6, or to a spec, or state why they are out of scope.');
});

// A sub-requirement extends its parent (FR-07.3). Anything else is a new ID
// space, which is what broke traceability when the hardening spec numbered
// itself R-8.1..R-8.11 against an issue number.
test('specs decompose register ids rather than inventing their own', () => {
  const known = new Set(declaredIds(doc()).map((id) => id.split('-')[0]));
  const invented = [...new Set((specs().match(/^> \*\*([A-Z]+)-[\d.]+\*\*/gm) || [])
    .map((m) => m.replace(/[>*\s]/g, '').split('-')[0]))]
    .filter((prefix) => !known.has(prefix));

  assert.deepEqual(invented, [],
    `specs use requirement prefixes that the register does not declare: ${invented.join(', ')}. ` +
    'Decompose an existing id, or add the entry to the register first.');
});

test('the identifier scheme is declared, so the next prefix is not invented', () => {
  const text = doc();
  for (const prefix of ['FR-nn', 'NFR-nn', 'ASM-nn', 'CON-nn', 'RSK-nn']) {
    assert.ok(text.includes(`\`${prefix}\``), `the id scheme table is missing ${prefix}`);
  }
  // R- was spec sub-requirement ids, withdrawn for breaking traceability. Reusing
  // it for risks put R-8 in the repo meaning two things; the doc records why not.
  assert.ok(/`R-` is deliberately unused/.test(text), 'the doc no longer records why R- is unused');
});

test('every risk carries a rating, an owner and a residual', () => {
  const text = doc();
  const rows = text.split('\n').filter((l) => /^\| \*\*RSK-\d+\*\*/.test(l));
  assert.ok(rows.length > 0, 'no risks found in §10');
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    const id = cells[1].replace(/\*/g, '');
    // | id | risk | L | I | treatment | residual | owner | review |
    assert.ok(/^\*{0,2}[LMH]\*{0,2}$/.test(cells[3]), `${id}: likelihood must be L, M or H`);
    assert.ok(/^\*{0,2}[LMH]\*{0,2}$/.test(cells[4]), `${id}: impact must be L, M or H`);
    assert.ok(cells[6].length > 0, `${id}: residual must be stated, even if it is "none"`);
    assert.ok(cells[7].length > 0, `${id}: every risk needs an owner`);
  }
});

// Twenty-four assumptions were added in one sweep, and every one had been sitting
// inside a document that read as fact. What made them findable was the status
// column: an entry with no verdict is one nobody has checked.
test('every assumption carries a verification status', () => {
  const rows = doc().split('\n').filter((l) => /^\| \*\*ASM-\d+\*\*/.test(l));
  assert.ok(rows.length > 0, 'no assumptions found in §4.3');
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    const id = cells[1].replace(/\*/g, '');
    const status = cells[3] || '';
    assert.ok(/[✅❌⚠️]/.test(status),
      `${id}: an assumption without a verdict is one nobody has checked — mark it verified, ` +
      'unverified, false or imprecise');
    assert.ok(status.length > 12, `${id}: say what the verdict rests on, not just the symbol`);
  }
});

test('the M1 plan is validated against the register it ships with', () => {
  const planPath = 'docs/plans/m1-plan.json';
  assert.ok(existsSync(planPath), 'the durable M1 plan is missing');

  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const text = doc();
  const milestones = section(text, '## 6. Milestones', '## 7.');

  // Anything M1 claims must appear in the plan, or the plan is stale.
  const m1 = milestones.slice(milestones.indexOf('### M1'), milestones.indexOf('### M2'));
  const m1Ids = [...new Set((m1.match(/\b(?:FR|NFR)-\d+\b/g) || []))];
  const planText = JSON.stringify(plan) + specs();

  const missing = m1Ids.filter((id) => !planText.includes(id));
  assert.deepEqual(missing, [],
    `M1 claims these requirements but neither the plan nor a spec mentions them:\n  ${missing.join('\n  ')}\n` +
    'The register grew after the plan was validated — re-validate it.');
});
