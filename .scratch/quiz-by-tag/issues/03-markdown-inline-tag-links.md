# 03 — Markdown renderer: inline tag links (base-relative, plain-text fallback)

**What to build:** inline `#tag` mentions in note bodies stop being dead links. Today every inline tag renders as a root-absolute link to a non-existent `/tags/<tag>` route (which also breaks on subpath deployments). Instead, the parser computes the set of linkable tag slugs (the tags that survived collision filtering in the index ticket) before rendering, threads it into the markdown renderer factory, and the inline-tag rule consults it: a tag with a route renders as `<a class="tag" href="tags/<slug>">#<raw></a>` with a **base-relative** href (no leading slash), and a tag without a route renders as plain text — never a dead link. Because the factory is shared, canvas-rendered text gets the same behavior for free. This ticket also adds the `#quiz` mention to the fixture home note's existing tag line so the tests can assert both behaviors in one place.

**Blocked by:** 01 — Parser: emit the tag index (tags.json) + shared model

**Status:** ready-for-agent

- [ ] An inline tag with a surviving route renders as a tag link whose href is base-relative (no leading slash), so it works under a GitHub Pages subpath.
- [ ] An inline tag with no tag page renders as plain text — no anchor, no dead link.
- [ ] Canvas text nodes get identical inline-tag behavior (shared renderer factory).
- [ ] Tag links in note bodies point at the tag's quiz URL (`tags/<slug>`, matching the generated route).
- [ ] The fixture home note's tag line includes `#quiz` alongside the existing `#project #idea` inline tags.
- [ ] Test coverage: the full-pipeline build test asserts the home note's rendered HTML contains a base-relative `href="tags/quiz"` for the inline `#quiz` and **no** `href="tags/project"` / `href="tags/idea"` (plain-text rendering).
