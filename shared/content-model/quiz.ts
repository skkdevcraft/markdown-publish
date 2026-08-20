/** A quiz deck: a `.quiz.json` vault file resolved at build time against the
 *  mode-filtered note set. `notes` is the matched pool (all deck tags,
 *  case-insensitive, Obsidian nested-tag semantics), sorted by slug. */
export interface Quiz {
  slug: string;
  title: string;
  description: string;
  /** Normalized deck tags (leading `#` stripped, trimmed, deduped). */
  tags: string[];
  notes: { slug: string; title: string }[];
}
