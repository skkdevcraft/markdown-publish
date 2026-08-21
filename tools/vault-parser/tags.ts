// Tag index construction. Every frontmatter tag on a note that survives the
// build-mode filter becomes a row in the index (emitted as tags.json), so the
// site can list topics with their note counts, and the generated tag decks
// (ticket 02) can reuse the exact same matching. The surviving route slugs
// are exposed for the inline-tag link rule (ticket 03).
import type { TagEntry, TagIndex } from '@shared/content-model';
import { slugifySegment } from './slug';
import { noteInDeck } from './quiz';

export interface TagIndexResult {
  index: TagIndex;
  /** Route slugs of the surviving tags (`tags/<slug>`), for inline tag links. */
  tagSlugs: Set<string>;
}

interface TagGroup {
  /** Spelling → note count; display casing is the most frequent. */
  spellings: Map<string, number>;
}

/** Build the tag index from the mode-filtered note set (only `tags` is read —
 *  callers pass the full `NoteEntry`, structural typing). `takenSlugs` are
 *  the real content routes (notes + canvases + quizzes); a tag whose route
 *  would collide with one is dropped with a warning, so nothing in the index
 *  ever points at a route that doesn't exist (the build still exits 0). */
export function buildTagIndex(
  notes: readonly { tags: string[] }[],
  takenSlugs: ReadonlySet<string>,
): TagIndexResult {
  // 1. Group spellings case-insensitively, counting per-spelling frequency.
  //    A note's tags are already deduped, so each spelling counts once per
  //    note — "most frequently used" across notes.
  const groups = new Map<string, TagGroup>();
  for (const note of notes) {
    for (const tag of note.tags) {
      const key = tag.toLowerCase();
      let group = groups.get(key);
      if (!group) {
        group = { spellings: new Map() };
        groups.set(key, group);
      }
      group.spellings.set(tag, (group.spellings.get(tag) ?? 0) + 1);
    }
  }

  // 2. Resolve each group to a pending row: display casing + base route.
  const pending: { name: string; base: string }[] = [];
  for (const group of groups.values()) {
    const name = displayCasing(group);
    const base = tagRoute(name);
    if (!base) {
      // e.g. a tag of only punctuation slugifies to nothing — no route to
      // point at; drop it, same "never dead-link" policy as collisions.
      console.warn(`tag: dropping "${name}" — slugifies to an empty route`);
      continue;
    }
    if (takenSlugs.has(base)) {
      warnDropped(name, base);
      continue;
    }
    pending.push({ name, base });
  }

  // 3. Distinct tags that slugify to the same route both stay reachable via
  //    deterministic `-2`/`-3` suffixes in canonical-name order.
  const byRoute = new Map<string, { name: string; base: string }[]>();
  for (const p of pending) {
    const list = byRoute.get(p.base) ?? [];
    list.push(p);
    byRoute.set(p.base, list);
  }
  for (const list of byRoute.values()) {
    list.sort((a, b) => nameCompare(a.name, b.name));
    list.forEach((p, i) => {
      if (i > 0) p.base = `${p.base}-${i + 1}`;
    });
  }

  // 4. Counts use the exact deck-matching semantics (noteInDeck with the
  //    single tag), so a row's count equals the generated deck's note pool
  //    size. A suffixed route can still collide with a real route (e.g. a
  //    note at `tags/foo-bar-2`) — same drop-with-warning policy.
  const entries: TagEntry[] = [];
  for (const list of byRoute.values()) {
    for (const p of list) {
      if (takenSlugs.has(p.base)) {
        warnDropped(p.name, p.base);
        continue;
      }
      const count = notes.filter((n) => noteInDeck(n.tags, [p.name])).length;
      entries.push({ name: p.name, slug: p.base, count });
    }
  }

  // 5. Rows ordered count-descending then name-ascending → reproducible
  //    output across builds.
  entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    index: { tags: entries },
    tagSlugs: new Set(entries.map((e) => e.slug)),
  };
}

/** Most frequent spelling wins. The spec says ties break "by slug order" —
 *  within a case-insensitive group every spelling slugifies identically
 *  (slugifySegment lowercases), so that degenerates to raw spelling order;
 *  raw UTF-16 compare keeps the result deterministic across environments (no
 *  localeCompare in a tie the tests assert). */
function displayCasing(group: TagGroup): string {
  const spellings = [...group.spellings.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  let best = spellings[0];
  let bestCount = -1;
  for (const s of spellings) {
    const c = group.spellings.get(s)!;
    if (c > bestCount) {
      best = s;
      bestCount = c;
    }
  }
  return best;
}

/** Route slug for a tag: per-segment slugified under `tags/` (`spanish/verbs`
 *  → `tags/spanish/verbs`, `foo bar` → `tags/foo-bar`). Empty string when the
 *  tag slugifies to nothing (all punctuation). */
function tagRoute(tag: string): string {
  const segments = tag.split('/').map(slugifySegment).filter(Boolean);
  return segments.length ? `tags/${segments.join('/')}` : '';
}

/** Ascending raw UTF-16 comparison — deterministic and locale-independent
 *  (the canonical-name order used for suffix assignment). */
function nameCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Shared drop warning for route collisions (base and suffixed routes follow
 *  the same policy — the real route wins, the build keeps going). */
function warnDropped(name: string, route: string): void {
  console.warn(
    `tag: dropping "${name}" — route "${route}" is taken by a note/canvas/quiz`,
  );
}
