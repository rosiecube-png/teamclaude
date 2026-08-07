import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// A guard that has never failed might be asserting nothing.
//
// One of them was. `a measured finding that changed a contract is traced`
// matched zero rows for its whole life — the verdict text is "measured false on
// the request path", and the pattern wanted "measured false" straight after a
// pipe. It compared an empty list to an empty list and passed, every run.
//
// So each guard is shown to fail against the omission it exists for. Every
// mutation is written, run, and reverted from memory in the same tick; nothing
// is left behind even if a run throws, because the original text is held in a
// local and restored in `finally`.

const DOC = 'docs/saas-requirements.md';
const LOG = 'docs/plans/change-log.md';
const SEAMS = 'docs/plans/contracts/m1-internal-seams.md';
const PLAN = 'docs/plans/m1-plan.json';
const HARDENING = 'docs/specs/m1-hardening.md';

/** Run the coverage suite against the working tree. True when it is all green. */
function coveragePasses() {
  try {
    const out = execFileSync(process.execPath,
      ['--test', 'test/requirements-coverage.test.js'],
      { encoding: 'utf8', stdio: 'pipe' });
    return /ℹ fail 0/.test(out);
  } catch {
    return false; // non-zero exit means a check failed, which is the point
  }
}

/**
 * Apply `mutate` to `file`, assert the suite goes red, and put the file back.
 * The revert is in `finally` so a throwing assertion cannot leave the tree dirty.
 */
function omissionIsCaught(file, mutate) {
  const original = readFileSync(file, 'utf8');
  try {
    const mutated = mutate(original);
    assert.notEqual(mutated, original,
      `the mutation did not change ${file} — the anchor text has moved, so this ` +
      'test would pass without ever exercising the guard');
    writeFileSync(file, mutated);
    return coveragePasses() === false;
  } finally {
    writeFileSync(file, original);
  }
}

test('an unscheduled requirement is caught', () => {
  assert.ok(omissionIsCaught(DOC, (s) =>
    s.replace('| **NFR-27** |', '| **NFR-88** | An entry nobody scheduled | none |\n| **NFR-27** |')));
});

test('a spec inventing its own prefix is caught', () => {
  assert.ok(omissionIsCaught(HARDENING, (s) => s.replace('> **FR-07.1**', '> **ZZZ-07.1**')));
});

test('an id scheme missing a prefix is caught', () => {
  assert.ok(omissionIsCaught(DOC, (s) => s.replace('| `RSK-nn` |', '| `XXX-nn` |')));
});

test('a risk with no owner is caught', () => {
  assert.ok(omissionIsCaught(DOC, (s) =>
    s.replace('| Operator | M1 running, first real traffic |', '|  | M1 running, first real traffic |')));
});

test('an assumption with a verdict but no grounds is caught', () => {
  assert.ok(omissionIsCaught(DOC, (s) =>
    s.replace(/(\| \*\*ASM-01\*\* \|[^|]*\| )[^|]*(\|)/, '$1 ✅ $2')));
});

test('the plan and register risk sets drifting apart is caught', () => {
  assert.ok(omissionIsCaught(PLAN, (s) => {
    const p = JSON.parse(s);
    p.project_controls.iso_31000.top_risks = p.project_controls.iso_31000.top_risks.slice(0, 3);
    p.project_controls.iso_31000.treatments = p.project_controls.iso_31000.treatments.slice(0, 3);
    return JSON.stringify(p, null, 2) + '\n';
  }));
});

test('a measured-false finding missing from the trace is caught', () => {
  assert.ok(omissionIsCaught(LOG, (s) => s.replaceAll('ASM-23', 'ASM-XX')));
});

test('the two contracts disagreeing about refusals is caught', () => {
  assert.ok(omissionIsCaught(SEAMS, (s) => s.replace('only to the log', 'somewhere unspecified')));
});

test('two tasks in one tier owning the same file is caught', () => {
  assert.ok(omissionIsCaught(PLAN, (s) => {
    const p = JSON.parse(s);
    const a = p.tasks.find((t) => t.id === 'task-1');
    const b = p.tasks.find((t) => t.id === 'task-2');
    b.scope.push('src/mitm.js');
    b.priority = a.priority;
    return JSON.stringify(p, null, 2) + '\n';
  }));
});

test('a criterion added to the plan but not the board is caught', () => {
  assert.ok(omissionIsCaught(PLAN, (s) => {
    const p = JSON.parse(s);
    p.tasks[1].acceptance_criteria.push('a criterion the board has never seen');
    return JSON.stringify(p, null, 2) + '\n';
  }));
});

test('the reverse index disappearing is caught', () => {
  assert.ok(omissionIsCaught(LOG, (s) =>
    s.replace('## Reverse index — what shaped each artifact', '## Notes')));
});

test('M1 claiming a requirement the plan never mentions is caught', () => {
  assert.ok(omissionIsCaught(DOC, (s) =>
    s.replace('| Boundary values exercised wherever a requirement classifies a range | NFR-26 |',
      '| Boundary values exercised wherever a requirement classifies a range | NFR-99 |')));
});
