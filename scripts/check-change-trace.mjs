#!/usr/bin/env node
// Block a change to a requirements artifact that does not say what it touched.
//
// Every omission this repository has had was the same shape: a document changed
// and its dependants did not. The guards in test/ catch the ones whose shape was
// already known -- an unscheduled requirement, a drifted risk block. This catches
// the class: if a governing artifact moved and docs/plans/change-log.md did not,
// nobody recorded what else should have moved, and the next gap is invisible
// until somebody reads for it.
//
// Runs against a diff, so it belongs in CI rather than in the test suite: a test
// has no idea what a change consists of.

import { execFileSync } from 'node:child_process';

const GOVERNING = [
  /^docs\/saas-requirements\.md$/,
  /^docs\/specs\/.+\.md$/,
  /^docs\/plans\/contracts\/.+\.md$/,
  /^docs\/plans\/m1-plan\.json$/,
];
const TRACE = 'docs/plans/change-log.md';

const base = process.argv[2] || 'origin/master';
let changed;
try {
  changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean);
} catch (err) {
  console.error(`could not diff against ${base}: ${err.message}`);
  process.exit(2);
}

const governing = changed.filter((f) => GOVERNING.some((re) => re.test(f)));
if (governing.length === 0) {
  console.log('no governing artifact changed — nothing to trace');
  process.exit(0);
}

if (changed.includes(TRACE)) {
  console.log(`traced: ${governing.length} governing artifact(s) changed, and ${TRACE} was updated`);
  process.exit(0);
}

console.error(`
These governing artifacts changed:

${governing.map((f) => `  ${f}`).join('\n')}

but ${TRACE} did not.

Every omission this repository has had was a document moving while its dependants
did not. Add a row to the change trace saying which artifacts this touched — and,
just as importantly, which it deliberately did not.

If this change genuinely touches nothing else, say so there. "n/a" is a finding.
`.trim());
process.exit(1);
