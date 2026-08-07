import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';

// #19 — nothing in src/ reads or writes ~/.claude/settings.json today, so this
// is new capability rather than a change to existing behaviour.
//
// Two locations are required, and that is measured rather than assumed: with
// the shell export and user-scope settings both in place, 9 of 9 observed paths
// were captured (F14). Project scope is not a weaker option but a silent hole —
// a background agent configured that way ran to completion having reached the
// upstream directly, and nothing surfaced an error (F16).
//
// Every path here is a fixture. Writing to a real ~/.claude/settings.json
// during a test run has already broken a live session once.

const {
  enrol, unenrol, mergeSettingsEnv, unmergeSettingsEnv, settingsEnvFromLines, MANAGED_KEYS, MARKER,
} = await import('../src/enrol.js');
const { buildClaudeEnvLines } = await import('../src/claude-env.js');
const { createCsr } = await import('../src/x509.js');

// The settings file on the machine this was written on: seven unrelated keys,
// no env block. An empty object would not exercise FR-03.3 at all.
const FIXTURE = `{
  "model": "opusplan",
  "autoUpdatesChannel": "stable",
  "tui": { "compact": true },
  "skipDangerousModePermissionPrompt": true,
  "theme": "dark",
  "autoCompactEnabled": true,
  "agentPushNotifEnabled": false
}
`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'tc-enrol-'));
  return {
    dir,
    settings: join(dir, 'settings.json'),
    rc: join(dir, '.bashrc'),
    artifacts: join(dir, 'artifacts'),
    drop: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const OPTS = (s) => ({
  proxyUrl: 'https://proxy.example:8443',
  settingsPath: s.settings,
  rcPath: s.rc,
  artifactDir: s.artifacts,
});

// ── mergeSettingsEnv — the two properties that break silently ────────────────

test('FR-03.3 — every unrelated key survives, and the file is not rewritten wholesale', () => {
  const out = mergeSettingsEnv(FIXTURE, { HTTPS_PROXY: 'https://p:8443' });
  for (const k of ['model', 'autoUpdatesChannel', 'tui', 'skipDangerousModePermissionPrompt',
    'theme', 'autoCompactEnabled', 'agentPushNotifEnabled']) {
    assert.ok(out.includes(`"${k}"`), `${k} was lost`);
  }
  assert.ok(out.includes('"opusplan"') && out.includes('"compact": true'),
    'values were not preserved verbatim');
  assert.equal(JSON.parse(out).env.HTTPS_PROXY, 'https://p:8443');
});

test('FR-03.3, ASM-18 — comments are still there afterwards', () => {
  // JSON.parse followed by stringify drops these silently, which is the worst
  // shape a data-loss bug takes. Measured: the client accepts them.
  const withComments = `{
  // the model I actually want
  "model": "opusplan",
  /* block comments too */
  "theme": "dark"
}
`;
  const out = mergeSettingsEnv(withComments, { HTTPS_PROXY: 'https://p:8443' });
  assert.ok(out.includes('// the model I actually want'), 'line comment dropped');
  assert.ok(out.includes('/* block comments too */'), 'block comment dropped');
  assert.ok(/"HTTPS_PROXY"/.test(out));
});

test('FR-03.3 — an existing env block is merged into, not replaced', () => {
  const existing = `{
  "env": {
    "SOMETHING_ELSE": "keep me",
    "HTTPS_PROXY": "http://old:1"
  },
  "theme": "dark"
}
`;
  const out = mergeSettingsEnv(existing, { HTTPS_PROXY: 'https://new:8443', NO_PROXY: 'localhost' });
  const env = JSON.parse(out).env;
  assert.equal(env.SOMETHING_ELSE, 'keep me', 'an unrelated env key was dropped');
  assert.equal(env.HTTPS_PROXY, 'https://new:8443', 'the existing key was not updated');
  assert.equal(env.NO_PROXY, 'localhost', 'the new key was not added');
  assert.equal(JSON.parse(out).theme, 'dark');
});

test('FR-03.4 — merging is idempotent to the byte', () => {
  const env = { HTTPS_PROXY: 'https://p:8443', NO_PROXY: 'localhost,127.0.0.1,::1' };
  const once = mergeSettingsEnv(FIXTURE, env);
  assert.equal(mergeSettingsEnv(once, env), once, 'a second merge changed the bytes');
});

test('merging into an empty or absent file produces a valid document', () => {
  for (const start of ['', '   \n', '{}', '{\n}\n']) {
    const out = mergeSettingsEnv(start, { HTTPS_PROXY: 'https://p:8443' });
    assert.equal(JSON.parse(out).env.HTTPS_PROXY, 'https://p:8443', `from ${JSON.stringify(start)}`);
    assert.equal(mergeSettingsEnv(out, { HTTPS_PROXY: 'https://p:8443' }), out, 'not idempotent');
  }
});

test('a brace or a quote inside a string value does not confuse the scan', () => {
  const tricky = `{
  "note": "a } and a \\" and a // and a /* here",
  "theme": "dark"
}
`;
  const out = mergeSettingsEnv(tricky, { HTTPS_PROXY: 'https://p:8443' });
  assert.equal(JSON.parse(out).note, 'a } and a " and a // and a /* here');
  assert.equal(JSON.parse(out).env.HTTPS_PROXY, 'https://p:8443');
});

test('unmergeSettingsEnv takes back exactly what merge added', () => {
  const env = { HTTPS_PROXY: 'https://p:8443', NO_PROXY: 'localhost' };
  const merged = mergeSettingsEnv(FIXTURE, env);
  assert.notEqual(merged, FIXTURE, 'the merge did nothing, so the inverse proves nothing');
  assert.equal(unmergeSettingsEnv(merged, Object.keys(env)), FIXTURE,
    'unmerge did not restore the pre-enrolment bytes');
});

test('a brace inside a string inside a nested object does not close it early', () => {
  // The earlier case put the awkward string at the top level, where the scan
  // returns before it ever counts a brace. Only a nested object reaches the
  // depth counter, which is where miscounting would silently truncate the
  // document — the mutation that removed string-skipping survived without this.
  const nested = `{
  "tui": { "note": "} this does not close anything", "compact": true },
  "theme": "dark"
}
`;
  const out = mergeSettingsEnv(nested, { HTTPS_PROXY: 'https://p:8443' });
  const o = JSON.parse(out);
  assert.equal(o.tui.note, '} this does not close anything');
  assert.equal(o.tui.compact, true);
  assert.equal(o.theme, 'dark');
  assert.equal(o.env.HTTPS_PROXY, 'https://p:8443');
});

test('removing a key that is not the last one leaves valid JSON behind', () => {
  // Taking the comma *after* a middle member is what keeps the document valid;
  // taking the one before it would leave `{,`. Every earlier case removed a
  // trailing member, which goes down the other branch entirely.
  const existing = `{
  "env": {
    "HTTPS_PROXY": "https://p:8443",
    "SOMETHING_ELSE": "keep me",
    "NO_PROXY": "localhost"
  },
  "theme": "dark"
}
`;
  const out = unmergeSettingsEnv(existing, ['HTTPS_PROXY', 'NO_PROXY']);
  const o = JSON.parse(out); // throws on a stray or missing comma
  assert.deepEqual(o.env, { SOMETHING_ELSE: 'keep me' });
  assert.equal(o.theme, 'dark');
  assert.ok(!/,\s*[,}]/.test(out), `a stray comma was left: ${JSON.stringify(out)}`);
});

test('unmergeSettingsEnv leaves an env block that was not empty', () => {
  const existing = `{
  "env": { "SOMETHING_ELSE": "keep me" },
  "theme": "dark"
}
`;
  const out = unmergeSettingsEnv(mergeSettingsEnv(existing, { HTTPS_PROXY: 'x' }), ['HTTPS_PROXY']);
  assert.equal(JSON.parse(out).env.SOMETHING_ELSE, 'keep me');
  assert.equal(JSON.parse(out).env.HTTPS_PROXY, undefined);
});

// ── the two locations agree because one is derived from the other ───────────

test('FR-03.1, FR-03.2 — the settings env is the shell export, parsed', () => {
  const lines = buildClaudeEnvLines({ port: 8443, host: 'proxy.example', scheme: 'https', caPath: '/ca.pem' });
  const env = settingsEnvFromLines(lines);
  assert.equal(env.HTTPS_PROXY, 'https://proxy.example:8443');
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/ca.pem');
  assert.ok(!('ANTHROPIC_BASE_URL' in env), 'an `unset` line became a setting');
  for (const l of lines) if (l.startsWith('export ')) {
    const [, k] = l.match(/^export ([A-Za-z_][A-Za-z0-9_]*)=/);
    assert.ok(k in env, `${k} is exported for the shell but missing from settings`);
  }
});

test('buildClaudeEnvLines still defaults to loopback http', () => {
  const lines = buildClaudeEnvLines({ port: 3456 });
  assert.ok(lines.includes('export HTTPS_PROXY=http://127.0.0.1:3456'),
    'the existing local behaviour changed');
});

// ── enrol / unenrol on a filesystem ─────────────────────────────────────────

test('FR-03.1 — enrolment writes the user-scope path it was given, and nothing else', async () => {
  const s = sandbox();
  try {
    writeFileSync(s.settings, FIXTURE);
    await enrol(OPTS(s));
    const env = JSON.parse(readFileSync(s.settings, 'utf8')).env;
    assert.equal(env.HTTPS_PROXY, 'https://proxy.example:8443');
    assert.ok(!existsSync(join(s.dir, '.claude')), 'a project-scope file was created');
  } finally { s.drop(); }
});

test('FR-03.2 — the shell export lands in the rc file under a marker', async () => {
  const s = sandbox();
  try {
    writeFileSync(s.rc, '# my own rc\nexport EDITOR=vim\n');
    await enrol(OPTS(s));
    const rc = readFileSync(s.rc, 'utf8');
    assert.ok(rc.includes('export EDITOR=vim'), 'the existing rc was clobbered');
    assert.ok(rc.includes(MARKER), 'nothing marks the block for removal');
    assert.ok(rc.includes('export HTTPS_PROXY=https://proxy.example:8443'));
  } finally { s.drop(); }
});

test('FR-03.4 — enrolling twice leaves both files byte-identical', async () => {
  const s = sandbox();
  try {
    writeFileSync(s.settings, FIXTURE);
    writeFileSync(s.rc, '# my own rc\n');
    await enrol(OPTS(s));
    const after1 = [readFileSync(s.settings, 'utf8'), readFileSync(s.rc, 'utf8')];
    await enrol(OPTS(s));
    assert.deepEqual([readFileSync(s.settings, 'utf8'), readFileSync(s.rc, 'utf8')], after1);
  } finally { s.drop(); }
});

test('FR-03.5 — unenrol restores the pre-enrolment bytes and removes the artifacts', async () => {
  const s = sandbox();
  try {
    writeFileSync(s.settings, FIXTURE);
    const rcBefore = '# my own rc\nexport EDITOR=vim\n';
    writeFileSync(s.rc, rcBefore);
    await enrol(OPTS(s));
    assert.ok(existsSync(join(s.artifacts, 'device.key')), 'nothing was placed to remove');

    await unenrol(OPTS(s));
    assert.equal(readFileSync(s.settings, 'utf8'), FIXTURE, 'settings.json was not restored');
    assert.equal(readFileSync(s.rc, 'utf8'), rcBefore, 'the rc file was not restored');
    assert.ok(!existsSync(join(s.artifacts, 'device.key')), 'the private key was left behind');
  } finally { s.drop(); }
});

test('unenrol on a machine that was never enrolled changes nothing', async () => {
  const s = sandbox();
  try {
    writeFileSync(s.settings, FIXTURE);
    await unenrol(OPTS(s));
    assert.equal(readFileSync(s.settings, 'utf8'), FIXTURE);
  } finally { s.drop(); }
});

// ── FR-16 — the artifacts ───────────────────────────────────────────────────

test('FR-16.1 — the private key is written owner-readable only', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX modes are not meaningful here');
  const s = sandbox();
  try {
    await enrol(OPTS(s));
    assert.equal(statSync(join(s.artifacts, 'device.key')).mode & 0o777, 0o600);
    assert.equal(statSync(join(s.artifacts, 'tenant-ca.pem')).mode & 0o777, 0o644);
  } finally { s.drop(); }
});

test('FR-16.1 — every artifact the settings file points at is actually placed', async () => {
  const s = sandbox();
  try {
    await enrol(OPTS(s));
    const env = JSON.parse(readFileSync(s.settings, 'utf8')).env;
    for (const k of ['NODE_EXTRA_CA_CERTS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY']) {
      assert.ok(env[k], `${k} is not configured`);
      assert.ok(existsSync(env[k]), `${k} points at ${env[k]}, which does not exist`);
    }
  } finally { s.drop(); }
});

test('FR-16.3 — the device key is generated here; only the CSR is handed over', async () => {
  const s = sandbox();
  const seen = [];
  try {
    await enrol({
      ...OPTS(s),
      // Stands in for whatever signs it. What it receives is the whole point.
      signCsr: async (csrPem) => {
        seen.push(csrPem);
        const { createCA, createLeaf } = await import('../src/x509.js');
        return createLeaf(['device'], createCA('Signing CA')).certPem;
      },
    });
    assert.equal(seen.length, 1, 'nothing was sent to be signed');
    assert.match(seen[0], /^-----BEGIN CERTIFICATE REQUEST-----/, 'that is not a CSR');
    assert.doesNotMatch(seen[0], /PRIVATE KEY/, 'the private key left the device');

    const key = readFileSync(join(s.artifacts, 'device.key'), 'utf8');
    assert.match(key, /BEGIN PRIVATE KEY/);
    assert.ok(!seen[0].includes(key.trim()), 'the key was embedded in what was sent');
    assert.ok(new X509Certificate(readFileSync(join(s.artifacts, 'device.crt'), 'utf8')),
      'the signed certificate was not placed');
  } finally { s.drop(); }
});

test('createCsr produces a request that carries the public key and verifies', () => {
  const { keyPem, csrPem, publicKey } = createCsr('device-abc');
  assert.match(csrPem, /^-----BEGIN CERTIFICATE REQUEST-----/);
  assert.match(keyPem, /BEGIN PRIVATE KEY/);
  // A CSR whose signature does not check out is not a CSR anybody will sign.
  const der = Buffer.from(csrPem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  assert.ok(der.length > 200, 'suspiciously small for a 2048-bit request');
  assert.ok(publicKey, 'the caller cannot check what was requested');
});

test('MANAGED_KEYS is exactly what enrolment writes, so unenrol removes exactly that', async () => {
  const s = sandbox();
  try {
    writeFileSync(s.settings, FIXTURE);
    await enrol(OPTS(s));
    const written = Object.keys(JSON.parse(readFileSync(s.settings, 'utf8')).env);
    assert.deepEqual(written.slice().sort(), MANAGED_KEYS.slice().sort(),
      'a key is written that unenrol does not know to remove, or the reverse');
  } finally { s.drop(); }
});
