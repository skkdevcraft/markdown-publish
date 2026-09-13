import { inject, Injectable } from '@angular/core';
import type { SearchDoc } from '@shared/content-model';
import { ContentService } from '../content/content.service';

export interface SearchHit {
  slug: string;
  title: string;
  url: string;
  snippet: string;
  /** The snippet split into runs; `match` runs render as `<mark>` in the page. */
  segments: SnippetSegment[];
  score: number;
}

/** One run of excerpt text. `match` runs are the query terms (accent-folded). */
export interface SnippetSegment {
  text: string;
  match: boolean;
}

/** Accent folding table: `from` and `to` are the same length, one code point
 *  per entry, so folding a string never changes its length (see {@link foldText}). */
const FOLD_FROM = 'áàäâãåéèëêíìïîóòöôõúùüûñç';
const FOLD_TO = 'aaaaaaeeeeiiiiooooouuuunc';
const FOLD_MAP: Record<string, string> = {};
for (let i = 0; i < FOLD_FROM.length; i++) {
  FOLD_MAP[FOLD_FROM[i]] = FOLD_TO[i];
}

/** Lowercase + fold accents, preserving length so snippet offsets computed on
 *  the folded string still index into the original text. Only maps the common
 *  Latin accents; any other non-ASCII character (Cyrillic, CJK, …) passes through. */
export function foldText(value: string): string {
  return value.toLowerCase().replace(/[^\x00-\x7F]/g, (ch) => FOLD_MAP[ch] ?? ch);
}

/** A note record with its lowercased + folded title/text precomputed once. */
interface PreparedDoc {
  doc: SearchDoc;
  title: string;
  text: string;
}

/**
 * Unified search over the static content bundle. Keyword scoring (title-weighted
 * term frequency) with a windowed snippet, plus match segments for highlighting.
 *
 * Backs both the WebMCP `search_notes` agent tool and the human-facing /search
 * page. The index is `content/search-index.json`, which already ships with the
 * site, so search needs no separate index and works in `ng serve` too.
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly content = inject(ContentService);
  private prepared?: Promise<PreparedDoc[]>;

  /**
   * Warm the index (e.g. when /search mounts) without running a query. Failures
   * are not cached, so a later {@link search} retries; callers should still catch.
   */
  async preload(): Promise<void> {
    await this.index();
  }

  async search(query: string, limit = 10): Promise<SearchHit[]> {
    const q = foldText(query.trim());
    if (!q) {
      return [];
    }
    const terms = q.split(/\s+/).filter(Boolean);
    const docs = await this.index();
    const hits: SearchHit[] = [];
    for (const { doc, title, text } of docs) {
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) {
          score += title === t ? 12 : 6;
        }
        const occ = countOccurrences(text, t);
        score += Math.min(occ, 8);
      }
      // small boost when the whole phrase appears
      if (terms.length > 1 && text.includes(q)) {
        score += 5;
      }
      if (score > 0) {
        const { snippet, segments } = makeExcerpt(doc.text, text, terms);
        hits.push({
          slug: doc.slug,
          title: doc.title,
          url: doc.url,
          snippet,
          segments,
          score,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  private index(): Promise<PreparedDoc[]> {
    if (!this.prepared) {
      const loading = this.content.loadSearchIndex().then(({ docs }) =>
        docs.map((doc) => ({
          doc,
          title: foldText(doc.title),
          text: foldText(doc.text),
        })),
      );
      // Don't cache a rejection, or every later search fails without retrying.
      loading.catch(() => {
        if (this.prepared === loading) {
          this.prepared = undefined;
        }
      });
      this.prepared = loading;
    }
    return this.prepared;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

/** All occurrences of `terms` in `haystack`, sorted and merged where they
 *  overlap, as `[from, to)` ranges. */
function matchRanges(haystack: string, terms: string[]): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const t of terms) {
    if (!t) {
      continue;
    }
    let i = haystack.indexOf(t);
    while (i !== -1) {
      found.push([i, i + t.length]);
      i = haystack.indexOf(t, i + t.length);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [from, to] of found) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) {
      last[1] = Math.max(last[1], to);
    } else {
      merged.push([from, to]);
    }
  }
  return merged;
}

/** Window of `original` around the earliest term match, split into segments.
 *  `folded` is `foldText(original)` (same length), used to locate folded terms. */
function makeExcerpt(
  original: string,
  folded: string,
  terms: string[],
  window = 180,
): { snippet: string; segments: SnippetSegment[] } {
  let at = -1;
  for (const t of terms) {
    const i = folded.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) {
      at = i;
    }
  }
  if (at === -1) {
    const core = original.slice(0, window).trimEnd();
    const snippet = core + (original.length > window ? '…' : '');
    return { snippet, segments: [{ text: snippet, match: false }] };
  }
  const start = Math.max(0, at - Math.floor(window / 3));
  const end = Math.min(original.length, start + window);
  const regions = matchRanges(folded.slice(start, end), terms);
  const segments: SnippetSegment[] = [];
  if (start > 0) {
    segments.push({ text: '…', match: false });
  }
  let cursor = 0;
  for (const [from, to] of regions) {
    if (from > cursor) {
      segments.push({ text: original.slice(start + cursor, start + from), match: false });
    }
    segments.push({ text: original.slice(start + from, start + to), match: true });
    cursor = to;
  }
  const tail = original.slice(start + cursor, end);
  if (tail) {
    segments.push({ text: tail, match: false });
  }
  if (end < original.length) {
    segments.push({ text: '…', match: false });
  }
  return { snippet: segments.map((s) => s.text).join(''), segments };
}
