// Parser-level public-mode test: proves private notes never reach quiz decks
// in `public` builds. Spawns only the vault parser (tsx run.ts) into a temp
// dir — no `ng build`, so this stays fast. The full-pipeline build test
// (build.test.mjs) covers the full-mode bundle shape, manifest route, nav
// node, prerendered page and sitemap URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBinJs } from './run-build.mjs';

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

test('public build excludes private notes from quiz decks', () => {
  const out = mkdtempSync(join(tmpdir(), 'mp-quiz-public-'));
  try {
    const res = spawnSync(process.execPath, [resolveBinJs('tsx'), 'tools/vault-parser/run.ts'], {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        VAULT: join(PKG_ROOT, 'tools/fixtures/vault'),
        CONTENT_OUT: out,
        BUILD_MODE: 'public',
      },
    });
    assert.equal(res.status, 0, `vault parser failed (exit ${res.status})`);
    const deck = JSON.parse(readFileSync(join(out, 'quiz', 'quiz', 'spanish.json'), 'utf8'));
    // Secret.md is `publish: private` with the `quiz` tag — the mode filter
    // must keep it out of the deck (and the rest stays sorted by slug).
    assert.deepEqual(
      deck.notes.map((n) => n.slug),
      ['quiz/palabra', 'quiz/word'],
      'private notes leaked into the public-mode deck',
    );
    assert.equal(deck.notes.length, 2, 'expected exactly the two public notes');
    // Tag index in public builds: the `quiz` tag survives the mode filter and
    // counts only the two public notes — Secret.md is private and must not
    // contribute to tag counts.
    const tags = JSON.parse(readFileSync(join(out, 'tags.json'), 'utf8'));
    assert.deepEqual(tags.tags, [{ name: 'quiz', slug: 'tags/quiz', count: 2 }]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
