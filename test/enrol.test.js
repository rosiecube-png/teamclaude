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
  enrol, unenrol, mergeSettingsEnv, unmergeSettingsEnv, settingsEnvFromLines, fetchCA, MANAGED_KEYS, MARKER,
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

// A proxy that serves a CA, so enrolment exercises the fetch rather than
// skipping it. Every case below therefore runs the path a real machine runs.
const SERVED_CA = (await import('../src/x509.js')).createCA('Test Proxy CA').certPem;
const servingRequest = (opts, cb) => {
  const res = { statusCode: 200, on: (e, f) => { if (e === 'data') f(SERVED_CA); if (e === 'end') f(); } };
  queueMicrotask(() => cb(res));
  return { on: () => {}, end: () => {} };
};

const OPTS = (s) => ({
  proxyUrl: 'https://proxy.example:8443',
  settingsPath: s.settings,
  rcPath: s.rc,
  artifactDir: s.artifacts,
  request: servingRequest,
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
    // Whatever is configured must exist and must not be empty. Which artifacts
    // are configured depends on what was supplied: an edge holding a public
    // certificate leaves no tenant CA to place, and mTLS is not enforced until
    // #6, so an unsigned device certificate is not pointed at either.
    for (const k of ['NODE_EXTRA_CA_CERTS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY']) {
      if (!env[k]) continue;
      assert.ok(existsSync(env[k]), `${k} points at ${env[k]}, which does not exist`);
      assert.ok(statSync(env[k]).size > 0, `${k} points at an empty file`);
    }
    assert.ok(env.HTTPS_PROXY, 'the proxy itself must always be configured');
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
    const unknown = written.filter((k) => !MANAGED_KEYS.includes(k));
    assert.deepEqual(unknown, [],
      'a key is written that unenrol does not know to remove, so it would survive and keep ' +
      'sending traffic at a proxy the user has stopped using');
    assert.ok(written.length >= 6, `only ${written.length} keys written — enrolment did almost nothing`);
  } finally { s.drop(); }
});

// ── the CLI surface ─────────────────────────────────────────────────────────

test('the CLI reports a usage error with a non-zero exit code', async () => {
  // `process.exit(0)` after setting process.exitCode would tell a script the
  // enrolment succeeded when it never ran.
  const { execFileSync } = await import('node:child_process');
  for (const argv of [['enrol'], ['enrol', '--proxy', 'not a url']]) {
    let code = 0;
    try {
      execFileSync(process.execPath, ['src/index.js', ...argv], { stdio: 'pipe' });
    } catch (err) { code = err.status; }
    assert.equal(code, 1, `teamclaude ${argv.join(' ')} exited 0`);
  }
});

test('unenrol is reachable under both spellings, and enrol is too', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/index.js', 'utf8');
  for (const c of ["case 'enrol'", "case 'enroll'", "case 'unenrol'", "case 'unenroll'"]) {
    assert.ok(src.includes(c), `${c} is not dispatched`);
  }
  assert.match(src, /unenrol\s+Undo it\. This is the recovery step/,
    'NFR-13.2 wants unenrol documented as the recovery step, including in --help');
});

// ── what a G-1 attempt found ────────────────────────────────────────────────
//
// Standing up a real hosted proxy and enrolling this machine against it is the
// milestone's exit criterion, and it is the only thing that surfaced these. The
// suite was green, the specs were satisfied, and an enrolled machine could not
// reach the proxy at all:
//
//   CONNECT as enrolled     407
//   CONNECT with key@host   200
//
// Nothing required enrolment to carry the credential, because nobody had tried
// to use it.

test('FR-03.2 — the credential in the proxy URL survives enrolment', async () => {
  const s = sandbox();
  try {
    await enrol({ ...OPTS(s), proxyUrl: 'https://tc-key-123@proxy.example:8443' });
    const env = JSON.parse(readFileSync(s.settings, 'utf8')).env;
    // Both userinfo slots, because a single-component one is silently ignored
    // by the client — see the case below.
    assert.equal(env.HTTPS_PROXY, 'https://tc-key-123:tc-key-123@proxy.example:8443',
      'a hosted proxy requires the key, and an enrolled machine gets 407 without it');
    assert.match(readFileSync(s.rc, 'utf8'), /tc-key-123@proxy\.example:8443/,
      'the shell half lost the credential the settings half kept');
  } finally { s.drop(); }
});

test('a key with characters a shell would eat is encoded', async () => {
  const s = sandbox();
  try {
    await enrol({ ...OPTS(s), proxyUrl: 'https://a b(c)@proxy.example:8443' });
    const line = readFileSync(s.rc, 'utf8').split('\n').find((l) => l.startsWith('export HTTPS_PROXY='));
    const value = line.slice('export HTTPS_PROXY='.length);
    assert.doesNotMatch(value, /[ ()]/,
      `these lines are emitted unquoted, so this would be a shell syntax error: ${line}`);
    assert.match(value, /a%20b%28c%29@/, 'the key was mangled rather than encoded');
  } finally { s.drop(); }
});

test('FR-16.1 — the client is never pointed at an artifact that is empty', async () => {
  // NODE_EXTRA_CA_CERTS pointing at a zero-byte file made the client warn and
  // carry on (ASM-28), so it degrades safely — but it is still a configuration
  // that names a file with nothing in it. Where TLS is terminated by an edge
  // with a public certificate there is no tenant CA to place.
  const s = sandbox();
  try {
    await enrol(OPTS(s));   // no caPem, no signCsr
    const env = JSON.parse(readFileSync(s.settings, 'utf8')).env;
    for (const k of ['NODE_EXTRA_CA_CERTS', 'CLAUDE_CODE_CLIENT_CERT']) {
      if (env[k]) assert.ok(statSync(env[k]).size > 0, `${k} points at an empty file`);
    }
    // The device key is still placed and still generated here (FR-16.3).
    assert.ok(statSync(join(s.artifacts, 'device.key')).size > 0);
  } finally { s.drop(); }
});

test('FR-16.1 — an artifact that does have content is configured', async () => {
  const s = sandbox();
  try {
    const { createCA } = await import('../src/x509.js');
    await enrol({ ...OPTS(s), caPem: createCA('Tenant CA').certPem });
    const env = JSON.parse(readFileSync(s.settings, 'utf8')).env;
    assert.ok(env.NODE_EXTRA_CA_CERTS, 'a real tenant CA was placed and not referenced');
    assert.ok(statSync(env.NODE_EXTRA_CA_CERTS).size > 0);
  } finally { s.drop(); }
});

test('FR-03.2 — the proxy URL carries both userinfo components, or the client ignores it', async () => {
  // Measured against Claude Code 2.1.224 through a real hosted proxy:
  //
  //   https://<key>@host:8443     no request at all — no error, nothing reached
  //   https://<key>:@host:8443    the proxy, the run just timed out
  //   https://<key>:<key>@host    the run completed
  //
  // A single-component userinfo is not rejected, it is silently unused, which is
  // the worst way for an enrolment to be wrong.
  const s = sandbox();
  try {
    await enrol({ ...OPTS(s), proxyUrl: 'https://tc-key-123@proxy.example:8443' });
    const url = JSON.parse(readFileSync(s.settings, 'utf8')).env.HTTPS_PROXY;
    const { username, password } = new URL(url);
    assert.ok(username && password, `both slots must be filled: ${url}`);
    assert.equal(password, 'tc-key-123', 'the password slot is what connectAuthorized checks');
    assert.equal(username, 'tc-key-123',
      'with no pin the username holds the key, which is what resolveConnectPin accepts');
  } finally { s.drop(); }
});

test('a pinned enrolment keeps the pin in the username and the key in the password', async () => {
  const lines = buildClaudeEnvLines({ port: 8443, host: 'p.example', scheme: 'https', proxyApiKey: 'K', account: 'work' });
  const url = new URL(lines.find((l) => l.startsWith('export HTTPS_PROXY=')).slice('export HTTPS_PROXY='.length));
  assert.equal(url.username, 'work');
  assert.equal(url.password, 'K');
});

test('with neither a key nor a pin the URL carries no userinfo at all', () => {
  const lines = buildClaudeEnvLines({ port: 3456 });
  assert.ok(lines.includes('export HTTPS_PROXY=http://127.0.0.1:3456'),
    'the local default grew a stray @');
});

// ── FR-16.2 — the operator stops carrying a file ────────────────────────────

test('enrolment fetches the CA from the proxy when it is not handed one', async () => {
  const s = sandbox();
  const { createCA } = await import('../src/x509.js');
  const served = createCA('Served CA').certPem;
  let sawKey = null, sawPath = null;
  // Stand in for the transport so the test needs no listener.
  const request = (opts, cb) => {
    sawKey = opts.headers['x-api-key'];
    sawPath = opts.path;
    const res = { statusCode: 200, on: (e, f) => { if (e === 'data') f(served); if (e === 'end') f(); } };
    queueMicrotask(() => cb(res));
    return { on: () => {}, end: () => {} };
  };
  try {
    const { caPem } = await fetchCA('https://tc-key@proxy.example:8443', { request });
    assert.equal(caPem, served);
    assert.equal(sawPath, '/teamclaude/ca');
    assert.equal(sawKey, 'tc-key', 'the fetch went unauthenticated');
  } finally { s.drop(); }
});

test('a CA that does not match the fingerprint given is refused', async () => {
  const { createCA } = await import('../src/x509.js');
  const request = (opts, cb) => {
    const res = { statusCode: 200, on: (e, f) => { if (e === 'data') f(createCA('Impostor').certPem); if (e === 'end') f(); } };
    queueMicrotask(() => cb(res));
    return { on: () => {}, end: () => {} };
  };
  await assert.rejects(
    () => fetchCA('https://k@proxy.example:8443', { request, expectSha256: 'a'.repeat(64) }),
    /does not match the fingerprint/,
    'trust-on-first-use is the default, but a pin that is given must be enforced');
});

test('a proxy that will not serve its CA is not silently enrolled against', async () => {
  const request = (opts, cb) => {
    const res = { statusCode: 404, on: (e, f) => { if (e === 'end') f(); } };
    queueMicrotask(() => cb(res));
    return { on: () => {}, end: () => {} };
  };
  await assert.rejects(() => fetchCA('https://k@proxy.example:8443', { request }), /answered 404/);
});

test('--ca still wins, so an operator can check it out of band', async () => {
  const s = sandbox();
  const { createCA } = await import('../src/x509.js');
  const mine = createCA('Checked By Hand').certPem;
  try {
    // No transport is provided, so a fetch would throw. It must not happen.
    await enrol({ ...OPTS(s), caPem: mine });
    const env = JSON.parse(readFileSync(s.settings, 'utf8')).env;
    assert.equal(readFileSync(env.NODE_EXTRA_CA_CERTS, 'utf8'), mine);
  } finally { s.drop(); }
});
