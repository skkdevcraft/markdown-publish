# 01 — Parser: quiz deck discovery, validation & bundle emission

**What to build:** an author drops a `.quiz.json` file anywhere in the vault, and the build turns it into a quiz deck: validated, tag-normalized, matched against the mode-filtered note set, listed in the site's routes and nav, and linkable via wikilinks. Decks with zero matching notes still ship (empty pool is a legitimate author-visible state); private notes never leak into decks in public builds. The fixtures demonstrate both modes, and the build-time tests verify it end to end.

**Blocked by:** None — can start immediately.

**Status:** implemented

- [ ] A `*.quiz.json` file anywhere in the vault (standard walk ignore rules) is discovered and emitted as a deck bundle; the slug is derived by stripping the compound `.quiz.json` extension before slugification (e.g. `Quiz/Spanish.quiz.json` → `quiz/spanish`), reusing the existing slug helpers.
- [ ] Unparseable JSON is a hard build error (canvas precedent); `tags` missing, empty, or not an array of strings skips the file with a console warning instead of failing the build. Tag normalization mirrors notes: strip leading `#`, trim, drop empties, dedupe.
- [ ] A note is in a deck iff it has **all** the deck's tags, case-insensitive, with Obsidian nested-tag semantics (`spanish` matches `spanish/verbs`).
- [ ] Matching runs against the mode-filtered note set — public builds exclude private notes from decks.
- [ ] The emitted bundle contains slug, title (with the same fallback chain as notes), description, normalized tags, and `notes: [{slug, title}]` sorted by slug; a zero-match deck emits `notes: []` (distinct from the schema-error skip). Reproducible output (sorted by slug).
- [ ] Deck routes (`kind: 'quiz'`) and nav leaves appear in the manifest alongside notes and canvases.
- [ ] `[[Spanish.quiz.json]]` wikilinks resolve to the quiz route; the basename retains `.quiz` so plain `[[Spanish]]` doesn't collide with notes.
- [ ] Fixtures: add `Quiz/Spanish.quiz.json` and tag `Secret.md` with `quiz`; full mode → deck = Word, Palabra, Secret; public mode → Word, Palabra only. Existing route/wikilink/sitemap assertions remain unchanged.
- [ ] Tests: a new fast parser-level public-mode test (spawns the parser with `BUILD_MODE=public` into a temp dir, no `ng build`) proves private notes never reach decks; the full-pipeline build test asserts bundle shape, the manifest route entry, and the nav node. `npm run test:cli` and both typecheck commands pass.

Details and exact shapes: `docs/quiz-feature-spec.md` §1 (file format & discovery), §2 (tag matching & emitted bundle), §3 (shared model), §6 (wikilinks), §9 (fixtures), §10.1–10.2 (tests). Intermediate state note: quiz routes prerender as the 404 view until ticket 02 — acceptable, existing build tests stay green.
