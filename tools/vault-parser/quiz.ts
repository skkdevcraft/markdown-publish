// Quiz deck validation + tag matching. Mirrors canvas.ts structure: the caller
// owns file IO and hard errors (JSON.parse throws on unparseable JSON, the
// .canvas precedent); this module owns schema validation (soft-skip policy)
// and the note-matching semantics.

/** Validated quiz fields, before slug + note matching are attached by the
 *  caller (which owns the mode-filtered note set). */
export interface QuizValidation {
  title: string;
  description: string;
  tags: string[];
}

/**
 * Validate + normalize a raw quiz JSON object. Semantic errors — `tags`
 * missing, empty, or not an array of strings — return null; the caller logs a
 * console warning and skips the file (a bad tag list shouldn't block
 * publishing, same soft-skip policy as slug collisions). Unparseable JSON is
 * NOT handled here: the caller's JSON.parse throws a hard build error.
 */
export function normalizeQuiz(raw: unknown, fallbackTitle: string): QuizValidation | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const tags = normalizeTags(obj.tags);
  if (!tags.length) return null;
  return {
    // fallback chain mirrors notes: explicit title ?? basename minus .quiz.json
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackTitle,
    description: typeof obj.description === 'string' ? obj.description : '',
    tags,
  };
}

/** Tag normalization mirrors parseTags for notes: strip a leading `#`, trim,
 *  drop empties, dedupe. Nested tags (`foo/bar`) are kept as-is. Any
 *  non-string element means the list is not "an array of strings" → skip. */
function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') return [];
    const tag = v.trim().replace(/^#/, '');
    if (tag) out.add(tag);
  }
  return [...out];
}

/** Obsidian nested-tag semantics: a note tag matches a quiz tag if equal
 *  (case-insensitive) or if the note tag starts with `<quizTag>/` — `spanish`
 *  matches `spanish/verbs`; `spanish/verbs` matches `spanish/verbs/past`. */
export function tagMatches(noteTag: string, quizTag: string): boolean {
  const nt = noteTag.toLowerCase();
  const qt = quizTag.toLowerCase();
  return nt === qt || nt.startsWith(qt + '/');
}

/** A note is in the deck iff it has ALL of the quiz's tags. */
export function noteInDeck(noteTags: string[], quizTags: string[]): boolean {
  return quizTags.every((qt) => noteTags.some((nt) => tagMatches(nt, qt)));
}
