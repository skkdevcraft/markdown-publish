import { promises as fs, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import GithubSlugger from 'github-slugger';
import type {
  Manifest,
  RouteEntry,
  NavNode,
  Note,
  Heading,
  LinkRef,
  ObsidianCanvas,
  CanvasModel,
  Quiz,
  GraphData,
  GraphLink,
  SearchDoc,
  SearchIndex,
} from '@shared/content-model';
import { pathToSlug, baseName } from './slug';
import {
  createMarkdown,
  type MarkdownEnv,
  type ResolveResult,
} from './markdown';
import {
  normalizeCanvas,
  makeCanvasEnv,
  type CanvasResolved,
} from './canvas';
import { normalizeQuiz, noteInDeck } from './quiz';
import { buildTagIndex } from './tags';

const ASSET_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'mp4', 'mp3'];
const MAX_EMBED_DEPTH = 3;

export interface ParseOptions {
  vaultDir: string;
  outDir: string;
  mode: 'public' | 'full';
  /** Absolute deploy origin for canonical/OG URLs (e.g. https://notes.example.com). */
  siteUrl?: string;
  /** Display name for the site (defaults to the vault folder name). */
  siteName?: string;
  /** Site-wide description for the home page + OG fallback. */
  siteDescription?: string;
  /** BCP-47 content language for <html lang> (default 'en'). */
  siteLang?: string;
  /** Optional sidebar footer credit (no default — empty hides the footer). */
  siteFooter?: string;
  /** Explicit home note (file name without extension); overrides detection. */
  homeNote?: string;
}

interface NoteEntry {
  slug: string;
  relPath: string;
  absPath: string;
  base: string;
  data: Record<string, unknown>;
  content: string;
  publish: 'public' | 'private';
  title: string;
  /** Frontmatter `tags`, flattened + deduped (possibly empty). */
  tags: string[];
}

interface AssetEntry {
  relPath: string;
  absPath: string;
  base: string;
  ext: string;
  /** Filled lazily when the asset is referenced. */
  url?: string;
  hash?: string;
}

/** Match + slug-sort a deck's note pool against the mode-filtered note set:
 *  ALL tags required, case-insensitive, Obsidian nested-tag semantics. Shared
 *  by hand-written decks and generated tag decks so the two pools can never
 *  drift apart (the tag-index count invariant depends on this exact shape). */
function matchDeckNotes(
  notes: readonly NoteEntry[],
  tags: string[],
): { slug: string; title: string }[] {
  return notes
    .filter((n) => noteInDeck(n.tags, tags))
    .map((n) => ({ slug: n.slug, title: n.title }))
    .sort((a, b) => a.slug.localeCompare(b.slug)); // reproducible output
}

export async function parseVault(opts: ParseOptions): Promise<void> {
  const vaultDir = path.resolve(opts.vaultDir);
  const outDir = path.resolve(opts.outDir);

  // 1. Walk
  const mdFiles = await fg('**/*.md', {
    cwd: vaultDir,
    ignore: ['.obsidian/**', '.trash/**'],
    dot: false,
  });
  const assetFiles = await fg(`**/*.{${ASSET_EXTS.join(',')}}`, {
    cwd: vaultDir,
    ignore: ['.obsidian/**', '.trash/**'],
    dot: false,
    caseSensitiveMatch: false,
  });
  const canvasFiles = await fg('**/*.canvas', {
    cwd: vaultDir,
    ignore: ['.obsidian/**', '.trash/**'],
    dot: false,
  });
  const quizFiles = await fg('**/*.quiz.json', {
    cwd: vaultDir,
    ignore: ['.obsidian/**', '.trash/**'],
    dot: false,
    caseSensitiveMatch: false,
  });

  // 2. Route map + basename index (notes)
  const allNotes: NoteEntry[] = [];
  for (const rel of mdFiles) {
    const absPath = path.join(vaultDir, rel);
    const raw = await fs.readFile(absPath, 'utf8');
    const parsed = matter(raw);
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const publish: 'public' | 'private' =
      data.publish === 'public' ? 'public' : 'private';
    allNotes.push({
      slug: pathToSlug(rel),
      relPath: rel,
      absPath,
      base: baseName(rel),
      data,
      content: parsed.content,
      publish,
      title: '',
      tags: parseTags(data),
    });
  }

  // mode filter
  const notes =
    opts.mode === 'public'
      ? allNotes.filter((n) => n.publish === 'public')
      : allNotes;

  // title resolution: data.title ?? first H1 ?? basename
  for (const n of notes) {
    const fmTitle = typeof n.data.title === 'string' ? n.data.title : null;
    const h1 = /^#\s+(.+)$/m.exec(n.content);
    n.title = (h1 && h1[1].trim()) || fmTitle || n.base;
  }

  // video-id -> note index. Video notes are named `YYYY-MM-DD-<youtubeId>`,
  // so the id is the basename after the 10-char date and its separator. Lets
  // YouTube links in the vault route to the internal note for that video.
  const byVideoId = new Map<string, NoteEntry | null>();
  for (const n of notes) {
    const m = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(n.base);
    if (!m) continue;
    const id = m[1];
    if (byVideoId.has(id)) byVideoId.set(id, null); // collision -> skip
    else byVideoId.set(id, n);
  }

  // basename -> slug index (case-insensitive). On collision keep first
  // (shortest path) and mark collided so they fall back to full path.
  const bySlug = new Map<string, NoteEntry>();
  const byBase = new Map<string, NoteEntry | null>();
  for (const n of notes) {
    bySlug.set(n.slug, n);
    const key = n.base.toLowerCase();
    if (byBase.has(key)) byBase.set(key, null); // collision -> require full path
    else byBase.set(key, n);
  }

  // asset index by basename + by relative slug-ish path
  const assets: AssetEntry[] = assetFiles.map((rel) => ({
    relPath: rel,
    absPath: path.join(vaultDir, rel),
    base: rel.split('/').pop() ?? rel,
    ext: (rel.split('.').pop() ?? '').toLowerCase(),
  }));
  const assetByBase = new Map<string, AssetEntry>();
  for (const a of assets) {
    const key = a.base.toLowerCase();
    if (!assetByBase.has(key)) assetByBase.set(key, a);
  }

  const assetsOutDir = path.join(outDir, 'assets');
  await fs.mkdir(assetsOutDir, { recursive: true });

  // Assets referenced during render (markdown-it is sync, so we hash + copy
  // synchronously and collect them here for nothing further; copy happens in
  // resolveAsset on first reference).
  const copiedAssets = new Set<AssetEntry>();

  // resolve target -> note (wikilink / embed / canvas file ref)
  function resolveNote(target: string): NoteEntry | null {
    const t = target.trim();
    // try as basename
    const direct = byBase.get(t.toLowerCase());
    if (direct) return direct;
    // try as full relative path slug
    const asSlug = pathToSlug(t);
    const bySlugHit = bySlug.get(asSlug);
    if (bySlugHit) return bySlugHit;
    // Canvas file refs are relative to the Obsidian vault ROOT; when $VAULT
    // points at a subfolder, our slugs lack the leading segments. Strip them
    // one at a time until something matches (precise, collision-safe).
    const parts = asSlug.split('/');
    for (let i = 1; i < parts.length; i++) {
      const hit = bySlug.get(parts.slice(i).join('/'));
      if (hit) return hit;
    }
    // last resort: basename of a pathy target (collisions are null in byBase)
    return byBase.get(baseName(t).toLowerCase()) ?? null;
  }

  // canvases are linkable too: [[Board.canvas]] / [text](board.canvas) must
  // resolve to the canvas route, not render as a broken link.
  const canvasByBase = new Map<string, { slug: string; title: string }>();
  for (const rel of canvasFiles) {
    const entry = { slug: pathToSlug(rel), title: baseName(rel) };
    const key = baseName(rel).toLowerCase();
    if (!canvasByBase.has(key)) canvasByBase.set(key, entry);
  }

  // 2b. Parse quizzes. A note/canvas that already owns the slug wins the route
  // (author error → soft-skip with a warning, same policy as schema errors);
  // the same applies to a second quiz claiming the same slug.
  const quizByBase = new Map<string, { slug: string; title: string }>();
  const quizSlugs = new Set<string>();
  const parsedQuizzes: Quiz[] = [];
  const canvasSlugs = new Set(canvasFiles.map((rel) => pathToSlug(rel)));
  for (const rel of quizFiles) {
    const slug = pathToSlug(rel.replace(/\.quiz\.json$/i, ''));
    if (bySlug.has(slug) || canvasSlugs.has(slug) || quizSlugs.has(slug)) {
      console.warn(`quiz: skipping "${rel}" — slug "${slug}" already taken`);
      continue;
    }
    quizSlugs.add(slug);
    // Unparseable JSON is a hard build error (canvas precedent) — no try/catch.
    const raw = JSON.parse(await fs.readFile(path.join(vaultDir, rel), 'utf8')) as unknown;
    const fallbackTitle = (rel.split('/').pop() ?? rel).replace(/\.quiz\.json$/i, '');
    const source = normalizeQuiz(raw, fallbackTitle);
    if (!source) {
      console.warn(
        `quiz: skipping "${rel}" — tags must be a non-empty array of strings`,
      );
      continue;
    }
    // Matching runs against the mode-filtered note set (`notes`), so private
    // notes never reach decks in public builds. A note is in the deck iff it
    // has ALL deck tags (case-insensitive, Obsidian nested-tag semantics).
    // Zero matches is legitimate: the deck ships with an empty pool.
    const matched = matchDeckNotes(notes, source.tags);
    const quiz: Quiz = {
      slug,
      title: source.title,
      description: source.description,
      tags: source.tags,
      notes: matched,
    };
    parsedQuizzes.push(quiz);
    // Basename keeps `.quiz` (baseName strips only the last extension), so
    // [[Spanish.quiz.json]] resolves here while plain [[Spanish]] does not
    // collide with notes.
    quizByBase.set(baseName(rel).toLowerCase(), { slug, title: quiz.title });
  }

  // Tag index: every frontmatter tag on a surviving note becomes a row (case-
  // grouped, Obsidian nested-tag counts), emitted as tags.json for the Tags
  // view. Real content routes (notes/canvases/quizzes) win slug collisions —
  // a tag whose route is taken is dropped with a warning, so nothing in the
  // index points at a route that doesn't exist. `result.tagSlugs` (the
  // surviving route slugs) is consumed by the inline-tag link rule in the
  // shared markdown factory (ticket 03) — computed here, before rendering,
  // because frontmatter is already parsed.
  const tagIndexResult = buildTagIndex(
    notes,
    new Set<string>([...bySlug.keys(), ...canvasSlugs, ...quizSlugs]),
  );

  // 2c. Generated tag decks: every surviving tag is a virtual quiz deck at its
  // index route (`tags/<slug>`), so a visitor can review exactly the notes a
  // tag counts with the exact existing quiz flow and zero new quiz UI. The
  // note pool is matched with the SAME noteInDeck semantics the index used
  // (all-tags-required, case-insensitive, Obsidian nested-tag semantics) and
  // slug-sorted, so the deck is byte-identical to a hand-written deck with
  // `tags: [<display>]` — the index's count invariant is a direct consequence
  // (ticket 02 + tag-index test assert it). These decks are manifest routes
  // (dispatch/SEO/prerender/sitemap come for free) but deliberately NOT nav
  // entries: a tags-heavy vault must not clutter the sidebar and no `tags`
  // folder is created; they also stay out of the graph/search/WebMCP surfaces,
  // which are notes-only by construction. A tag with zero matched notes ships
  // an empty pool, like hand-written decks.
  const tagDecks: Quiz[] = [];
  for (const tag of tagIndexResult.index.tags) {
    const matched = matchDeckNotes(notes, [tag.name]);
    tagDecks.push({
      slug: tag.slug,
      title: `#${tag.name}`,
      description: `${matched.length} ${matched.length === 1 ? 'note' : 'notes'} tagged #${tag.name}`,
      tags: [tag.name],
      notes: matched,
    });
  }

  function resolveLink(target: string): ResolveResult {
    const n = resolveNote(target);
    if (n) return { slug: n.slug, title: n.title };
    const c = canvasByBase.get(baseName(target).toLowerCase());
    if (c) return c;
    const q = quizByBase.get(baseName(target).toLowerCase());
    if (q) return q;
    return { slug: null, title: target };
  }

  function resolveVideo(id: string): LinkRef | null {
    const n = byVideoId.get(id);
    if (!n) return null;
    return { slug: n.slug, title: n.title };
  }

  function resolveAsset(
    target: string,
  ): { url: string; ext: string } | null {
    const base = target.split('/').pop() ?? target;
    const a = assetByBase.get(base.toLowerCase());
    if (!a) return null;
    if (!a.url) {
      // content-hash, copy into <outDir>/assets/<hash>.<ext> (build-time sync IO)
      const buf = readFileSync(a.absPath);
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      a.hash = hash;
      // Base-relative (no leading slash) so it resolves against <base href> and
      // works under a GitHub Pages project-site subpath, not just the root.
      a.url = `assets/${hash}.${a.ext}`;
      writeFileSync(path.join(assetsOutDir, `${hash}.${a.ext}`), buf);
      copiedAssets.add(a);
    }
    return { url: a.url, ext: a.ext };
  }

  // Inline-tag link lookup (ticket 03): lowercase tag name → its generated
  // quiz route (`tags/<slug>`). Built from the index entries so only tags
  // that survived collision filtering link; an inline tag with no route
  // renders as plain text (never a dead link). Threaded through the shared
  // factory, so canvas text nodes get identical behavior.
  const tagRouteByLower = new Map(
    tagIndexResult.index.tags.map((t) => [t.name.toLowerCase(), t.slug]),
  );
  const md = createMarkdown(tagRouteByLower);

  // Render a note's content with a fresh env. Used for top-level notes and,
  // recursively, for embeds (cycle-guarded, depth-limited).
  function renderNote(
    n: NoteEntry,
    headingFilter: string | null,
    depth: number,
    stack: Set<string>,
    outgoing: LinkRef[],
    headings: Heading[],
  ): string {
    let content = n.content;
    if (headingFilter) {
      content = extractSection(content, headingFilter);
    }
    const env: MarkdownEnv = {
      resolveLink,
      resolveAsset,
      resolveVideo,
      selfSlug: n.slug,
      outgoing,
      headings,
      slugger: new GithubSlugger(),
      renderEmbed(target, heading) {
        if (depth >= MAX_EMBED_DEPTH) return null;
        const tgt = resolveNote(target);
        if (!tgt) return null;
        if (stack.has(tgt.slug)) return null; // cycle guard
        const nextStack = new Set(stack);
        nextStack.add(tgt.slug);
        // embeds contribute outgoing links of the host note too
        return renderNote(tgt, heading, depth + 1, nextStack, outgoing, []);
      },
    };
    return md.render(content, env);
  }

  // 3. Parse notes
  const parsedNotes: Note[] = [];
  for (const n of notes) {
    const outgoing: LinkRef[] = [];
    const headings: Heading[] = [];
    const stack = new Set<string>([n.slug]);
    let html = renderNote(n, null, 0, stack, outgoing, headings);
    // The note title is rendered by the shell; drop a leading H1 that just
    // repeats it (and its TOC entry) to avoid a duplicated heading.
    if (headings[0]?.level === 1 && headings[0].text.trim() === n.title.trim()) {
      html = html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/, '');
      headings.shift();
    }
    parsedNotes.push({
      slug: n.slug,
      title: n.title,
      html,
      markdown: n.content,
      headings,
      backlinks: [],
      outgoing,
      frontmatter: n.data,
      publish: n.publish,
      tags: n.tags,
    });
  }

  // 4. Backlinks: invert outgoing
  const noteBySlug = new Map(parsedNotes.map((p) => [p.slug, p]));
  for (const src of parsedNotes) {
    for (const link of src.outgoing) {
      const target = noteBySlug.get(link.slug);
      if (!target || target.slug === src.slug) continue;
      if (!target.backlinks.some((b) => b.slug === src.slug)) {
        target.backlinks.push({ slug: src.slug, title: src.title });
      }
    }
  }

  // 5. Parse canvases
  interface ParsedCanvas {
    slug: string;
    title: string;
    model: CanvasModel;
  }
  const parsedCanvases: ParsedCanvas[] = [];
  for (const rel of canvasFiles) {
    const absPath = path.join(vaultDir, rel);
    const raw = await fs.readFile(absPath, 'utf8');
    const canvas = JSON.parse(raw) as ObsidianCanvas;
    const model = normalizeCanvas(canvas, {
      resolveLink,
      resolveAsset,
      renderText(text) {
        return md.render(text, makeCanvasEnv(resolveLink, resolveAsset));
      },
      resolveFileNode(file, anchor): CanvasResolved | null {
        const n = resolveNote(file);
        if (!n) return null;
        // `notes` is already mode-filtered (public build excludes private),
        // so membership alone decides availability.
        if (!notes.includes(n)) {
          return {
            slug: n.slug,
            title: n.title || n.base,
            html: '<p class="canvas-unavailable">Недоступно</p>',
            available: false,
          };
        }
        const html = renderNote(
          n,
          anchor ? anchor : null,
          0,
          new Set<string>([n.slug]),
          [],
          [],
        );
        const thumb = resolveAsset(`${n.base}.thumb.jpg`);
        return { slug: n.slug, title: n.title, html, available: true, thumbUrl: thumb?.url };
      },
    });
    parsedCanvases.push({ slug: pathToSlug(rel), title: baseName(rel), model });
  }

  // 6. Assets already materialized synchronously during resolveAsset.

  // 7. Emit
  const notesOutDir = path.join(outDir, 'notes');
  await fs.mkdir(notesOutDir, { recursive: true });
  for (const note of parsedNotes) {
    const file = path.join(notesOutDir, `${note.slug}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(note, null, 2), 'utf8');
  }

  const canvasOutDir = path.join(outDir, 'canvas');
  await fs.mkdir(canvasOutDir, { recursive: true });
  for (const c of parsedCanvases) {
    const file = path.join(canvasOutDir, `${c.slug}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(c.model, null, 2), 'utf8');
  }

  const quizOutDir = path.join(outDir, 'quiz');
  await fs.mkdir(quizOutDir, { recursive: true });
  for (const q of [...parsedQuizzes, ...tagDecks]) {
    // Generated decks carry the `tags/` prefix in their slug, so they land
    // under quiz/tags/<slug>.json — the same shape ContentService.loadQuiz
    // expects from the route slug.
    const file = path.join(quizOutDir, `${q.slug}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(q, null, 2), 'utf8');
  }

  // tag index: topics + counts for the Tags view; quiz bodies stay in their
  // per-tag generated decks (ticket 02), so this file stays lean.
  await fs.writeFile(
    path.join(outDir, 'tags.json'),
    JSON.stringify(tagIndexResult.index, null, 2),
    'utf8',
  );

  // link graph: nodes = notes, edges = resolved internal outgoing links
  // (deduped undirected, self-links dropped). degree drives node sizing.
  const slugSet = new Set(parsedNotes.map((p) => p.slug));
  const degree = new Map<string, number>();
  const seenEdge = new Set<string>();
  const graphLinks: GraphLink[] = [];
  for (const n of parsedNotes) {
    for (const link of n.outgoing) {
      if (!slugSet.has(link.slug) || link.slug === n.slug) continue;
      const key =
        n.slug < link.slug
          ? `${n.slug} ${link.slug}`
          : `${link.slug} ${n.slug}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      graphLinks.push({ source: n.slug, target: link.slug });
      degree.set(n.slug, (degree.get(n.slug) ?? 0) + 1);
      degree.set(link.slug, (degree.get(link.slug) ?? 0) + 1);
    }
  }
  const graph: GraphData = {
    nodes: parsedNotes.map((p) => ({
      slug: p.slug,
      title: p.title,
      degree: degree.get(p.slug) ?? 0,
    })),
    links: graphLinks,
  };
  await fs.writeFile(
    path.join(outDir, 'graph.json'),
    JSON.stringify(graph),
    'utf8',
  );

  // search index: plain-text body per note, for keyword scoring + snippets in
  // the search service and the WebMCP `search_notes` tool (and the embeddings
  // step downstream). Markdown stripped to text; canvases are not full-text.
  const searchDocs: SearchDoc[] = parsedNotes.map((p) => ({
    slug: p.slug,
    title: p.title,
    url: `/${p.slug}`,
    text: markdownToText(p.markdown),
  }));
  const searchIndex: SearchIndex = { docs: searchDocs };
  await fs.writeFile(
    path.join(outDir, 'search-index.json'),
    JSON.stringify(searchIndex),
    'utf8',
  );

  // manifest
  const routes: RouteEntry[] = [
    ...parsedNotes.map((n) => ({
      slug: n.slug,
      kind: 'note' as const,
      title: n.title,
    })),
    ...parsedCanvases.map((c) => ({
      slug: c.slug,
      kind: 'canvas' as const,
      title: c.title,
    })),
    ...parsedQuizzes.map((q) => ({
      slug: q.slug,
      kind: 'quiz' as const,
      title: q.title,
    })),
    // Generated tag decks are routes too (so `/tags/<tag>` dispatches, is
    // prerendered, and lands in the sitemap) — but they are NOT passed to
    // buildNav below, so no nav leaf / `tags` folder is created.
    ...tagDecks.map((q) => ({
      slug: q.slug,
      kind: 'quiz' as const,
      title: q.title,
    })),
  ];
  routes.sort((a, b) => a.slug.localeCompare(b.slug));

  // Home: an explicit "home" note, else a root-level welcome/index note
  // (Obsidian Publish's configured homepage isn't stored in the local vault),
  // else the first route.
  const homeHints = ['добро пожаловать', 'welcome', 'home', 'index', 'readme'];
  const isRoot = (n: NoteEntry) => !n.relPath.includes('/');
  const explicitHome = opts.homeNote?.trim().toLowerCase();
  const homeNote =
    (explicitHome
      ? notes.find((n) => n.base.toLowerCase() === explicitHome) ??
        notes.find((n) => n.slug === pathToSlug(opts.homeNote!.trim()))
      : undefined) ??
    notes.find((n) => n.base.toLowerCase() === 'home') ??
    notes.find(
      (n) =>
        isRoot(n) &&
        homeHints.some((h) => n.base.toLowerCase().includes(h)),
    );
  const homeSlug = homeNote
    ? homeNote.slug
    : routes.length
      ? routes[0].slug
      : '';

  const nav = buildNav([
    ...parsedNotes.map((n) => ({
      slug: n.slug,
      title: n.title,
      type: 'note' as const,
    })),
    ...parsedCanvases.map((c) => ({
      slug: c.slug,
      title: c.title,
      type: 'canvas' as const,
    })),
    ...parsedQuizzes.map((q) => ({
      slug: q.slug,
      title: q.title,
      type: 'quiz' as const,
    })),
  ]);

  const manifest: Manifest = {
    site: {
      title: opts.siteName?.trim() || path.basename(vaultDir),
      homeSlug,
      defaultTheme: 'light',
      url: (opts.siteUrl ?? '').replace(/\/+$/, ''),
      description: opts.siteDescription?.trim() || '',
      lang: opts.siteLang?.trim() || 'en',
      footer: opts.siteFooter?.trim() || '',
    },
    routes,
    nav,
  };
  await fs.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

/** Parse frontmatter `tags` into a flat, deduped string list. Handles the
 *  shapes Obsidian writes: a flow/block YAML list (`[a, b]` / `- a`), a
 *  comma-separated string (`a, b` — gray-matter yields one string), or a
 *  bare string. Strips a leading `#` (Obsidian accepts `tags: "#foo"`) and
 *  keeps nested tags (`foo/bar`) as-is. */
function parseTags(data: Record<string, unknown>): string[] {
  const raw = data.tags;
  if (raw == null) return [];
  const out = new Set<string>();
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(collect);
    } else if (typeof v === 'string') {
      for (const t of v.split(',')) {
        const tag = t.trim().replace(/^#/, '');
        if (tag) out.add(tag);
      }
    }
  };
  collect(raw);
  return [...out];
}

/** Strip markdown syntax to readable plain text (for search scoring/snippets
 *  and embeddings). Keeps link/wikilink display text, drops code/markup. */
function markdownToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!\[\[[^\]]*\]\]/g, ' ') // embeds
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[target|alias]] -> alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[target]] -> target
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/^>+\s?/gm, '') // blockquote markers
    .replace(/^#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // list bullets
    .replace(/[*_~]{1,3}/g, '') // emphasis markers
    .replace(/<[^>]+>/g, ' ') // raw html tags
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract a section starting at the given heading until the next heading of
 *  equal/higher level. Heading matched by slugified comparison. */
function extractSection(content: string, heading: string): string {
  const targetSlug = new GithubSlugger().slug(heading);
  const lines = content.split('\n');
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (!m) continue;
    if (new GithubSlugger().slug(m[2].trim()) === targetSlug) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return content;
  const out: string[] = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= startLevel) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

interface NavEntry {
  slug: string;
  title: string;
  type: 'note' | 'canvas' | 'quiz';
}

/** Build a folder tree NavNode[] from note/canvas slugs. */
function buildNav(entries: NavEntry[]): NavNode[] {
  const root: NavNode[] = [];
  const sorted = [...entries].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const entry of sorted) {
    const parts = entry.slug.split('/');
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      let folder = level.find(
        (nd) => nd.type === 'folder' && nd.name === name,
      );
      if (!folder) {
        folder = { type: 'folder', name, children: [] };
        level.push(folder);
      }
      level = folder.children!;
    }
    level.push({ type: entry.type, name: entry.title, slug: entry.slug });
  }
  // Folders first, then notes/canvases, each alphabetically (Obsidian order).
  const sortLevel = (nodes: NavNode[]): void => {
    nodes.sort(
      (a, b) =>
        (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1) ||
        a.name.localeCompare(b.name),
    );
    for (const node of nodes) {
      if (node.children) {
        sortLevel(node.children);
      }
    }
  };
  sortLevel(root);
  return root;
}
