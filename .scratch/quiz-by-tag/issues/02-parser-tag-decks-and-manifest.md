# 02 — Parser: generate tag quiz decks + manifest routes (excluded from nav)

**What to build:** every tag that survived the index's collision filtering automatically gets a virtual quiz deck, so a visitor can open `/tags/<tag>` and review exactly the notes that tag counts — with the exact existing quiz flow and zero new quiz UI. Each deck is a standard quiz deck (title `#<display>`, description `<n> notes tagged #<display>` pluralized, tags list `[<display>]`, slug-sorted note pool matched by the existing all-tags-required case-insensitive nested-tag semantics) written to the quiz output under its `tags/<slug>` name, and registered in the manifest as a `kind: 'quiz'` route — which buys route dispatch, `QuizView` rendering, per-tag browser-persisted stats, SEO, prerendering, and sitemap inclusion from existing machinery. Generated decks are deliberately not passed to the nav builder, so a tags-heavy vault doesn't clutter the sidebar, and they stay out of the link graph, search index, and WebMCP tools (the established quiz convention — those surfaces are notes-only by construction). Hand-written notes, canvases, and decks keep winning slug conflicts because the index already dropped colliding tags. A tag with zero matched notes still ships its deck with an empty pool, like hand-written decks.

**Blocked by:** 01 — Parser: emit the tag index (tags.json) + shared model

**Status:** implemented

- [ ] Every tag in the index has a generated deck file: title `#<display>`, description `<n> notes tagged #<display>` (correctly singular for 1 note), tags `[<display>]`, notes slug-sorted and identical to the hand-written deck matching for the same tag.
- [ ] Each generated deck is a manifest route with `kind: 'quiz'` and title `#<display>`; no generated deck appears as a nav leaf (and no `tags` folder is created in the nav).
- [ ] `/tags/<tag>` is a working quiz page through the existing machinery: start screen with the `#<display>` title, matched-note count, and description; session with grading and reveal; end screen with "Remind me"; stats persisted per tag slug across reloads.
- [ ] Tag quiz pages are prerendered and listed in the sitemap, with proper title/description in the static HTML (existing quiz SEO path).
- [ ] Generated decks never appear in the link graph, the search index, or the WebMCP tools.
- [ ] A tag with no matching notes ships an empty-pool deck (count 0), matching hand-written deck behavior; decks and routes are deterministic across builds.
- [ ] In a public build, generated decks exclude private notes, consistent with the hand-written deck mode filter.
- [ ] Test coverage: the full-pipeline build test asserts the generated deck's note set equals the hand-written deck's for the same tag, the manifest route entry, the absence of a nav leaf, and the prerendered page + sitemap URL; the public-mode test asserts the private note is excluded from the generated deck; the parser-level tag-index test gains a count-equals-deck-size invariant for every entry.
