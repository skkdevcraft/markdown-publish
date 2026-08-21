# Quiz decks — feature spec

Anki-style self-graded review sessions over tag-matched notes. A `.quiz.json`
file in the vault defines a deck; the parser resolves which notes belong to it
at build time; the Angular app runs the session entirely client-side with
per-card stats persisted in `localStorage` (no backend).

Status: implemented

---

## 1. Quiz file format & discovery

- **Extension:** `*.quiz.json` — self-documenting double extension; editors
  get JSON highlighting; mirrors the `.canvas` precedent (dedicated extension
  for a JSON-encoded vault artifact). Files may live **anywhere** in the vault
  (no folder requirement) — the folder drives nav position like notes/canvases.
- **Glob:** `**/*.quiz.json` with the same ignore rules as the other walks
  (`.obsidian/**`, `.trash/**`, dot: false, `caseSensitiveMatch: false`).
- **Slug:** strip the compound `.quiz.json` before slugification, then reuse
  `pathToSlug`. Example: `Quiz/Spanish.quiz.json` → `quiz/spanish`.
  (Plain `pathToSlug` strips only the last extension and would yield the ugly
  `quiz/spanish.quiz`.)
- **Collision:** if a note/canvas already owns the slug, **skip the quiz with
  a console warning** (the note wins the route; a slug collision is author
  error, same soft-skip policy as semantic validation below).

**Schema:**

```json
{
  "title": "Spanish",
  "description": "Do you remember these words?",
  "tags": ["quiz", "spanish"]
}
```

| Field | Required | Default / behavior |
|---|---|---|
| `title` | no | fall back to file basename minus `.quiz.json` (mirrors notes: fm title → H1 → basename) |
| `description` | no | `''` |
| `tags` | **yes** | non-empty array of strings; else the file is **skipped with a console warning** |

**Error policy (canvas precedent):** unparseable JSON → **hard build error**
(`JSON.parse` throws, same as `.canvas`). Semantic errors — `tags` missing,
empty, or not an array of strings — → **skip file with console warning**
(a bad tag list shouldn't block publishing).

Tag normalization: strip leading `#`, trim, drop empties, dedupe (mirror
`parseTags` for notes).

## 2. Build-time tag matching (parser side)

Matching runs **at build time** against the **mode-filtered** note set, so
private notes never leak into quizzes in `public` builds automatically.

- **Semantics:** a note is in the deck iff it has **all** quiz tags.
- **Case-insensitive** — `Spanish` matches `spanish`.
- **Nested tags (Obsidian semantics):** `noteTag === quizTag` **or**
  `noteTag.startsWith(quizTag + '/')` (both case-insensitive). `spanish`
  matches `spanish/verbs`; `spanish/verbs` matches `spanish/verbs/past`.
- **Zero-match:** the quiz is still emitted with `notes: []` and the view
  shows an empty state ("No notes match these tags yet"). Distinct from
  empty-`tags` (schema error → skip): zero matches is a legitimate content
  state the author should be able to see and fix.

**Emitted bundle** — `src/content/quiz/<slug>.json` (sorted by slug for
reproducible builds):

```json
{
  "slug": "quiz/spanish",
  "title": "Spanish",
  "description": "Do you remember these words?",
  "tags": ["quiz"],
  "notes": [
    { "slug": "quiz/palabra", "title": "Palabra" },
    { "slug": "quiz/word", "title": "Word" }
  ]
}
```

`notes: {slug, title}[]` (not bare slugs) because the card face and end screen
need titles without fetching every note; bodies are still fetched on demand.

## 3. Shared content model

New `shared/content-model/quiz.ts` (+ export in `index.ts`):

```ts
export interface Quiz {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  notes: { slug: string; title: string }[];
}
```

`RouteEntry.kind` gains `'quiz'`; `NavNode.type` gains `'quiz'`
(`shared/content-model/manifest.ts`).

## 4. ContentService

- `ContentService.loadQuiz(slug)` → `read<Quiz>('quiz/' + safeSlug(slug) + '.json')`
  (same `safeSlug` traversal guard as `loadNote`).
- `ServerContentService` inherits it (filesystem read) — no changes needed.
- `app.spec.ts` `contentStub` gains a `loadQuiz` that throws "not stubbed"
  like the others.

## 5. Routing, nav, SEO

- **Manifest:** quiz routes added to `routes` (`kind: 'quiz'`) alongside notes
  and canvases; `buildNav` entries gain `type: 'quiz'` leaves.
- **Nav tree (`nav-tree.ts`):** `@else` leaf branch handles `'quiz'` with its
  own icon (question-mark/check style, mirroring the canvas icon).
- **RouteDispatch:** template gains `@case ('quiz')` → `<app-quiz-view [slug]="slug()" />`;
  imports `QuizView`. No SEO change in RouteDispatch — **QuizView sets its own
  SEO** (like NoteView): title = quiz title, description = quiz description,
  `type: 'website'`, path `'/' + slug`. (RouteDispatch keeps covering canvases
  and 404s only.)
- **Prerender:** quiz routes land in `manifest.routes`, so the `**` catch-all
  in `app.routes.server.ts` (`getPrerenderParams`) prerenders them — no change.
- **Pagefind:** quiz pages are indexed automatically (they're prerendered
  HTML). Intended — a searchable quiz is a feature. In-session note bodies are
  client-side only and never enter the index.

**Out of scope (agreed):** no link-graph nodes, no WebMCP tools, no
search-index schema changes.

## 6. Wikilinks

Parser gains a `quizByBase` basename index (mirroring `canvasByBase`);
`resolveLink` resolves quiz targets. Basename retains `.quiz` (i.e.
`baseName('Quiz/Spanish.quiz.json')` = `Spanish.quiz`), so **`[[Spanish.quiz.json]]`
resolves to the quiz route**; plain `[[Spanish]]` does not (would collide with
notes). Basename-only, same limitation as canvases.

## 7. Quiz view (`src/app/views/quiz-view.ts`)

Standalone, OnPush, signals + `resource()`, input `slug` — following
`NoteView` conventions. Three screens in a state machine (signal `screen`:
`'start' | 'session' | 'end'`).

### 7.1 Start screen (default, and the SSR/prerendered shell)

- Quiz title, description, matched-note count ("12 notes").
- Cumulative progress (browser only): "9 of 12 reviewed · 7 known".
- **"Start quiz"** button → shuffle pool (Fisher–Yates) → `session`.
- Empty pool → "No notes match these tags yet" message, no start button.
- This screen doubles as the crawlable HTML (title + description + counts) —
  also why it's the default: opening the route must not auto-start a session
  for crawlers/link previews, and the description needs a home.

### 7.2 Session

- Header: quiz title + **"n remaining"** (queue length) + **"End session"**.
- Card face: the note's **title** as the prompt (body hidden), three buttons.
- Queue semantics (agreed):
  - **"I know it"** → grade `known`, card leaves the queue.
  - **"Ask me again"** → grade `again`, card moves to the **end** of the queue.
  - **"Remind me"** → reveals the note body inline (see below); the card stays
    put — no grade yet.
  - Queue empties → `end` screen. (Because "Ask me again" keeps the queue
    alive, "End session" is the explicit exit.)
- **Reveal (Q7, option B — reveal-then-grade):** "Remind me" lazily fetches
  the body via `loadNote(slug)` (cached per session), renders it
  DOMPurify-sanitized (`bypassSecurityTrustHtml`, mirroring NoteView's
  browser path), and **disables itself** (content already shown). The other
  two buttons stay active — the user can still grade honestly. A subtle
  **"Open note →"** link to the full note page appears after reveal.
- **Session state is ephemeral:** navigating away ends the session; returning
  reshuffles. Grades survive via write-through (below). No resume support.

### 7.3 End screen

- Session summary: "This session: 8 known · 3 again".
- Per-card list: title + cumulative counts ("Word — 5 known · 2 again") and
  `lastResult`.
- **"Restart quiz"** → reshuffle → `session`.

## 8. Statistics & persistence

Per-card cumulative stats only — no SRS intervals/due dates (the loop is
random by design), no per-session history arrays (no trends in v1).

```ts
interface CardStats {
  known: number;       // "I know it" presses
  again: number;       // "Ask me again" presses
  lastResult: 'known' | 'again';
  lastSeen: number;    // epoch ms
}
```

- **Key:** one per quiz, namespaced + versioned:
  `markdown-publish:quiz-stats:<quizSlug>` (prefix guards against other
  localStorage users on the origin).
- **Value:** `{ version: 1, cards: { [noteSlug]: CardStats } }` — `version`
  field for future migrations.
- **Write-through on every grade** — a mid-session reload must not lose
  grades. Reads happen when the quiz loads (browser only).
- **Stale entries** (notes that left the pool after a rebuild): kept —
  harmless, tiny; simpler than pruning.
- **Renaming a quiz file resets its history** (new key) — accepted.
- **SSR guard:** all `localStorage` access behind `isPlatformBrowser`; the
  server renders the static start screen with no stats.

## 9. Fixtures

- **New** `tools/fixtures/vault/Quiz/Spanish.quiz.json`:
  `{ "title": "Spanish", "description": "Do you remember these words?", "tags": ["quiz"] }`
- **Tag `Secret.md`** with `quiz` (frontmatter `tags: [quiz]`) so the mode
  filter is exercised: full mode → deck = `Word`, `Palabra`, `Secret`;
  public mode → `Word`, `Palabra` only. Adding a tag changes no existing
  assertions (routes/wikilinks/sitemap sets are untouched).

## 10. Tests

1. **`tools/cli/build.test.mjs`** (full pipeline, full mode — default):
   - `content/quiz/quiz/spanish.json` exists; `title === 'Spanish'`,
     `tags === ['quiz']`, `notes` = `[{quiz/palabra, Palabra},
     {quiz/secret, Secret}, {quiz/word, Word}]` (sorted).
   - `content/manifest.json` routes contain
     `{ slug: 'quiz/spanish', kind: 'quiz', title: 'Spanish' }`.
   - nav contains a `type: 'quiz'` node under the `quiz` folder.
   - prerendered page exists (`quiz/spanish/index.html`).
   - sitemap contains the quiz URL.
2. **New parser-level public-mode test** (node:test spawning
   `tsx tools/vault-parser/run.ts` with `BUILD_MODE=public` +
   `CONTENT_OUT` = temp dir — fast, no `ng build`): deck `notes` excludes
   `secret`, proving private notes never reach quizzes in public builds.
3. **`src/app/views/quiz-view.spec.ts`** (Vitest + TestBed, `app.spec.ts`
   conventions; stubbed ContentService with `loadQuiz`; jsdom `localStorage`):
   - start screen renders (title, description, count); empty pool state.
   - Start → session; "I know it" advances + writes the localStorage key
     (format + fields).
   - "Ask me again" re-queues to the end.
   - "Remind me" fetches + reveals the body, disables itself, shows the
     "Open note" link; card not graded.
   - queue empty → end screen with session summary + per-card cumulative.
   - "End session" → end screen; "Restart quiz" reshuffles.
   - no `localStorage` (SSR simulation) → renders without crashing.

## 11. Docs & release

- **README.md:** feature bullet — "Quiz decks — `.quiz.json` files turn
  tag-matched notes into self-graded Anki-style review sessions, stats kept in
  your browser." + mention quiz decks in the "How it works" line (content
  bundle now ships quiz decks).
- **AGENTS.md:** §1 (content bundle includes quiz decks), §3 (`src/content`
  gains `quiz/`; `shared/content-model` gains `quiz.ts`; `tools/vault-parser`
  gains quiz parsing), §7 (new public-mode parser test), §8 conventions
  (new `RouteEntry.kind: 'quiz'`, `NavNode.type: 'quiz'`).
- **npm publish:** no `package.json` `files` changes — `tools/`, `src/`,
  `shared/` ship automatically; fixtures stay excluded.
- **Version bump:** v1.0.6 → v1.1.0 (minor) — release management, not part of
  implementation.

## 12. Explicitly out of scope

- Link-graph nodes for quizzes; WebMCP tools; search-index changes.
- SRS scheduling (intervals, due dates), per-session history/trends.
- Session resume across navigations; cross-device stats sync.
- Auto-start on route open (start screen is deliberate).

## 13. File-by-file change list

**Parser / build:**
- `tools/vault-parser/parse-vault.ts` — quiz glob + walk, `quizByBase` for
  wikilinks, build-time tag matching, `notes` bundle emission,
  `src/content/quiz/`, manifest routes + nav entries.
- `tools/vault-parser/quiz.ts` *(new)* — schema validation, tag normalization,
  matching helper (mirrors `canvas.ts` structure).

**Shared model:**
- `shared/content-model/quiz.ts` *(new)* — `Quiz` interface.
- `shared/content-model/manifest.ts` — `RouteEntry.kind: 'quiz'`,
  `NavNode.type: 'quiz'`.
- `shared/content-model/index.ts` — export `quiz`.

**Angular:**
- `src/app/content/content.service.ts` — `loadQuiz`.
- `src/app/views/quiz-view.ts` *(new)* — the view (§7) + stats (§8) + SEO (§5).
- `src/app/views/route-dispatch.ts` — `@case ('quiz')` + import.
- `src/app/nav/nav-tree.ts` — quiz leaf icon.
- `src/app/app.spec.ts` — `loadQuiz` in `contentStub`.
- `src/app/views/quiz-view.spec.ts` *(new)* — §10.3.

**Fixtures / tests / docs:**
- `tools/fixtures/vault/Quiz/Spanish.quiz.json` *(new)*.
- `tools/fixtures/vault/Secret.md` — add `tags: [quiz]`.
- `tools/cli/build.test.mjs` — §10.1 assertions.
- `tools/cli/quiz-public-mode.test.mjs` *(new)* — §10.2.
- `README.md`, `AGENTS.md` — §11.
