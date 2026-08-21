import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from './run-build.mjs';
import { resolveConfig } from './resolve-config.mjs';

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

test('builds the fixtures vault into a complete static site under a base href', () => {
  const out = resolve(PKG_ROOT, 'tmp-test-out');
  rmSync(out, { recursive: true, force: true });
  const cfg = resolveConfig({
    flags: {
      vault: join(PKG_ROOT, 'tools/fixtures/vault'),
      out,
      siteUrl: 'http://localhost/sub',
      baseHref: '/sub/',
    },
    env: {},
    cwd: PKG_ROOT,
  });
  runBuild(cfg, { cwd: PKG_ROOT });
  for (const f of ['index.html', 'sitemap.xml', 'robots.txt', 'llms.txt', '404.html',
                   'content/manifest.json', 'pagefind/pagefind.js', 'og.png']) {
    assert.ok(existsSync(join(out, f)), `missing ${f}`);
  }
  // the generated og card must be a real 1200x630 PNG (not the html fallback)
  const png = readFileSync(join(out, 'og.png'));
  assert.equal(png.readUInt32BE(16), 1200, 'og.png width');
  assert.equal(png.readUInt32BE(20), 630, 'og.png height');
  // base-href must reach the output: the root redirect points under /sub/ (so a
  // GitHub Pages project site at user.github.io/sub doesn't 404).
  const rootHtml = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(rootHtml, /\/sub\//, 'root redirect/base did not honour --base-href');
  // sitemap urls must not double the base path (siteUrl already ends with /sub;
  // prerendered route paths also start with /sub — gen-seo strips it).
  const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
  assert.doesNotMatch(sitemap, /\/sub\/sub\//, 'sitemap doubled the base path');
  assert.match(sitemap, /<loc>http:\/\/localhost\/sub\/<\/loc>|<loc>http:\/\/localhost\/sub<\/loc>/, 'sitemap missing root url');
  // wikilink hrefs must be base-RELATIVE (no leading slash): root-absolute ones
  // bypass <base href> and 404 for crawlers/middle-click on subpath sites.
  const home = readFileSync(join(out, 'content', 'notes', 'home.json'), 'utf8');
  assert.doesNotMatch(home, /class=\\"wikilink\\" href=\\"\//, 'root-absolute wikilink href found');
  assert.match(home, /class=\\"wikilink\\" href=\\"[^/]/, 'no base-relative wikilink href found');
  // --- quiz decks ---
  // full mode: the Spanish deck matches every note tagged `quiz` (Word,
  // Palabra, Secret — including the private one), sorted by slug.
  const deck = JSON.parse(
    readFileSync(join(out, 'content', 'quiz', 'quiz', 'spanish.json'), 'utf8'),
  );
  assert.equal(deck.title, 'Spanish');
  assert.equal(deck.description, 'Do you remember these words?');
  assert.deepEqual(deck.tags, ['quiz']);
  // tag index: one row per surviving frontmatter tag; `quiz` counts every
  // tagged note in full mode (Word, Palabra, Secret) — matching the deck's
  // note pool.
  const tags = JSON.parse(
    readFileSync(join(out, 'content', 'tags.json'), 'utf8'),
  );
  assert.deepEqual(tags.tags, [{ name: 'quiz', slug: 'tags/quiz', count: 3 }]);
  // Secret.md sits at the vault ROOT, so its slug is `secret` — the sort is
  // by slug: quiz/palabra < quiz/word < secret.
  assert.deepEqual(deck.notes, [
    { slug: 'quiz/palabra', title: 'Palabra' },
    { slug: 'quiz/word', title: 'Word' },
    { slug: 'secret', title: 'Secret' },
  ]);
  // the deck route lands in the manifest alongside notes and canvases
  const manifest = JSON.parse(
    readFileSync(join(out, 'content', 'manifest.json'), 'utf8'),
  );
  assert.ok(
    manifest.routes.some(
      (r) => r.slug === 'quiz/spanish' && r.kind === 'quiz' && r.title === 'Spanish',
    ),
    'quiz route missing from manifest',
  );
  // ...and in the nav tree as a quiz leaf under the `quiz` folder
  const quizFolder = manifest.nav.find(
    (n) => n.type === 'folder' && n.name === 'quiz',
  );
  assert.ok(quizFolder, 'quiz folder missing from nav');
  assert.ok(
    quizFolder.children.some(
      (c) => c.type === 'quiz' && c.slug === 'quiz/spanish',
    ),
    'quiz leaf missing from nav',
  );
  // the route is prerendered (start-screen shell) and listed in the sitemap
  assert.ok(
    existsSync(join(out, 'quiz', 'spanish', 'index.html')),
    'quiz route not prerendered',
  );
  assert.match(
    sitemap,
    /http:\/\/localhost\/sub\/quiz\/spanish/,
    'sitemap missing the quiz URL',
  );
  // the prerendered shell is the crawlable start screen: title, description,
  // matched-note count and the start button — no session UI, no stats
  const quizHtml = readFileSync(join(out, 'quiz', 'spanish', 'index.html'), 'utf8');
  assert.match(quizHtml, />Spanish</, 'quiz page missing the deck title');
  assert.match(quizHtml, /Do you remember these words\?/, 'quiz page missing the description');
  assert.match(quizHtml, />\s*3 notes\s*</, 'quiz page missing the matched-note count');
  assert.match(quizHtml, /Start quiz/, 'quiz page missing the start button');
  assert.doesNotMatch(quizHtml, /End session/, 'quiz page prerendered session UI');
  assert.doesNotMatch(quizHtml, /This session:/, 'quiz page prerendered the end screen');

  rmSync(out, { recursive: true, force: true });
}, { timeout: 180000 });
