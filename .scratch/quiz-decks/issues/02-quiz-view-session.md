# 02 — QuizView: start / session / end screens, reveal, stats, SEO + routing plumbing

**What to build:** visiting a quiz URL renders a crawlable start screen (title, description, matched-note count, cumulative progress from the browser), and "Start quiz" launches a fully client-side Anki-style session: title-faced cards, "I know it" / "Ask me again" / "Remind me" grading with reveal-then-grade, an end screen with session + per-card cumulative stats, and restart. Every grade is written through to a versioned, namespaced `localStorage` key so a mid-session reload never loses grades; all storage is SSR-guarded. Quiz pages set their own SEO, get a nav icon, and are indexable.

**Blocked by:** 01 — Parser: quiz deck discovery, validation & bundle emission.

**Status:** implemented

- [ ] The quiz route renders the view (route dispatch gains a `quiz` case; content loading via the new `loadQuiz`, same traversal guard as notes); the nav tree shows quiz leaves with their own icon.
- [ ] Start screen (default state): title, description, matched-note count ("12 notes"), cumulative progress ("9 of 12 reviewed · 7 known", browser only); "Start quiz" shuffles the pool (Fisher–Yates) into the session. Empty pool → "No notes match these tags yet" message, no start button.
- [ ] The start screen doubles as the SSR/prerendered shell — opening the route never auto-starts a session — and QuizView sets its own SEO (title, description, `type: website`, path `'/' + slug`) so it lands in prerendered HTML.
- [ ] Session: card face is the note title (body hidden), with "n remaining" and "End session" in the header. "I know it" → grade known, leaves the queue; "Ask me again" → grade again, moves to the end of the queue; queue empty → end screen.
- [ ] "Remind me" lazily fetches the note body (cached per session), renders it DOMPurify-sanitized, disables itself, shows a subtle "Open note →" link, and does not grade the card.
- [ ] End screen: session summary ("This session: N known · M again"), per-card list with title, cumulative counts and last result, and "Restart quiz" (reshuffles into a new session). "End session" exits mid-session.
- [ ] Stats: one key per quiz (`markdown-publish:quiz-stats:<slug>`), value `{ version: 1, cards: { [noteSlug]: CardStats } }` with a version field for future migrations; read when the quiz loads (browser only), written through on every grade; stale entries (notes that left the pool) are kept; all `localStorage` access behind `isPlatformBrowser`.
- [ ] Tests: full Vitest spec covering start screen, empty pool, start → session, grading, re-queue, reveal (fetch + sanitize + disable + link + no grade), queue-empty → end, end session, restart, localStorage key format/fields, and SSR simulation (no `localStorage`) rendering without crashing. Build test gains prerendered-content (start-screen text in the quiz page HTML) and sitemap-URL assertions. `npm test` and `npm run test:cli` both green.

Details and exact shapes: `docs/quiz-feature-spec.md` §4 (ContentService), §5 (routing/nav/SEO), §7 (view state machine), §8 (stats & persistence), §10.3 (view tests).
