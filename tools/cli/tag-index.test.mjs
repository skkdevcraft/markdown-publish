// Parser-level tag-index test: exercises the semantics matrix of the tag
// index (tags.json) against a synthetic temp vault — case grouping + display
// casing, Obsidian nested-tag counts, per-segment slugs, slug-suffix
// disambiguation, real-route collision (dropped with a warning, exit 0), the
// public-mode count filter, and byte-identical output across repeated builds.
// Spawns only the vault parser (tsx run.ts) — no `ng build`, so this stays
// fast. The full-pipeline build test covers the bundle shape end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBinJs } from './run-build.mjs';

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

/** A markdown note with frontmatter: title, optional tags, extra fields. */
function note(name, tags, extra = {}) {
  const fm = [`title: ${name}`];
  if (tags.length) fm.push(`tags:\n${tags.map((t) => `    - ${t}`).join('\n')}`);
  for (const [k, v] of Object.entries(extra)) fm.push(`${k}: ${v}`);
  return `---\n${fm.join('\n')}\n---\n\n# ${name}\n`;
}

/** Semantics-matrix vault:
 *  - `Spanish` (×3) vs `spanish` (×2) → display `Spanish`, most frequent;
 *  - `Tie` (×2) vs `tie` (×2) → display casing tie, broken deterministically;
 *  - nested tags: `Echo` carries only `spanish/verbs` — counted under
 *    `Spanish` (Obsidian nesting) and `spanish/verbs` (its own row);
 *  - `foo bar` vs `foo-bar` slugify to the same route → `-2` suffix;
 *  - `real`'s route `tags/real` is owned by `Tags/Real.md` → dropped+warned;
 *  - `Private.md` (publish: private) tests the public-mode count filter. */
function writeMatrixVault(dir) {
  const files = {
    'Alpha.md': note('Alpha', ['Spanish', 'spanish/verbs', 'foo bar', 'Tie'], {
      publish: 'public',
    }),
    'Beta.md': note(
      'Beta',
      ['spanish', 'spanish/verbs/past', 'foo bar', 'real', 'tie'],
      { publish: 'public' },
    ),
    'Gamma.md': note('Gamma', ['Spanish', 'foo-bar', 'tie'], {
      publish: 'public',
    }),
    'Delta.md': note('Delta', ['Spanish', 'Tie'], { publish: 'public' }),
    'Echo.md': note('Echo', ['spanish/verbs'], { publish: 'public' }),
    'Private.md': note('Private', ['spanish'], { publish: 'private' }),
    'Tags/Real.md': note('Real', [], { publish: 'public' }),
  };
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
}

/** Spawn the vault parser into a fresh temp out dir; returns the spawn result
 *  plus the out dir path. Caller cleans up with rmSync. */
function parseVault(vaultDir, mode) {
  const out = mkdtempSync(join(tmpdir(), 'mp-tags-'));
  const res = spawnSync(
    process.execPath,
    [resolveBinJs('tsx'), 'tools/vault-parser/run.ts'],
    {
      cwd: PKG_ROOT,
      stdio: 'pipe',
      shell: false,
      env: { ...process.env, VAULT: vaultDir, CONTENT_OUT: out, BUILD_MODE: mode },
    },
  );
  return { ...res, out };
}

function readTags(out) {
  return JSON.parse(readFileSync(join(out, 'tags.json'), 'utf8'));
}

test('tag index: full-mode semantics matrix + deterministic output', () => {
  const vault = mkdtempSync(join(tmpdir(), 'mp-tags-vault-'));
  const runs = [];
  try {
    writeMatrixVault(vault);
    // parse twice → the emitted bundle must be byte-identical across builds
    runs.push(parseVault(vault, 'full'));
    runs.push(parseVault(vault, 'full'));
    const expected = [
      { name: 'Spanish', slug: 'tags/spanish', count: 6 },
      { name: 'Tie', slug: 'tags/tie', count: 4 },
      { name: 'spanish/verbs', slug: 'tags/spanish/verbs', count: 3 },
      { name: 'foo bar', slug: 'tags/foo-bar', count: 2 },
      { name: 'foo-bar', slug: 'tags/foo-bar-2', count: 1 },
      { name: 'spanish/verbs/past', slug: 'tags/spanish/verbs/past', count: 1 },
    ];
    for (const res of runs) {
      assert.equal(res.status, 0, `vault parser failed (exit ${res.status})`);
      // one row per surviving tag, sorted count-desc then name-asc
      assert.deepEqual(readTags(res.out).tags, expected);
    }
    assert.equal(
      readFileSync(join(runs[0].out, 'tags.json'), 'utf8'),
      readFileSync(join(runs[1].out, 'tags.json'), 'utf8'),
      'tags.json differs across repeated builds',
    );
    // `real` collides with the real note route Tags/Real.md → dropped with a
    // console warning, but the build still exits 0.
    assert.match(
      `${runs[0].stderr}${runs[0].stdout}`,
      /dropping "real"/,
      'expected a build warning for the colliding tag',
    );
  } finally {
    for (const res of runs) rmSync(res.out, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
});

test('tag index: public mode excludes private notes from counts', () => {
  const vault = mkdtempSync(join(tmpdir(), 'mp-tags-vault-'));
  let res;
  try {
    writeMatrixVault(vault);
    res = parseVault(vault, 'public');
    assert.equal(res.status, 0, `vault parser failed (exit ${res.status})`);
    // Private.md (publish: private, tagged `spanish`) must contribute nothing:
    // `Spanish` drops 6 → 5; every other row is untouched.
    assert.deepEqual(readTags(res.out).tags, [
      { name: 'Spanish', slug: 'tags/spanish', count: 5 },
      { name: 'Tie', slug: 'tags/tie', count: 4 },
      { name: 'spanish/verbs', slug: 'tags/spanish/verbs', count: 3 },
      { name: 'foo bar', slug: 'tags/foo-bar', count: 2 },
      { name: 'foo-bar', slug: 'tags/foo-bar-2', count: 1 },
      { name: 'spanish/verbs/past', slug: 'tags/spanish/verbs/past', count: 1 },
    ]);
  } finally {
    if (res) rmSync(res.out, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
});

test('tag index: a vault with no tags emits an empty index', () => {
  const vault = mkdtempSync(join(tmpdir(), 'mp-tags-vault-'));
  let res;
  try {
    writeFileSync(
      join(vault, 'Plain.md'),
      note('Plain', [], { publish: 'public' }),
      'utf8',
    );
    res = parseVault(vault, 'full');
    assert.equal(res.status, 0, `vault parser failed (exit ${res.status})`);
    assert.deepEqual(readTags(res.out), { tags: [] });
  } finally {
    if (res) rmSync(res.out, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
});
