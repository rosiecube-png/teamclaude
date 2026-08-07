import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// task-7 criterion 5: no documentation references a file, flag or config key
// that does not exist. Checked, because reading for it is exactly the job
// nobody does twice — and every one of these went stale silently the last time.
//
// The first version of this check was itself wrong in a way worth keeping in
// mind: it built a word-boundary matcher as `new RegExp(\`\\b${leaf}\\b\`)`,
// and `\b` inside a template literal is a **backspace character**, not a word
// boundary. It reported all 18 config keys as missing while every one of them
// existed. A checker that fails loudly is recoverable; this one failed
// convincingly.

const ROOT = process.env.TC_DOCS_ROOT || '.';

function markdownFiles() {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.md')) out.push(join(d, e.name));
    }
  })('docs');
  if (existsSync(join(ROOT, 'README.md'))) out.push('README.md');
  return out;
}

const sourceText = () => readdirSync(join(ROOT, 'src'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(ROOT, 'src', f), 'utf8'))
  .join('\n');

const word = (w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

test('the word matcher is a word matcher', () => {
  // The bug that made the first version of this file report 18 false problems.
  assert.ok(word('port').test('const port = 1;'));
  assert.ok(!word('port').test('const support = 1;'));
});

test('every relative link in the documentation resolves', () => {
  const problems = [];
  for (const rel of markdownFiles()) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      // ../../issues/N and ../../pull/N are GitHub-relative URLs, resolved by
      // the forge rather than the filesystem.
      if (/(?:\.\.\/)+(?:issues|pull)\//.test(m[1])) continue;
      if (!existsSync(resolve(ROOT, dirname(rel), m[1]))) problems.push(`${rel} → ${m[1]}`);
    }
  }
  assert.deepEqual(problems, [], `these links point at nothing:\n  ${problems.join('\n  ')}`);
});

test('every src/ file named in the documentation exists', () => {
  const problems = [];
  for (const rel of markdownFiles()) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/`(src\/[\w./-]+\.js)/g)) {
      if (!existsSync(join(ROOT, m[1]))) problems.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepEqual(problems, [], `these files were renamed or removed:\n  ${problems.join('\n  ')}`);
});

test('every proxy.* config key in the documentation is read by the code', () => {
  const src = sourceText();
  assert.ok(src.length > 10000, 'the source was not loaded, so this would pass by checking nothing');
  const problems = [];
  const seen = new Set();
  for (const rel of markdownFiles()) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/`(proxy\.[a-zA-Z][\w.]*)`/g)) {
      const leaf = m[1].split('.').pop();
      seen.add(leaf);
      if (!word(leaf).test(src)) problems.push(`${rel}: ${m[1]}`);
    }
  }
  assert.ok(seen.size > 4, `only ${seen.size} config keys found — has the notation changed?`);
  assert.deepEqual(problems, [], `documented but unread:\n  ${problems.join('\n  ')}`);
});

test('every teamclaude subcommand in the documentation is dispatched', () => {
  const src = sourceText();
  const problems = [];
  const seen = new Set();
  for (const rel of markdownFiles()) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/`teamclaude ([a-z][a-z-]*)/g)) {
      seen.add(m[1]);
      if (!src.includes(`case '${m[1]}'`)) problems.push(`${rel}: teamclaude ${m[1]}`);
    }
  }
  assert.ok(seen.size > 3, `only ${seen.size} commands found — has the notation changed?`);
  assert.deepEqual(problems, [], `documented but not dispatched:\n  ${problems.join('\n  ')}`);
});

test('the documentation does not still describe the behaviour M1 replaced', () => {
  const claims = [
    // The sentence this existed for was `Any host other than the upstream is
    // blind-tunnelled.`, and the first pattern here did not match it — so the
    // check passed while the claim it was written for sat in the file.
    [/(?:any(?:thing)? (?:host )?other than the upstream|anything else)[^.]{0,40}blind[- ]tunnel/i,
      'a document still claims every other host is blind-tunnelled — off-loopback it is refused'],
    [/`proxy_error`/, 'a document still names proxy_error, which no longer exists'],
    [/825/, 'a document still quotes the 825-day leaf'],
  ];
  const problems = [];
  for (const rel of markdownFiles()) {
    if (rel.includes('plans')) continue;   // the trace records what changed, on purpose
    if (rel.includes('specs')) continue;   // specs keep a "what was wrong" section
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const [re, why] of claims) if (re.test(text)) problems.push(`${rel}: ${why}`);
  }
  assert.deepEqual(problems, [], problems.join('\n  '));
});
