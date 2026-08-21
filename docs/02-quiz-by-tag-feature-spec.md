# Quiz by tag — feature spec

Status: ready-for-agent

A **Tags index view** (`/tags`) listing every frontmatter tag with its note
count, where clicking a tag opens a **quiz deck of the notes carrying that
tag**. The deck is generated at build time as a virtual quiz (one tag) and
served by the existing quiz machinery — no new quiz UI. Side effect: inline
`#tag` mentions in note bodies, which today render as dead links to a
non-existent `/tags/...` route, become real links to the tag's quiz.

---

## Problem Statement

Tagged notes are the natural unit of review in this tool — a `.quiz.json`
deck is just "notes matching these tags" — but today the only way to quiz by
tag is to hand-write a deck file for every tag you care about. And the
markdown renderer already *emits* links for inline `#tags` pointing at a
`/tags/<tag>` route that does not exist, so every inline tag in every note is
a dead link. Visitors have no way to discover what topics exist on the site,
how much content each has, or to review a topic on demand.

## Solution

From the visitor's perspective:

- A **"Tags" link** in the sidebar opens `/tags`, an index page listing every
  tag in the vault with a count of notes carrying it, sorted by count
  (descending) so the biggest topics surface first.
- Clicking a tag opens `/tags/<tag>` — a **quiz deck** of exactly the notes
  counted, using the exact same start → session → end flow, grading, reveal,
  and browser-persisted stats as hand-written quiz decks.
- Nested tags work like they do in Obsidian: `spanish` counts (and quizzes)
  notes tagged `spanish/verbs`, and `spanish/verbs` is its own entry too.
- Inline `#tags` in note bodies now link to the tag's quiz when one exists;
  inline tags with no tag page render as plain text — never a dead link.
- Private notes never appear in tag counts or tag quizzes on public builds.

From the author's perspective: no new vault files — every frontmatter tag
automatically gets a deck. Hand-written decks, notes, and canvases always win
slug conflicts, and generated tag quizzes are kept out of the sidebar nav.

## User Stories

1. As a site visitor, I want to see a "Tags" link in the sidebar, so that I can discover the site's content by topic.
2. As a site visitor, I want to see every tag alongside a count of notes carrying it, so that I can judge which topics are worth reviewing.
3. As a site visitor, I want tags sorted by note count descending, so that the biggest topics appear first.
4. As a site visitor, I want to click a tag and open a quiz of the notes carrying it, so that I can review a topic on demand without hunting for a deck file.
5. As a site visitor, I want the tag quiz to use the exact existing quiz flow (start screen, session, end screen, "Remind me", per-card stats), so that there is no new quiz UI to learn.
6. As a site visitor, I want my per-tag quiz grades persisted in the browser, so that my progress survives reloads and later visits.
7. As a site visitor, I want the count shown next to a tag to equal the number of cards in its quiz, so that the number is never misleading.
8. As a site visitor, I want nested tags to follow Obsidian semantics — `spanish` includes `spanish/verbs` notes and `spanish/verbs` is its own row — so that counts and decks match my Obsidian tag pane mental model.
9. As a site visitor, I want case variants of a tag (`Spanish`, `spanish`) to collapse into one entry, so that the index doesn't split one topic.
10. As a site visitor, I want the tag quiz page to be a real, shareable, crawlable page with a proper title and description, so that it works in link previews and search engines.
11. As a site visitor, I want inline `#tag` mentions in note bodies to link to the tag's quiz, so that tags are navigable from the content itself.
12. As a site visitor, I want an inline tag with no tag page to render as plain text, so that I never hit a dead link.
13. As a site visitor on a subpath deployment, I want tag links to be base-relative, so that they work under a GitHub Pages project site.
14. As a site visitor, I want the Tags index page itself to be a real page with a title and description, so that it is shareable and indexed.
15. As a vault author, I want every frontmatter tag to automatically get a quiz deck, so that I don't have to hand-write a deck per tag.
16. As a vault author, I want my hand-written notes, canvases, and quiz decks to win slug conflicts with generated tag quizzes, so that my content is never shadowed.
17. As a vault author, I want a tag whose slug collides with a real route to be dropped from the index with a build warning, so that no dead links appear in the index.
18. As a vault author, I want two distinct tags that slugify the same (`foo bar`, `foo-bar`) to both stay reachable via deterministic suffixing, so that no tag is silently unreachable.
19. As a vault author, I want generated tag quizzes excluded from the sidebar nav, so that a vault with many tags doesn't drown the navigation tree.
20. As a vault author, I want tag quizzes excluded from the link graph, the search index, and WebMCP tools, consistent with the existing quiz convention, so that generated content doesn't pollute those surfaces.
21. As a vault author, I want generated tag decks and the index to be deterministic across builds, so that output is reproducible.
22. As a deployer, I want tag quiz pages prerendered and listed in the sitemap, so that they load fast and are indexable.
23. As a deployer, I want private notes kept out of tag counts and tag quizzes in `public` builds, so that the publish-mode filter holds for tags too.

## Implementation Decisions

### 1. Tag quizzes are virtual decks, reused wholesale

A "tag quiz" is a quiz deck with exactly one tag: `tags: [<tag>]`, notes
matched by the existing `noteInDeck` helper (all tags required,
case-insensitive, Obsidian nested-tag semantics). Decks are generated at
build time by the vault parser; the Angular app renders them through the
existing `QuizView` and `RouteDispatch` with **zero changes** to the quiz UI,
stats, reveal, or SEO logic. A dedicated simplified quiz component was
considered and rejected: it would duplicate the session loop, grading, and
reveal for no user-visible gain.

### 2. Tag source: frontmatter only (v1)

The index and the generated decks are computed exclusively from frontmatter
`tags:` (the same source the parser already collects into `note.tags` and the
same source hand-written decks match against). Inline `#tags` in body text
are **not** collected into the index. This keeps one source of truth for
"what counts as a tag" and guarantees a generated deck agrees with a
hand-written deck for the same tag. Inline-tag collection is a clean,
separable extension later.

### 3. Counting semantics = deck semantics

Index counts are produced by the **same** `noteInDeck` call that builds each
deck, so **the count shown is exactly the deck's `notes.length`**. Nested
tags are counted with Obsidian semantics: the `spanish` row counts notes
tagged `spanish` **or** `spanish/...`; `spanish/verbs` is its own row
counting notes tagged exactly `spanish/verbs` or deeper. Counts may overlap
across rows (a note tagged `spanish/verbs` counts under both) — mirroring
Obsidian's tag pane. Case variants group case-insensitively (forced: matching
is already case-insensitive); the **display casing is the most frequently
used**, tie-broken by slug order for determinism.

### 4. URL scheme

- `/tags` — the index (exact route, registered ahead of the catch-all).
- `/tags/<tag>` — the tag's quiz, where `<tag>` is the **per-segment
  slugified** tag: `spanish/verbs` → `tags/spanish/verbs`; `foo bar` →
  `tags/foo-bar`. Slugs follow the repo's existing slug philosophy (split on
  `/`, slugify each segment, join with `/`) so nested URLs mirror the tag
  hierarchy.
- Two distinct tags slugifying to the same route get deterministic suffixes
  (`tags/foo-bar`, `tags/foo-bar-2`, …) assigned in canonical-name order, so
  both stay reachable.
- All generated hrefs (inline tag links, index links) are **base-relative**
  (no leading slash) per the repo's subpath-deployment invariant.

### 5. Routing & nav registration

Each generated tag quiz is registered in the manifest's `routes` as
`kind: 'quiz'` with title `#<display>`, which buys — for free, from existing
machinery — route dispatch via `RouteDispatch`, `QuizView` rendering,
localStorage stats keyed by the tag slug, `QuizView`-owned SEO,
prerendering (manifest-driven), and sitemap inclusion, and keeps tag quizzes
out of the link graph, search index, and WebMCP tools (the established quiz
convention). Generated tag quizzes are **excluded from `nav`** — the parser
simply doesn't pass them to the nav builder, so a tags-heavy vault doesn't
clutter the sidebar.

### 6. Collision policy

If a real note/canvas/quiz owns the slug `tags/<tag>`, the generated deck is
skipped **and the tag is dropped from the index**, with a console warning —
nothing in the index ever points at a route that doesn't exist. The real
route wins untouched. (Accepted, documented edge: a note with slug exactly
`tags` would be shadowed by the new index route; rare and acceptable.)

### 7. Index data & view

A new content-bundle file carries the index (lean by design — quiz bodies
stay in their per-tag deck files):

```ts
// shared content model (from the agreed design)
export interface TagIndex { tags: TagEntry[] }
export interface TagEntry {
  name: string;  // display casing (most-frequent)
  slug: string;  // 'tags/<slugified>' — matches the generated route
  count: number; // deck notes.length — the card count the quiz will have
}
```

Entries sorted **count descending, then name ascending** (deterministic). A
new `TagsView` component loads the index through a new `ContentService`
loader (the server-side variant inherits it), renders rows as `#name` pills
with count badges linking to `/<slug>`, and sets its own SEO (title "Tags",
description mentioning the tag count, canonical `/tags`). The sidebar gains a
"Tags" link beside the existing graph link.

### 8. Generated deck shape

Per-tag deck files carry the standard `Quiz` shape (title/description/tags/
notes), with:

- `title`: `#<display>` — the start screen H1 reads "Quiz / #Spanish",
  unambiguous that this is a tag.
- `description`: `<n> notes tagged #<display>` (pluralized: "1 note …").
- `tags`: `[<display>]` — inert in the UI but consistent with deck files.
- `notes`: slug-sorted `{slug, title}[]`, exactly as hand-written decks emit.

### 9. Inline tag links (markdown renderer)

The inline tag rule stops emitting a link unconditionally. The parser
computes the set of **linkable tag slugs** (the slugs that survived collision
filtering) *before* rendering — frontmatter is parsed in an earlier pass, so
the set is known — and passes it to the markdown renderer factory; the tag
rule consults it:

- tag has a route → `<a class="tag" href="tags/<slug>">#<raw></a>`
  (base-relative — this also fixes the old root-absolute href that would
  break on subpath sites).
- no route → the raw `#tag` renders as plain text (no anchor).

Canvas-rendered text gets the same behavior for free (the renderer factory is
shared). Note: the inline rule's match regex is ASCII-only — Cyrillic inline
tags don't link today and still won't (pre-existing limitation); Cyrillic
frontmatter tags work fully via Unicode-aware slugs.

### 10. Mode filter & determinism

Index and decks are computed from the **mode-filtered** note set, so public
builds never leak private notes into tag counts or tag quizzes. Everything
(tag grouping, suffixing, deck/notes ordering, index sorting) is ordered
deterministically for reproducible builds.

## Testing Decisions

**What makes a good test here:** assert external behavior — the emitted
bundle (index contents, deck contents, manifest routes/nav), the prerendered
HTML (index page, tag quiz page, inline tag links in note HTML), and the
mode filter — not parser internals. No component-level tests for the new view
are needed: its real output (prerendered `tags/index.html`) is exercised
through the full build, which is a higher-value assertion than a stub-driven
render.

**Seams (two existing, one new — all at the highest practical levels):**

1. **Full-pipeline E2E test** (extends the existing build test, which runs
   parse → Angular SSG → pagefind → SEO/OG against the fixture vault):
   - `tags.json` exists with the exact expected entry for the fixture.
   - manifest routes contain `tags/quiz` (`kind: 'quiz'`, title `#quiz`);
     nav contains no `tags/quiz` leaf.
   - the generated deck file exists and matches the hand-written Spanish
     deck's note set (same 3 notes, slug-sorted).
   - `tags/quiz/index.html` is prerendered and listed in the sitemap.
   - prerendered `tags/index.html` renders the tag pill + count + link.
   - Home.md's HTML has a base-relative `href="tags/quiz"` for an inline tag
     that has a route, and **no** `href="tags/project"`/`href="tags/idea"`
     for inline tags that don't (plain-text rendering, no dead links).
2. **Parser-level public-mode test** (extends the existing fast public-mode
   test): in a `public` build the `quiz` tag counts only the two public
   notes and the generated deck excludes the private one.
3. **New parser-level tag-index test** (new file, same fast spawn pattern as
   the public-mode test, but with a **synthetic temp vault** — the fixture
   has a single tag, so the semantics matrix needs crafted input):
   - case-insensitive grouping and most-frequent display casing;
   - nested counts (`spanish/verbs` under `spanish`, both rows present) and
     the count ≡ deck-size invariant for every entry;
   - per-segment slugs (`spanish/verbs` → `tags/spanish/verbs`, `foo bar` →
     `tags/foo-bar`);
   - slug-suffix disambiguation (`foo bar` vs `foo-bar`);
   - real-route collision: deck skipped, tag dropped from the index, build
     exits 0 (warning only).

**Prior art:** the existing build test's quiz-deck assertions (manifest
route, nav leaf, prerendered page, sitemap URL) and the existing
public-mode parser test's spawn-and-assert pattern are the templates; the new
tag-index test is the same pattern pointed at a temp vault.

## Out of Scope

- Collecting inline `#tags` into the tag index (frontmatter only in v1).
- Cyrillic inline-tag matching in the markdown rule (frontmatter Cyrillic
  works via Unicode slugs).
- WebMCP tag tools; tag nodes in the link graph; search-index entries for
  tags or generated decks (existing quiz convention holds).
- Tag management UI, tag renaming/merging, or editing frontmatter from the
  site.
- Changes to the quiz session itself (SRS scheduling, resume, sync — all
  still out of scope per the quiz feature spec).
- A dedicated component test for the Tags view (covered by E2E prerender
  assertions — see Testing Decisions).
- The pre-existing shadowing of a note whose slug is exactly `tags` by the
  new index route (documented, accepted).

## Further Notes

- **Fixture tweak for testability:** add an inline `#quiz` mention to the
  fixture home note's existing tag line (`#project #idea #quiz`) so the E2E
  test can assert both the positive (link emitted, base-relative) and
  negative (plain text) inline-tag behaviors in one place. Fixture changes
  don't ship in the npm package — fine, tests run pre-publish.
- **Stats & tags:** quiz stats are keyed by deck slug, so each tag gets its
  own cumulative history; renaming a tag changes its slug and resets that
  history (accepted — same policy as renaming a deck file). Stale stat
  entries for notes that left a tag after a rebuild are kept (existing
  policy).
- **Pagefind:** tag quiz pages and the index page are prerendered HTML and
  get indexed automatically — intended, consistent with hand-written quiz
  pages.
- **Docs:** README feature bullet ("Quiz by tag — every frontmatter tag is
  automatically a quiz deck, browsable from the Tags view") and AGENTS.md
  updates (content bundle gains `tags.json` + generated decks under the quiz
  output; conventions: generated tag quizzes are manifest routes excluded
  from nav). Version bump (minor) is release management, not part of
  implementation.
