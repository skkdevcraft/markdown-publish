# 03 — Docs: README + AGENTS.md

**What to build:** the quiz-decks feature is documented for consumers and future agents — a README feature bullet plus a "How it works" mention that the content bundle now ships quiz decks, and AGENTS.md sections updated to reflect the new parser output, shared-model types, and conventions. No package surface changes are needed.

**Blocked by:** 02 — QuizView: start / session / end screens, reveal, stats, SEO + routing plumbing.

**Status:** ready-for-agent

- [ ] README gains a quiz-decks feature bullet: `.quiz.json` files turn tag-matched notes into self-graded Anki-style review sessions, stats kept in the browser; the "How it works" line mentions the content bundle now ships quiz decks.
- [ ] AGENTS.md §1 (project overview) notes the content bundle includes quiz decks; §3 (repository structure) notes the new quiz parsing, the quiz content output, and the new shared content-model file; §7 (testing) lists the new public-mode parser test; §8 (conventions) documents the new `RouteEntry.kind: 'quiz'` and `NavNode.type: 'quiz'` values.
- [ ] Confirmed no `package.json` `files` changes are required — tooling, app source, and shared model ship automatically; fixtures stay excluded.
- [ ] Version bump v1.1.0 is **not** part of this ticket — release management, per the spec.

Details: `docs/quiz-feature-spec.md` §11.
