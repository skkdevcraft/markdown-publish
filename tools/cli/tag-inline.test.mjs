// Parser-level inline-tag test: the shared markdown factory links inline tags
// that survived the tag index to their generated quiz routes (`tags/<slug>`,
// base-relative, no leading slash) and renders every other tag as plain text —
// never a dead link. Because the factory is shared, canvas text nodes get
// identical behavior. Spawns only the vault parser (tsx run.ts) — no
// `ng build`, so this stays fast; the full-pipeline build test asserts the
// fixture home note's rendered HTML end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBinJs } from './run-build.mjs';

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

/** Synthetic vault: `quiz` and `spanish/verbs` are real frontmatter tags
 *  (so they get index rows + generated routes), `nope`/`idea` exist only as
 *  inline mentions (no route). Body.md exercises notes; Board.canvas has a
 *  text node exercising the shared renderer factory. */
function writeInlineVault(dir) {
  const files = {
    'Tagged.md': `---\ntitle: Tagged\npublish: public\ntags:\n    - quiz\n    - spanish/verbs\n---\n\n# Tagged\n`,
    'Body.md': `---\ntitle: Body\npublish: public\n---\n\n# Body\n\nMentions: #quiz #Quiz #spanish/verbs #nope #idea\n`,
    'Board.canvas': JSON.stringify({
      nodes: [
        {
          id: 't1',
          type: 'text',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          text: 'Canvas tags: #quiz #nope',
        },
      ],
      edges: [],
    }),
  };
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
}

test('inline tags: surviving tags link base-relatively, others are plain text (notes + canvas)', () => {
  const vault = mkdtempSync(join(tmpdir(), 'mp-tag-inline-vault-'));
  const out = mkdtempSync(join(tmpdir(), 'mp-tag-inline-out-'));
  try {
    writeInlineVault(vault);
    const res = spawnSync(
      process.execPath,
      [resolveBinJs('tsx'), 'tools/vault-parser/run.ts'],
      {
        cwd: PKG_ROOT,
        stdio: 'pipe',
        shell: false,
        env: { ...process.env, VAULT: vault, CONTENT_OUT: out, BUILD_MODE: 'full' },
      },
    );
    assert.equal(res.status, 0, `vault parser failed (exit ${res.status})`);

    // note body: `#quiz` (surviving tag) → base-relative link to tags/quiz;
    // the raw anchor casing is preserved (`#Quiz` stays `#Quiz`); nested tag
    // `#spanish/verbs` links to its own per-segment route; `#nope`/`#idea`
    // have no tag page → plain text.
    const body = JSON.parse(readFileSync(join(out, 'notes', 'body.json'), 'utf8'));
    assert.match(
      body.html,
      /<a class="tag" href="tags\/quiz">#quiz<\/a>/,
      'inline #quiz must link to tags/quiz',
    );
    assert.match(
      body.html,
      /<a class="tag" href="tags\/quiz">#Quiz<\/a>/,
      'raw anchor casing must be preserved in the link text',
    );
    assert.match(
      body.html,
      /<a class="tag" href="tags\/spanish\/verbs">#spanish\/verbs<\/a>/,
      'nested tag must link to its per-segment route',
    );
    assert.match(body.html, /#nope #idea/, 'tags without a page must stay plain text');
    assert.doesNotMatch(body.html, /href="tags\/nope"/, 'inline #nope must not link');
    assert.doesNotMatch(body.html, /href="tags\/idea"/, 'inline #idea must not link');
    assert.doesNotMatch(
      body.html,
      /<a class="tag"[^>]*href="\//,
      'tag links must be base-relative (no leading slash)',
    );

    // canvas text node: same factory → identical behavior for free.
    const canvas = JSON.parse(readFileSync(join(out, 'canvas', 'board.json'), 'utf8'));
    const textNode = canvas.nodes.find((n) => n.kind === 'text');
    assert.ok(textNode, 'canvas text node missing');
    assert.match(
      textNode.payload.html,
      /<a class="tag" href="tags\/quiz">#quiz<\/a>/,
      'canvas text must link the surviving tag',
    );
    assert.match(textNode.payload.html, /#nope/, 'canvas tag without a page stays text');
    assert.doesNotMatch(
      textNode.payload.html,
      /href="tags\/nope"/,
      'canvas #nope must not link',
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
