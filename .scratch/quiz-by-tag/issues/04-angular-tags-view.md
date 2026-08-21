# 04 — Angular: Tags index view (/tags) + sidebar link

**What to build:** a real, shareable, crawlable Tags index page at `/tags` that lists every tag from the index as a `#name` pill with its note count, sorted by the bundle's ordering (count descending), each linking to its tag's quiz. The page loads the tag index through a new content loader (the server-side variant inherits it automatically), sets its own SEO (title "Tags", description mentioning the tag count, canonical `/tags`), handles the empty state (vault with no tags), and is prerendered and listed in the sitemap like every other page. The sidebar gains a "Tags" link beside the existing graph link. The route is registered as an exact match ahead of the catch-all — this matters: with Angular's default prefix matching, a plain `tags` route would swallow every `tags/<tag>` quiz URL, so the registration must pin `pathMatch: 'full'`.

**Blocked by:** 01 — Parser: emit the tag index (tags.json) + shared model

**Status:** ready-for-agent

- [ ] Visiting `/tags` renders every tag as a `#name` pill with its count badge, ordered count-descending then name-ascending, each linking to its quiz route.
- [ ] `/tags` is prerendered to static HTML with title "Tags", a description that mentions the tag count, and a canonical URL; it is listed in the sitemap.
- [ ] A vault with no tags renders an empty state, not an error.
- [ ] `tags/<tag>` quiz URLs still dispatch to the quiz view — the `/tags` route registration does not shadow them (exact match only).
- [ ] The sidebar shows a "Tags" link beside the graph link that navigates to `/tags`.
- [ ] The tag index loads through the shared content service so both browser and prerender paths read the same bundle file.
- [ ] Test coverage: the full-pipeline build test asserts the prerendered `/tags` HTML renders the tag pill, count, and link, and that the sitemap includes `/tags`.
