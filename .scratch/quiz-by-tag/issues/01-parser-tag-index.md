# 01 — Parser: emit the tag index (tags.json) + shared model

**What to build:** the build-time data foundation for the whole feature. Every frontmatter tag on a note that survives the build-mode filter becomes a row in a new tag-index bundle file, so the site knows what topics exist, how many notes each carries, and what URL each topic's quiz will live at. Tags are grouped case-insensitively (the display casing is the most frequently used, tie-broken by slug order), counted with Obsidian nested-tag semantics (`spanish` counts notes tagged `spanish/verbs`; `spanish/verbs` is its own row too), and slugified per segment (`spanish/verbs` → `tags/spanish/verbs`, `foo bar` → `tags/foo-bar`). Two distinct tags that slugify to the same route both stay reachable via deterministic `-2`/`-3` suffixing in canonical-name order. A tag whose slug collides with a real note/canvas/quiz route is dropped from the index with a build warning — nothing in the index ever points at a route that doesn't exist, and the build still exits 0. Rows are ordered count-descending, then name-ascending, so output is reproducible across builds. The new shared types (index + entry shape) become the contract the Angular view will consume later, and the parser exposes the set of surviving tag slugs for the renderer ticket to consume.

**Blocked by:** None — can start immediately.

**Status:** implemented

- [x] A vault with zero tags emits an empty (but valid) tag index; a normal vault emits one row per surviving frontmatter tag.
- [x] Case variants (`Spanish`, `spanish`) collapse into one row whose display casing is the most frequent, tie-broken by slug order for determinism.
- [x] Nested tags follow Obsidian semantics: `spanish` counts notes tagged `spanish` or `spanish/…`, and `spanish/verbs` appears as its own row — counts may overlap across rows.
- [x] Each row's count is computed by the same note-matching semantics the quiz decks will use, and equals the number of notes the deck will contain.
- [x] Slugs are per-segment slugified (`spanish/verbs` → `tags/spanish/verbs`; `foo bar` → `tags/foo-bar`); two distinct tags slugifying to the same route get deterministic `-2`, `-3`, … suffixes in canonical-name order, both reachable.
- [x] A tag whose `tags/<slug>` collides with a real note/canvas/quiz route is dropped from the index with a console warning; the build still exits 0.
- [x] Rows are sorted count-descending then name-ascending; output is byte-identical across repeated builds.
- [x] In a public build, private notes contribute nothing to tag counts and never appear in the index.
- [x] The new parser-level test suite (fast spawn pattern, synthetic temp vault) covers: case grouping + display casing, nested counts, per-segment slugs, suffix disambiguation, real-route collision (dropped + exit 0), and the public-mode count filter; the existing public-mode test asserts public-only index counts.
