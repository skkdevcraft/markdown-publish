# Dedicated search page — feature spec

Status: implemented

A **dedicated search page** at `/search` with a search bar and a **Search
button**. Searching runs on submit (button click or Enter), never while
typing, and results render inline on the page below the bar — no popup,
scrollable. It replaces the sidebar's keystroke-driven dropdown popup, whose
now-dead component is deleted.

---

## Problem Statement

Search used to live entirely in the sidebar as a dropdown: typing in the box
searched on a 150 ms debounce and a floating results panel opened under the
input. That works for a quick jump, but it has no dedicated URL, the panel is
small (`min(60vh, 480px)`) and easy to lose, results are throttled by the
debounce, and behavior is easy to trigger by accident just by typing. There is
no way to open search, type a query calmly, and read a scrollable list of
matches in the main content area.

## Solution

From the visitor's perspective:

- The sidebar keeps its search-box look, but it is now a **link** to `/search`
  (like the existing "Graph view" and "Tags" entries), not an input that
  searches in place.
- `/search` shows a real page: a search bar and a **Search** button, with
  results appearing **below the bar in the same page** — no dropdown/popup.
- **Search runs only on submit** (button click or Enter). Typing does nothing
  until the button is pressed.
- The list is **scrollable with the page** (the app's existing scroll
  container); up to **50** results render, no pagination.
- On desktop the search bar **sticks to the top** of the content area while
  results scroll under it. On mobile it scrolls normally (the fixed nav
  toggle owns that corner).
- The states are honest: a hint before searching, "Searching…" while in
  flight, `No results for "…"` for a genuine empty result, and "Search is
  unavailable right now" when the search index cannot be loaded — an empty
  list is never used to mean "broken".
- `Ctrl/Cmd+K` navigates to `/search` and focuses the input from anywhere.

From the author's perspective: nothing changes — the page is static, backed
by the content bundle's search index, and works offline and under a subpath
deployment.

## User Stories

1. As a site visitor, I want a dedicated search page, so that I can search in the main content area instead of a small floating panel.
2. As a site visitor, I want a search bar and a Search button, so that the action is explicit.
3. As a site visitor, I want search to run only when I press the Search button (or Enter), so that typing does not fire searches I did not ask for.
4. As a site visitor, I want results displayed below the search bar on the same page, so that there is no popup to dismiss.
5. As a site visitor, I want to scroll the results, so that I can read through more than a few matches.
6. As a site visitor, I want the search bar to stay visible on desktop while I scroll results, so that I can refine and re-search without scrolling back up.
7. As a site visitor, I want highlighted excerpts for each result, so that I can see why a note matched.
8. As a site visitor, I want clicking a result to open that note, so that search is a navigation tool.
9. As a site visitor, I want a clear indication when there are no matches, so that I know the search completed.
10. As a site visitor, I want to be told when search is unavailable rather than shown an empty list, so that a broken index is not mistaken for "no results".
11. As a site visitor, I want the Search button disabled while the query is empty, so that I cannot fire a no-op search.
12. As a site visitor, I want `Ctrl/Cmd+K` to take me to the search page and focus the input, so that the power-user shortcut still works.
13. As a site visitor, I want the sidebar search entry to still look like a search box, so that I recognize where to search.
14. As a mobile visitor, I want the search bar to not collide with the menu button, so that the page is usable on a phone.
15. As a site visitor on a subpath deployment, I want the search page and its results to be base-relative, so that search works under a GitHub Pages project site.
16. As a site visitor, I want the search page to have a proper title and canonical, so that it is shareable.
17. As a vault author, I want the dedicated page to reuse the existing client-side search index, so that I do not maintain a second search system.
18. As a deployer, I want `/search` prerendered and in the sitemap but out of `llms.txt`, so that it matches the other chrome pages (`/graph`, `/tags`).

## Implementation Decisions

### 1. One client-side engine, shared with WebMCP

The page is backed by `SearchService` over `content/search-index.json` — the
same keyword index (and the same scoring) that backs the WebMCP `search_notes`
agent tool. Because the index already ships with the content bundle, there is
no separate index to build or load, search works in `ng serve` and offline,
and base-relative behavior comes from the normal `<base href>` handling.

An earlier revision used Pagefind (client-side import of `pagefind/pagefind.js`).
It was removed as a dependency: the 582 KB keyword index was already shipped
for WebMCP, and maintaining two search systems (Pagefind's index plus the
keyword one) bought language-aware stemming at the cost of an extra ~2.5 MB of
build output and a second engine to keep in sync. The accepted regression is no
stemming/typo tolerance (searching `correr` no longer matches `corriendo`;
searching `corr` still does). Search covers notes only — the same scope as
before, since `NoteView` was the only page marked for Pagefind indexing.

### 2. Search on submit only

There is no `ngModelChange`-driven search and no debounce: `submit()` runs
from `<form (ngSubmit)>` (button or Enter). While a search is in flight the
button is disabled and a repeat submit is ignored.

### 3. Results render inline, capped, and page-scroll

Rows are buttons (title + excerpt) rendered in the page, not positioned. At
most 50 rows are shown; there is no pagination and no "N results" total
(the index has no cheap total, and a count is not needed for navigation). The page
scrolls in `.site-main`, the app's single existing scroll container, so no
nested scroll region is introduced.

### 4. Sticky bar on desktop only

`.search-form` is `position: sticky; top: 0` with an opaque background and a
bottom border so rows scroll under it. Under `768px` it is `position: static`:
the fixed `.nav-toggle` (40×40 at `top: 8px; left: 8px`) would otherwise sit on
top of the bar.

### 5. Explicit unavailable state

A failed `search-index.json` load sets `status = 'error'` and shows a distinct
message. It never falls through to "no results". The failed load is not cached,
so a later search can retry.

### 6. Chrome-page route + SEO

Registered as an exact-match route (`pathMatch: 'full'`) in `app.routes.ts`
and as `RenderMode.Prerender` in `app.routes.server.ts`, mirroring `/graph`
and `/tags` (a note slug that merely starts with `search` still dispatches to
the catch-all). `SeoService` sets title "Search", a description, and the
canonical. `gen-seo.mjs` keeps `/search` in the sitemap (all prerendered routes
are) but filters it out of `llms.txt`'s "## Notes" list.

### 7. The sidebar entry is a link

`SearchOverlay` is deleted. The sidebar renders an `<a routerLink="/search">`
styled like the old search bar (magnifier icon + "Search notes…"), so it is a
real link — middle-click, Cmd+click, and screen-reader semantics work, and
`<base href>` is baked in. `AppShell` owns `Ctrl/Cmd+K`: it navigates to
`/search`; when already there it focuses the input by its stable
`id="search-input"`.

## Testing Decisions

`tools/cli/build.test.mjs` (full end-to-end build under `--base-href /sub/`)
asserts the new page is prerendered (`search/index.html`), carries
`<title>Search · vault</title>` and the search input, appears in
`sitemap.xml`, does **not** appear in `llms.txt`, that the sidebar launcher
link carries the base path (`/sub/search`), that `content/search-index.json`
is emitted, and that no `pagefind/` output is produced. Unit coverage lives in
`src/app/search/search.service.spec.ts` (scoring, substring matching, accent
folding, snippet segments, limit, preload/retry) and
`src/app/views/search-view.spec.ts` (marked excerpts, empty and error states,
SEO) — the browser-side engine is testable in Vitest, unlike the old dynamic
Pagefind import.

## Out of Scope

- Search-as-you-type, suggestions, recent searches, and query history.
- Pagination, infinite scroll, result counts, and sorting controls.
- Per-section (`sub_results`) results or deep links to headings.
- Reflecting the query in the URL (`/search?q=…`); the query is component
  state only.
- Changes to the WebMCP tool schemas (the `search_notes` payload stays identical).
- Stemming, typo tolerance, and language-aware tokenization.
