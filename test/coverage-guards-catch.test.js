import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// A guard that has never failed might be asserting nothing.
//
// One of them was. `a measured finding that changed a contract is traced`
// matched zero rows for its whole life — the verdict text is "measured false on
// the request path", and the pattern wanted "measured false" straight after a
// pipe. It compared an empty list to an empty list and passed, every run.
//
// So each guard is shown to fail against the omission it exists for: write the
// omission, assert the coverage suite goes red, throw the copy away.
//
// The copy matters. The first version of this file mutated the working tree, and
// Node runs test files in parallel — the coverage suite read a half-mutated
// document and failed for reasons that had nothing to do with it. A test that
// edits the repository under a parallel runner is a defect regardless of whether
// it reverts afterwards.

const ARTIFACTS = 'docs';
const COVERAGE = 'test/requirements-coverage.test.js';

/** A throwaway copy of the artifacts the coverage suite reads. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'tc-guards-'));
  cpSync(ARTIFACTS, join(dir, 'docs'), { recursive: true });
  return dir;
}

/** Run the coverage suite against `root`. True when it is all green. */
function coveragePasses(root) {
  try {
    const out = execFileSync(process.execPath, ['--test', COVERAGE], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, TC_DOCS_ROOT: root },
    });
    return /ℹ fail 0/.test(out);
  } catch {
    return false; // a non-zero exit means a check failed, which is the point
  }
}

/**
 * Apply `mutate` to `file` inside a sandbox and assert the suite notices.
 *
 * Also asserts the mutation changed something: an anchor that has moved would
 * otherwise leave this passing while exercising nothing, which is the exact
 * failure mode this file exists to rule out.
 */
function omissionIsCaught(relPath, mutate) {
  const root = sandbox();
  try {
    const file = join(root, relPath);
    const original = readFileSync(file, 'utf8');
    const mutated = mutate(original);
    assert.notEqual(mutated, original,
      `the mutation did not change ${relPath} — its anchor text has moved, so this ` +
      'test would pass without exercising the guard');
    writeFileSync(file, mutated);
    return coveragePasses(root) === false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const DOC = 'docs/saas-requirements.md';
const LOG = 'docs/plans/change-log.md';
const SEAMS = 'docs/plans/contracts/m1-internal-seams.md';
const PLAN = 'docs/plans/m1-plan.json';
const HARDENING = 'docs/specs/m1-hardening.md';

const editJson = (fn) => (s) => {
  const p = JSON.parse(s);
  fn(p);
  return JSON.stringify(p, null, 2) + '\n';
};

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
  assert.ok(omissionIsCaught(PLAN, editJson((p) => {
    const r = p.project_controls.iso_31000;
    r.top_risks = r.top_risks.slice(0, 3);
    r.treatments = r.treatments.slice(0, 3);
  })));
});

test('a measured-false finding missing from the trace is caught', () => {
  assert.ok(omissionIsCaught(LOG, (s) => s.replaceAll('ASM-23', 'ASM-XX')));
});

test('the two contracts disagreeing about refusals is caught', () => {
  assert.ok(omissionIsCaught(SEAMS, (s) => s.replace('only to the log', 'somewhere unspecified')));
});

test('two tasks in one tier owning the same file is caught', () => {
  assert.ok(omissionIsCaught(PLAN, editJson((p) => {
    const a = p.tasks.find((t) => t.id === 'task-1');
    const b = p.tasks.find((t) => t.id === 'task-2');
    b.scope.push('src/mitm.js');
    b.priority = a.priority;
  })));
});

test('a criterion added to the plan but not the board is caught', () => {
  assert.ok(omissionIsCaught(PLAN, editJson((p) => {
    p.tasks[1].acceptance_criteria.push('a criterion the board has never seen');
  })));
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
