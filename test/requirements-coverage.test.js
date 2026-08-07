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

// The guard-proving suite runs these same checks against a mutated copy, so the
// paths are rooted at a variable. Node runs test files in parallel; a test that
// mutated the working tree would otherwise fail its neighbours at random.
const ROOT = process.env.TC_DOCS_ROOT || '.';
const at = (...parts) => join(ROOT, ...parts);
const DOC = at('docs', 'saas-requirements.md');
const SPEC_DIR = at('docs', 'specs');

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
      `${id}: an assumption without a verdict is one nobody has checked — mark it measured, ` +
      'source-read, deferred, unverified or false');
    assert.ok(status.length > 12, `${id}: say what the verdict rests on, not just the symbol`);
  }
});

// The four omissions a review found after "everything is synchronised" was
// claimed: governance not recomputed, the risk blocks drifting apart, a contract
// left inconsistent with another contract, and no record of what followed from
// what. Each is now a check rather than a promise.

test('the plan and the register describe the same risks', () => {
  const plan = JSON.parse(readFileSync(at('docs','plans','m1-plan.json'), 'utf8'));
  const inPlan = [...new Set(
    (JSON.stringify(plan.project_controls.iso_31000).match(/RSK-\d\d/g) || []))].sort();
  const inDoc = [...new Set((doc().match(/\| \*\*RSK-\d\d\*\*/g) || [])
    .map((x) => x.replace(/[|*\s]/g, '')))].sort();
  assert.ok(inDoc.length > 0 && inPlan.length > 0,
    'one side lists no risks at all — this guard would pass by comparing two empty sets');
  assert.deepEqual(inPlan, inDoc,
    'the risk register in §10 and the plan iso_31000 block have drifted apart');
});

test('a measured finding that changed a contract is traced', () => {
  const trace = readFileSync(at('docs','plans','change-log.md'), 'utf8');
  // every assumption the register marks measured-false changed something, so it
  // has to appear in the trace with what it touched
  const falsified = doc().split('\n')
    .filter((l) => /^\| \*\*ASM-\d+\*\*/.test(l) && /measured false/.test(l))
    .map((l) => l.match(/ASM-\d+/)[0]);
  assert.ok(falsified.length > 0,
    'no assumption is marked measured false — either the register changed shape, ' +
    'or this guard is matching nothing and asserting nothing');
  const untraced = falsified.filter((id) => !trace.includes(id));
  assert.deepEqual(untraced, [],
    `these findings changed something and are not in the change trace: ${untraced.join(', ')}`);
});

test('the two contracts agree about refusals', () => {
  const envelope = readFileSync(at('docs','plans','contracts','m1-error-envelope.md'), 'utf8');
  const seams = readFileSync(at('docs','plans','contracts','m1-internal-seams.md'), 'utf8');
  assert.ok(/request-path/.test(envelope) && /400/.test(envelope),
    'the error envelope no longer distinguishes the request path');
  // S2 places a correlation id; a CONNECT refusal has no body to carry one
  assert.ok(/only to the log/.test(seams),
    'the seams contract must say a CONNECT refusal carries its id in the log alone, ' +
    'since the envelope gives that path no body');
});

// The plan was re-validated by hand after each change and reported as passing.
// Reporting is not enforcing: the next change to project_controls, or to a
// task's scope, would be checked only if someone remembered to.
test('the plan is internally consistent', () => {
  const plan = JSON.parse(readFileSync(at('docs','plans','m1-plan.json'), 'utf8'));
  const ids = new Set(plan.tasks.map((t) => t.id));

  for (const t of plan.tasks) {
    for (const d of t.dependencies) {
      assert.ok(ids.has(d), t.id + ' depends on unknown ' + d);
      const dep = plan.tasks.find((x) => x.id === d);
      assert.ok(dep.priority < t.priority,
        t.id + ' (tier ' + t.priority + ') depends on ' + d + ' (tier ' + dep.priority + ')');
    }
    assert.ok(t.acceptance_criteria.length > 0, t.id + ' has no acceptance criteria');
    assert.ok(['tdd', 'test_after', 'not_applicable'].includes(t.test_approach),
      t.id + ' has an invalid test_approach');
    if (t.test_approach === 'not_applicable') {
      assert.ok(t.test_approach_rationale && t.alternative_verification,
        t.id + ' is not_applicable without a rationale and an alternative verification');
    }
  }

  // Two agents editing one file in parallel is what scope exists to prevent, so
  // a task that is finished is not a party to it — nothing of it is still
  // running. task-2 needed x509.js for a certificate request, which task-1 had
  // already finished with; refusing that would have meant either a second copy
  // of the ASN.1 primitives or a false entry in the plan.
  const byTier = {};
  for (const t of plan.tasks) if (t.status !== 'done') (byTier[t.priority] ||= []).push(t);
  for (const [tier, ts] of Object.entries(byTier)) {
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const overlap = ts[i].scope.filter((a) => ts[j].scope.some((b) => a.startsWith(b) || b.startsWith(a)));
        assert.deepEqual(overlap, [],
          'tier ' + tier + ': ' + ts[i].id + ' and ' + ts[j].id + ' both own ' + overlap.join(', '));
      }
    }
  }
});

// Building task-1 turned this up: criterion 7 named src/server.js:182 and the
// scope listed four files, none of them that one. The overlap check above asks
// whether two tasks in a tier own the same file; nothing asked whether a task
// owns the files its own criteria point at. A task that cannot be finished
// inside its scope either edits somebody else's file or silently drops the
// criterion.
test('a task owns the files its acceptance criteria name', () => {
  const plan = JSON.parse(readFileSync(at('docs','plans','m1-plan.json'), 'utf8'));
  // A path, or a `file.js:182` citation. The second form is what was missed:
  // criterion 7 wrote `certsPromise (server.js:182)` with no directory, so a
  // path-shaped match alone would not have caught it.
  //
  // Bare names with no line number are deliberately ignored. Criteria refer to
  // files they are not going to touch — task-0 decides a seam "while
  // claude-env.js stays pure", task-2 writes the client's own settings.json —
  // and demanding ownership of those is noise. A line number means somebody
  // read that code and expects it to change.
  const PATH = /\b(?:src|test|docs|scripts)\/[A-Za-z0-9._/-]+\.[a-z]+\b/g;
  const CITED = /(?<![/\w.-])([a-z][a-z0-9-]*\.(?:js|mjs)):\d+/g;

  const unowned = [];
  let citations = 0;
  for (const t of plan.tasks) {
    const owns = (f) => t.scope.some((s) => s === f || f.startsWith(s) || s.startsWith(f));
    for (const c of t.acceptance_criteria) {
      for (const f of c.match(PATH) || []) if (!owns(f)) unowned.push(`${t.id}: ${f}`);
      for (const [, n] of c.matchAll(CITED)) {
        citations++;
        if (!t.scope.some((s) => s === n || s.endsWith('/' + n))) unowned.push(`${t.id}: ${n}`);
      }
    }
  }
  assert.ok(citations > 0 && plan.tasks.some((t) => t.acceptance_criteria.join(' ').match(PATH)),
    'no criterion names a file or cites a line — this guard would pass by checking nothing');
  assert.deepEqual([...new Set(unowned)], [],
    'these tasks are asked for a file they do not own — widen the scope or move the criterion:\n  ' +
    [...new Set(unowned)].join('\n  '));
});

// The board is generated from the plan, so it goes stale silently the moment a
// criterion is added and nobody regenerates it.
test('the task board matches the plan it came from', () => {
  const plan = JSON.parse(readFileSync(at('docs','plans','m1-plan.json'), 'utf8'));
  const board = readFileSync(at('docs','plans','task-board.md'), 'utf8');
  const total = plan.tasks.reduce((n, t) => n + t.acceptance_criteria.length, 0);
  assert.ok(total > 0, 'the plan carries no acceptance criteria — nothing to compare');
  const missing = [];
  for (const t of plan.tasks) {
    for (const c of t.acceptance_criteria) if (!board.includes(c)) missing.push(t.id + ': ' + c.slice(0, 60));
  }
  assert.deepEqual(missing, [],
    'the board is stale — regenerate it from the plan:\n  ' + missing.join('\n  '));
});

// Forward tracing says a finding reached everywhere. It cannot say why a file
// says what it says, which is the question someone asks opening it cold.
test('the change trace runs in both directions', () => {
  const trace = readFileSync(at('docs','plans','change-log.md'), 'utf8');
  assert.ok(/Reverse index/.test(trace), 'the change trace has no reverse index');
  for (const artifact of ['m1-error-envelope.md', 'm1-internal-seams.md', 'm1-plan.json',
    'requirements-coverage.test.js']) {
    assert.ok(trace.includes(artifact), 'the reverse index does not account for ' + artifact);
  }
});

test('the M1 plan is validated against the register it ships with', () => {
  const planPath = at('docs','plans','m1-plan.json');
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
