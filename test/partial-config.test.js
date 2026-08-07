import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// FR-18.1 — a machine configured through only one of the two locations leaks
// traffic silently and still appears to work, which is ASM-13's risk.
//
// The requirement was written around a proxy-side signal: F05's pre-settings
// request, which only arrives when the shell export is present, so a session
// whose first contact came later was settings-only. **That does not hold.** Two
// controlled runs on client 2.1.224 — one shell-export only, one project-scope
// settings.json only, with the activity filter off so nothing was hidden —
// produced identical request sequences at the proxy, and neither contained a
// single /api/eval or /api/event_logging request:
//
//   shell     GET /mcp-registry/v0/servers…  POST /v1/messages?beta=true  …
//   settings  GET /mcp-registry/v0/servers…  POST /v1/messages?beta=true  …
//
// So the check runs where both locations can be read, which also covers the
// case the spec called harder and most important: settings missing, so
// background agents never reach the proxy at all and produce no signal there by
// definition.

const { checkEnrolment, enrol, MANAGED_KEYS, MARKER } = await import('../src/enrol.js');

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'tc-partial-'));
  return {
    dir,
    opts: {
      settingsPath: join(dir, 'settings.json'),
      rcPath: join(dir, '.bashrc'),
      artifactDir: join(dir, 'artifacts'),
    },
    drop: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const PROXY = 'https://proxy.example:8443';

test('FR-18.1 — a fully enrolled machine reports no problem', async () => {
  const s = sandbox();
  try {
    await enrol({ proxyUrl: PROXY, ...s.opts });
    const r = await checkEnrolment(s.opts);
    assert.deepEqual(r.problems, [], 'a correct enrolment was reported as broken');
    assert.equal(r.complete, true);
    assert.deepEqual(r.settings.keys.slice().sort(), MANAGED_KEYS.slice().sort());
    assert.equal(r.shell.present, true);
  } finally { s.drop(); }
});

test('FR-18.1 — settings gone, shell present: named, with the consequence', async () => {
  // The case that matters most and that the proxy provably cannot see: a
  // background agent reads settings.json and nothing else, so its traffic never
  // arrives to be counted.
  const s = sandbox();
  try {
    await enrol({ proxyUrl: PROXY, ...s.opts });
    writeFileSync(s.opts.settingsPath, '{ "theme": "dark" }\n');
    const r = await checkEnrolment(s.opts);
    assert.equal(r.complete, false);
    assert.equal(r.shell.present, true, 'the half that is still there was not seen');
    assert.equal(r.settings.present, false);
    assert.match(r.problems.join('\n'), /settings\.json/);
    assert.match(r.problems.join('\n'), /background agent/i,
      'the report does not say what is actually at stake');
    assert.match(r.problems.join('\n'), /teamclaude enrol/, 'no step to take');
  } finally { s.drop(); }
});

test('FR-18.1 — shell gone, settings present: named too', async () => {
  const s = sandbox();
  try {
    await enrol({ proxyUrl: PROXY, ...s.opts });
    writeFileSync(s.opts.rcPath, '# my own rc\n');
    const r = await checkEnrolment(s.opts);
    assert.equal(r.complete, false);
    assert.equal(r.settings.present, true);
    assert.equal(r.shell.present, false);
    assert.match(r.problems.join('\n'), /before settings are read/,
      'the report does not say which window is uncovered');
  } finally { s.drop(); }
});

test('a half-written settings env is a problem, not a pass', async () => {
  const s = sandbox();
  try {
    await enrol({ proxyUrl: PROXY, ...s.opts });
    writeFileSync(s.opts.settingsPath, JSON.stringify({ env: { HTTPS_PROXY: PROXY } }, null, 2));
    const r = await checkEnrolment(s.opts);
    assert.equal(r.complete, false);
    assert.match(r.problems.join('\n'), /missing .*NODE_EXTRA_CA_CERTS/);
  } finally { s.drop(); }
});

test('an artifact the settings point at but that is gone is reported', async () => {
  const s = sandbox();
  try {
    await enrol({ proxyUrl: PROXY, ...s.opts });
    rmSync(join(s.opts.artifactDir, 'device.key'));
    const r = await checkEnrolment(s.opts);
    assert.equal(r.complete, false);
    assert.match(r.problems.join('\n'), /device\.key/);
  } finally { s.drop(); }
});

test('a settings.json with comments is read, not rejected', async () => {
  // Reading strips comments; merging never does, which is why they survive a
  // write. A check that threw here would report a correct machine as broken.
  const s = sandbox();
  try {
    mkdirSync(s.opts.artifactDir, { recursive: true });
    await enrol({ proxyUrl: PROXY, ...s.opts });
    const withComments = `{\n  // mine\n  "theme": "dark",\n  "env": {\n` +
      MANAGED_KEYS.map((k) => `    ${JSON.stringify(k)}: "x"`).join(',\n') + '\n  }\n}\n';
    writeFileSync(s.opts.settingsPath, withComments);
    const r = await checkEnrolment(s.opts);
    assert.equal(r.settings.present, true, 'the comment made the env block unreadable');
    assert.deepEqual(r.problems, []);
  } finally { s.drop(); }
});

test('a // inside a string value is not treated as a comment', async () => {
  const s = sandbox();
  try {
    await enrol({ proxyUrl: PROXY, ...s.opts });
    const env = Object.fromEntries(MANAGED_KEYS.map((k) => [k, 'https://proxy.example:8443']));
    writeFileSync(s.opts.settingsPath, JSON.stringify({ env }, null, 2));
    const r = await checkEnrolment(s.opts);
    assert.equal(r.settings.present, true, 'the // in a URL truncated the document');
    assert.deepEqual(r.settings.keys.slice().sort(), MANAGED_KEYS.slice().sort());
  } finally { s.drop(); }
});

test('an unenrolled machine is reported as unenrolled, not as an error', async () => {
  const s = sandbox();
  try {
    const r = await checkEnrolment(s.opts);
    assert.equal(r.complete, false);
    assert.equal(r.problems.length >= 2, true, 'both locations are missing and only one was named');
    assert.ok(!r.shell.present && !r.settings.present);
  } finally { s.drop(); }
});

test('the marker the check looks for is the one enrolment writes', async () => {
  const s = sandbox();
  try {
    await enrol({ proxyUrl: PROXY, ...s.opts });
    const { readFileSync } = await import('node:fs');
    assert.ok(readFileSync(s.opts.rcPath, 'utf8').includes(MARKER),
      'the check and the writer would drift apart silently');
  } finally { s.drop(); }
});
