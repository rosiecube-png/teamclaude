// Client enrolment (#19): point a machine at a hosted proxy, and be able to
// point it back.
//
// Two locations, both required, and that is measured rather than assumed. With
// the shell export and user-scope `settings.json` both in place, 9 of 9
// observed request paths were captured (F14). Project scope is not a weaker
// option but a silent hole: a background agent configured that way ran to
// completion having reached the upstream directly, and nothing surfaced an
// error (F16). One request — `POST /api/eval/*` — leaves before settings are
// read at all, so only the shell export catches it (F05).
//
// This module owns the filesystem. `claude-env.js` stays pure and keeps
// building the env lines, the way `alias.js` owns writing to a shell rc while
// nothing else does (S3). Every path is a parameter with a default: writing to
// a real ~/.claude/settings.json during a test run has already broken a live
// session once.

import { readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildClaudeEnvLines } from './claude-env.js';
import { createCsr } from './x509.js';

/** Marks the block enrolment owns in a shell rc, so removal is exact. */
export const MARKER = '# teamclaude enrolment (managed — teamclaude unenrol removes this)';

/** Where the artifacts live by default. Referenced from both config sites. */
export const artifactDirDefault = () => join(homedir(), '.teamclaude');
export const settingsPathDefault = () => join(homedir(), '.claude', 'settings.json');

// Exactly the keys enrolment writes, so `unenrol` removes exactly those. A test
// asserts the two agree; a key written but not listed here would survive an
// unenrol and keep sending traffic at a proxy the user has stopped using.
export const MANAGED_KEYS = [
  'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy',
  'NO_PROXY', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
];

// ── settings.json, edited as text ───────────────────────────────────────────
//
// Not parsed and re-serialised. A `settings.json` carrying a `//` comment was
// accepted by the client and the session ran normally (ASM-18, measured), so
// users may reasonably have them — and `JSON.parse` followed by `stringify`
// drops every comment silently, which is the worst shape a data-loss bug takes.
// The file also holds the user's own settings (`model`, `theme`, and so on);
// losing those to enrolment would be a poor trade for a proxy.
//
// So the document is scanned, not parsed, and only the spans that have to
// change are rewritten.

/** Advance past whitespace and both comment forms. */
function skipTrivia(t, i) {
  for (;;) {
    while (i < t.length && /\s/.test(t[i])) i++;
    if (t[i] === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (t[i] === '/' && t[i + 1] === '*') {
      i += 2;
      while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++;
      i += 2; continue;
    }
    return i;
  }
}

/** End index just past the closing quote of the string starting at `i`. */
function endOfString(t, i) {
  i++; // opening quote
  while (i < t.length) {
    if (t[i] === '\\') { i += 2; continue; }
    if (t[i] === '"') return i + 1;
    i++;
  }
  return i;
}

/**
 * End index just past the value starting at `i`.
 *
 * Depth counting alone is wrong: a brace inside a string, or inside a comment,
 * would close a block that never opened. Strings and comments are skipped as
 * units for exactly that reason.
 */
function endOfValue(t, i) {
  i = skipTrivia(t, i);
  if (t[i] === '"') return endOfString(t, i);
  if (t[i] === '{' || t[i] === '[') {
    const close = t[i] === '{' ? '}' : ']';
    let depth = 0;
    while (i < t.length) {
      i = skipTrivia(t, i);
      const c = t[i];
      if (c === '"') { i = endOfString(t, i); continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    return i;
  }
  while (i < t.length && !/[,}\]\s]/.test(t[i])) i++;
  return i;
}

/** Members of the object whose `{` is at `open`, with the spans of each. */
function membersOf(t, open) {
  const out = [];
  let i = open + 1;
  for (;;) {
    i = skipTrivia(t, i);
    if (i >= t.length || t[i] === '}') return { members: out, close: i };
    if (t[i] === ',') { i++; continue; }
    if (t[i] !== '"') { i++; continue; } // not a member start; keep looking
    const keyStart = i;
    const keyEnd = endOfString(t, i);
    const key = JSON.parse(t.slice(keyStart, keyEnd));
    let j = skipTrivia(t, keyEnd);
    if (t[j] !== ':') { i = keyEnd; continue; }
    const valueStart = skipTrivia(t, j + 1);
    const valueEnd = endOfValue(t, valueStart);
    out.push({ key, keyStart, valueStart, valueEnd });
    i = valueEnd;
  }
}

/** Index of the document's top-level `{`, or -1. */
const topOpen = (t) => (t && t[skipTrivia(t, 0)] === '{' ? skipTrivia(t, 0) : -1);

/** The indent of the line `at` sits on. */
function indentAt(t, at) {
  const lineStart = t.lastIndexOf('\n', at - 1) + 1;
  return (t.slice(lineStart, at).match(/^[ \t]*/) || [''])[0];
}

/**
 * Set every key of `env` inside the document's `env` block, creating it if
 * absent, and leave everything else — including comments — exactly as it was.
 *
 * Idempotent by construction: a key already holding the target value is not
 * rewritten, so a second call with the same input returns the same bytes.
 */
export function mergeSettingsEnv(existing, env) {
  const text = existing || '';
  const open = topOpen(text);
  if (open < 0) {
    // No document to preserve, so formatting is ours to choose.
    return JSON.stringify({ env }, null, 2) + '\n';
  }

  const { members, close } = membersOf(text, open);
  const envMember = members.find((m) => m.key === 'env');
  if (!envMember || text[envMember.valueStart] !== '{') {
    // An `env` that is not an object is the user's, and overwriting it would be
    // the wholesale rewrite FR-03.3 forbids. Add ours beside it only when there
    // is nothing there at all.
    if (envMember) throw new Error('settings.json has an `env` that is not an object — refusing to overwrite it');
    const indent = members.length ? indentAt(text, members[0].keyStart) : '  ';
    const body = Object.entries(env)
      .map(([k, v]) => `${indent}${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    const block = `${indent}"env": {\n${body}\n${indent}}`;
    const sep = members.length ? ',\n' : '\n';
    const tail = text.slice(close);
    return text.slice(0, close).replace(/\s*$/, '') + sep + block + '\n' + tail;
  }

  // Rewrite in place, right to left, so earlier offsets stay valid.
  const inner = membersOf(text, envMember.valueStart);
  let out = text;
  const additions = [];
  for (const [k, v] of Object.entries(env)) {
    const hit = inner.members.find((m) => m.key === k);
    if (!hit) { additions.push([k, v]); continue; }
    if (out.slice(hit.valueStart, hit.valueEnd) === JSON.stringify(v)) continue;
    out = out.slice(0, hit.valueStart) + JSON.stringify(v) + out.slice(hit.valueEnd);
  }
  if (!additions.length) return out;

  // Offsets moved if anything was replaced above; find the block again.
  const open2 = topOpen(out);
  const env2 = membersOf(out, open2).members.find((m) => m.key === 'env');
  const inner2 = membersOf(out, env2.valueStart);
  const indent = inner2.members.length
    ? indentAt(out, inner2.members[0].keyStart)
    : indentAt(out, env2.keyStart) + '  ';
  const added = additions
    .map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  const sep = inner2.members.length ? ',\n' : '\n';
  const head = out.slice(0, inner2.close).replace(/\s*$/, '');
  const closeIndent = indentAt(out, env2.keyStart);
  return head + sep + added + '\n' + closeIndent + out.slice(inner2.close);
}

/**
 * Remove `keys` from the `env` block, and the block itself if that empties it.
 *
 * The inverse of a merge that added them: on a file enrolment had not touched,
 * it returns the same bytes.
 */
export function unmergeSettingsEnv(existing, keys) {
  const text = existing || '';
  const open = topOpen(text);
  if (open < 0) return text;
  const { members } = membersOf(text, open);
  const envMember = members.find((m) => m.key === 'env');
  if (!envMember || text[envMember.valueStart] !== '{') return text;

  const inner = membersOf(text, envMember.valueStart);
  const doomed = inner.members.filter((m) => keys.includes(m.key));
  if (!doomed.length) return text;

  if (doomed.length === inner.members.length) {
    // The block existed only for us. Take the whole member, and the separator
    // that joined it to its neighbour, so the bytes match what was there before.
    return cutMember(text, open, envMember);
  }
  let out = text;
  for (const m of doomed.slice().reverse()) out = cutMember(out, envMember.valueStart, m);
  return out;
}

/**
 * Excise one member of the object opening at `open`, taking the comma that
 * attached it. Which comma matters: removing a trailing member has to take the
 * one *before* it, or the document is left ending in `,}`.
 */
function cutMember(text, open, member) {
  const { members } = membersOf(text, open);
  const at = members.findIndex((m) => m.keyStart === member.keyStart);
  const isLast = at === members.length - 1;
  let from = member.keyStart;
  let to = member.valueEnd;
  if (isLast && at > 0) {
    // back up over whitespace and the preceding comma
    let i = members[at - 1].valueEnd;
    const j = skipTrivia(text, i);
    if (text[j] === ',') from = i;
  } else {
    const j = skipTrivia(text, to);
    if (text[j] === ',') to = j + 1;
  }
  // and the run of blank space the member sat on
  while (from > 0 && /[ \t]/.test(text[from - 1])) from--;
  if (text[from - 1] === '\n' && !isLast) from--;
  if (isLast) { while (to < text.length && /[ \t]/.test(text[to])) to++; }
  return text.slice(0, from) + text.slice(to);
}

// ── the two locations ───────────────────────────────────────────────────────

/**
 * The settings `env` object, derived from the shell lines rather than written
 * twice. FR-03 exists because the two locations cover different windows; if
 * they can disagree about *what* they set, that is a third failure mode.
 */
export function settingsEnvFromLines(lines) {
  const env = {};
  for (const line of lines) {
    const m = /^export ([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function rcBlock(lines) {
  return `${MARKER}\n${lines.join('\n')}\n`;
}

// ── enrol / unenrol ─────────────────────────────────────────────────────────

/**
 * Configure this machine for a hosted proxy, and place the artifacts.
 *
 * `signCsr` receives the certificate request and returns a signed certificate.
 * The private key is generated here and never passed to it (FR-16.3). For
 * self-hosting there may be nothing to call yet — mTLS is not enforced until
 * #6 — and the key and request are still placed so M2 does not redo this.
 */
export async function enrol({
  proxyUrl,
  settingsPath = settingsPathDefault(),
  rcPath = join(homedir(), '.bashrc'),
  artifactDir = artifactDirDefault(),
  caPem = null,
  signCsr = null,
  deviceName = 'teamclaude-device',
} = {}) {
  const url = new URL(proxyUrl);
  const caPath = join(artifactDir, 'tenant-ca.pem');
  const certPath = join(artifactDir, 'device.crt');
  const keyPath = join(artifactDir, 'device.key');

  await mkdir(artifactDir, { recursive: true });

  // FR-16.3 — the key is made here. Only the request can leave.
  const { keyPem, csrPem } = createCsr(deviceName);
  await writeFile(keyPath, keyPem, { mode: 0o600 });
  await chmod(keyPath, 0o600); // an existing file keeps its old mode otherwise
  await writeFile(join(artifactDir, 'device.csr'), csrPem, { mode: 0o644 });

  // FR-16.2 — for self-hosting the operator supplies the CA themselves. An
  // empty placeholder is still placed so the configuration never points at a
  // path that does not exist, which is indistinguishable from a typo.
  await writeFile(caPath, caPem ?? '', { mode: 0o644 });

  const certPem = signCsr ? await signCsr(csrPem) : '';
  await writeFile(certPath, certPem, { mode: 0o644 });

  const lines = buildClaudeEnvLines({
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    host: url.hostname,
    scheme: url.protocol.replace(':', ''),
    caPath, certPath, keyPath,
  });

  // FR-03.1 — user scope. Project scope captures the post-settings window and
  // silently misses background agents, which is worse than not configuring it.
  await mkdir(dirname(settingsPath), { recursive: true });
  const before = await readIf(settingsPath);
  await writeFile(settingsPath, mergeSettingsEnv(before, settingsEnvFromLines(lines)));

  // FR-03.2 — the shell export, covering the window before settings are read.
  await mkdir(dirname(rcPath), { recursive: true });
  const rc = (await readIf(rcPath)) || '';
  if (!rc.includes(MARKER)) {
    await writeFile(rcPath, (rc && !rc.endsWith('\n') ? rc + '\n' : rc) + rcBlock(lines));
  } else {
    await writeFile(rcPath, replaceBlock(rc, rcBlock(lines)));
  }

  return { caPath, certPath, keyPath, csrPem, settingsPath, rcPath };
}

/** Undo `enrol`, leaving the machine reaching the upstream directly (FR-03.5). */
export async function unenrol({
  settingsPath = settingsPathDefault(),
  rcPath = join(homedir(), '.bashrc'),
  artifactDir = artifactDirDefault(),
} = {}) {
  const before = await readIf(settingsPath);
  if (before !== null) await writeFile(settingsPath, unmergeSettingsEnv(before, MANAGED_KEYS));

  const rc = await readIf(rcPath);
  if (rc !== null && rc.includes(MARKER)) await writeFile(rcPath, replaceBlock(rc, ''));

  for (const f of ['device.key', 'device.crt', 'device.csr', 'tenant-ca.pem']) {
    await rm(join(artifactDir, f), { force: true });
  }
  await rm(artifactDir, { recursive: true, force: true }).catch(() => {});
}

/** Swap our marked block for `replacement`, taking the newline it introduced. */
function replaceBlock(text, replacement) {
  const at = text.indexOf(MARKER);
  if (at < 0) return text;
  let end = at;
  // the marker line, then every line until a blank one or the end
  end = text.indexOf('\n', end) + 1;
  while (end > 0 && end < text.length && text[end] !== '\n') {
    const next = text.indexOf('\n', end);
    if (next < 0) { end = text.length; break; }
    end = next + 1;
  }
  return text.slice(0, at) + replacement + text.slice(end);
}

async function readIf(p) {
  try { return await readFile(p, 'utf8'); } catch { return null; }
}

/**
 * Which of the two configuration locations are actually in place (FR-18.1).
 *
 * **This does not run at the proxy, and that is a measured decision rather than
 * a convenience.** The requirement was written around F05: a pre-settings
 * request (`/api/eval/*`) that only arrives when the shell export is present,
 * making a session whose first contact came later identifiable as
 * settings-only. Two controlled runs on client 2.1.224 — one shell-export only,
 * one project-scope `settings.json` only, with the activity filter off so
 * nothing was hidden — produced **identical** request sequences, and neither
 * carried a single `/api/eval` or `/api/event_logging` request. The proxy
 * cannot tell the two apart.
 *
 * Here both locations are readable, so nothing has to be inferred, and the case
 * the spec called harder and most important — settings missing, so background
 * agents never reach the proxy at all — is as visible as the other one.
 */
export async function checkEnrolment({
  settingsPath = settingsPathDefault(),
  rcPath = join(homedir(), '.bashrc'),
  artifactDir = artifactDirDefault(),
} = {}) {
  const settingsText = await readIf(settingsPath);
  let settingsEnv = {};
  try { settingsEnv = JSON.parse(stripJsonComments(settingsText || '{}')).env || {}; } catch { settingsEnv = {}; }
  const inSettings = MANAGED_KEYS.filter((k) => k in settingsEnv);

  const rc = (await readIf(rcPath)) || '';
  const shell = rc.includes(MARKER);

  const artifacts = [];
  for (const f of ['tenant-ca.pem', 'device.key']) {
    if ((await readIf(join(artifactDir, f))) === null) artifacts.push(f);
  }

  const problems = [];
  if (!inSettings.length) {
    problems.push(`${settingsPath} has none of the proxy settings. Background agents read this ` +
      'file and nothing else — without it their traffic reaches the API directly, and nothing ' +
      'surfaces an error. Run: teamclaude enrol --proxy <url>');
  } else if (inSettings.length < MANAGED_KEYS.length) {
    const missing = MANAGED_KEYS.filter((k) => !inSettings.includes(k));
    problems.push(`${settingsPath} is missing ${missing.join(', ')}. Re-run: teamclaude enrol --proxy <url>`);
  }
  if (!shell) {
    problems.push(`${rcPath} has no teamclaude block. One request leaves before settings are ` +
      'read, so only the shell export catches it. Run: teamclaude enrol --proxy <url>');
  }
  if (artifacts.length) {
    problems.push(`${artifactDir} is missing ${artifacts.join(', ')}, which the settings point at. ` +
      'Re-run: teamclaude enrol --proxy <url>');
  }

  return {
    settingsPath, rcPath, artifactDir,
    settings: { present: inSettings.length > 0, keys: inSettings },
    shell: { present: shell },
    artifacts: { missing: artifacts },
    complete: problems.length === 0,
    problems,
  };
}

/**
 * Drop `//` and block comments so the env block can be read.
 *
 * Only for reading — a merge never parses, precisely so comments survive.
 * Strings are skipped as units: a `//` inside a URL is not a comment.
 */
function stripJsonComments(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') { const e = endOfString(text, i); out += text.slice(i, e); i = e; continue; }
    if (text[i] === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text[i] === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += text[i++];
  }
  return out;
}
