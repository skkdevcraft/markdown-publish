/** Tag index: every frontmatter tag that survives collision filtering, with
 *  the note count its generated quiz deck will carry. Emitted by the parser
 *  as `tags.json`; consumed by the Tags view and, via the route slugs, the
 *  inline-tag link rule. */
export interface TagIndex {
  tags: TagEntry[];
}

export interface TagEntry {
  /** Display casing — the most frequent spelling, ties broken
   *  deterministically (slug order, then raw spelling order). */
  name: string;
  /** Route slug, `tags/<slugified>` — matches the generated quiz route. */
  slug: string;
  /** Number of mode-filtered notes matching the tag (Obsidian nested-tag
   *  semantics) — exactly the card count the generated deck will have. */
  count: number;
}
