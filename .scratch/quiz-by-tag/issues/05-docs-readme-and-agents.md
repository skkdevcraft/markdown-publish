# 05 — Docs: README + AGENTS.md

**What to build:** the docs catch up with the shipped feature so consumers and future agents know it exists and how it behaves. The README gains a feature bullet ("Quiz by tag — every frontmatter tag is automatically a quiz deck, browsable from the Tags view"). AGENTS.md learns that the content bundle now includes the tag index plus generated tag decks under the quiz output, and the conventions section records that generated tag quizzes are manifest routes excluded from the nav (and, per the existing quiz convention, absent from the link graph, search index, and WebMCP tools) and that inline-tag links are base-relative. Version bump is release management, not part of this ticket.

**Blocked by:** 02 — Parser: generate tag quiz decks + manifest routes (excluded from nav), 03 — Markdown renderer: inline tag links (base-relative, plain-text fallback), 04 — Angular: Tags index view (/tags) + sidebar link

**Status:** ready-for-agent

- [ ] README lists the "Quiz by tag" feature in its feature set.
- [ ] AGENTS.md documents the tag index and generated tag decks in the content-bundle description.
- [ ] AGENTS.md conventions record that generated tag quizzes are manifest routes excluded from nav and from graph/search/WebMCP surfaces, and that inline-tag links are base-relative.
- [ ] No version bump is made (release management).
