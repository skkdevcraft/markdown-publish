import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SearchService, type SnippetSegment } from '../search/search.service';
import { SeoService } from '../seo/seo.service';

interface SearchResult {
  url: string;
  title: string;
  segments: SnippetSegment[];
}

/** idle → nothing searched yet; searching → request in flight; results/empty →
 * a completed search (never confuse the two); error → the search index could
 * not be loaded, which must not masquerade as "no results". */
type SearchStatus = 'idle' | 'searching' | 'results' | 'empty' | 'error';

/** A scrollable page can afford more than the old popup's top-10. Fixed cap,
 * no pagination (see docs/03-search-page-feature-spec.md). */
const MAX_RESULTS = 50;

/**
 * Dedicated search page at /search (chrome page like /graph and /tags).
 *
 * Deliberately different from the removed sidebar popup:
 * - search runs on submit (button / Enter), **not** on every keystroke — no
 *   debounce, no per-keystroke work;
 * - results render inline on the page (no dropdown) and the page scrolls;
 * - the search bar sticks to the top of `.site-main` (the app's single scroll
 *   container) on desktop so you can refine a query while deep in the list.
 *   Not sticky on mobile, where the fixed nav-toggle would sit on top of it.
 *
 * Backed by the shared client-side keyword index (`SearchService`): the content
 * bundle (including `search-index.json`) already ships with the site, so there
 * is no separate index to load and search works in `ng serve` too. Result
 * excerpts render `<mark>`ed match segments — never `innerHTML`.
 */
@Component({
  selector: 'app-search-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <article class="search-page">
      <header class="search-head">
        <p class="search-eyebrow">Index</p>
        <h1 class="search-title">Search</h1>
      </header>

      <form class="search-form" role="search" (ngSubmit)="submit()">
        <div class="search-bar">
          <span class="search-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            #searchInput
            id="search-input"
            type="text"
            class="search-input"
            name="q"
            placeholder="Search notes…"
            autocomplete="off"
            spellcheck="false"
            aria-label="Search notes"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
          @if (query()) {
            <button type="button" class="search-clear" aria-label="Clear search" (click)="clear()">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          }
        </div>
        <button type="submit" class="search-submit" [disabled]="!canSubmit()">Search</button>
      </form>

      <div class="search-results" aria-live="polite">
        @switch (status()) {
          @case ('idle') {
            <p class="search-hint">Type a query and press Search.</p>
          }
          @case ('searching') {
            <p class="search-hint">Searching…</p>
          }
          @case ('error') {
            <p class="search-unavailable">
              Search is unavailable right now. (Couldn't load the search index.)
            </p>
          }
          @case ('empty') {
            <p class="search-empty">No results for “{{ submitted() }}”.</p>
          }
          @case ('results') {
            <ul class="search-list">
              @for (r of results(); track r.url) {
                <li>
                  <button type="button" class="result" (click)="go(r.url)">
                    <span class="result-title">{{ r.title }}</span>
                    <span class="result-excerpt">
                      @for (seg of r.segments; track $index) {
                        @if (seg.match) {
                          <mark>{{ seg.text }}</mark>
                        } @else {
                          <span class="excerpt-plain">{{ seg.text }}</span>
                        }
                      }
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        }
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .search-page {
        box-sizing: border-box;
        max-width: 720px;
        margin: 0 auto;
        padding: 48px 24px 96px;
      }

      .search-head {
        margin: 0 0 1em;
      }

      .search-eyebrow {
        margin: 0 0 0.4em;
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-faint);
      }

      .search-title {
        margin: 0;
        font-size: 2em;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -0.015em;
        color: var(--text-normal);
      }

      /* Sticks to the top of .site-main (the scroll container) while results
         scroll under it. Opaque background so rows don't bleed through. */
      .search-form {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 1.2em;
        padding: 12px 0;
        box-sizing: border-box;
        background: var(--background-primary);
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .search-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1 1 auto;
        min-width: 0;
        height: 40px;
        padding: 0 10px;
        box-sizing: border-box;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
      }

      .search-bar:focus-within {
        border-color: var(--text-accent);
      }

      .search-icon {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        color: var(--text-faint);
      }

      .search-input {
        flex: 1 1 auto;
        min-width: 0;
        border: none;
        outline: none;
        background: transparent;
        color: var(--text-normal);
        font-family: inherit;
        font-size: 15px;
        line-height: 1.4;
      }

      .search-input::placeholder {
        color: var(--text-faint);
      }

      .search-clear {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 20px;
        height: 20px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--text-faint);
        cursor: pointer;
      }

      .search-clear:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
      }

      .search-submit {
        flex: 0 0 auto;
        height: 40px;
        padding: 0 18px;
        border: 1px solid var(--interactive-accent);
        border-radius: 6px;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .search-submit:hover:not(:disabled) {
        background: var(--text-accent-hover);
      }

      .search-submit:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .search-hint,
      .search-empty {
        margin: 1.6em 0;
        color: var(--text-muted);
        font-size: 0.95rem;
      }

      .search-unavailable {
        margin: 1.6em 0;
        padding: 1em 1.2em;
        border: 1px dashed var(--background-modifier-border);
        border-radius: 8px;
        color: var(--text-muted);
        font-size: 0.9rem;
      }

      .search-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .result {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
        box-sizing: border-box;
        padding: 12px 14px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary-alt);
        text-align: start;
        cursor: pointer;
        color: var(--text-normal);
      }

      .result:hover {
        border-color: var(--interactive-accent);
        background: var(--background-modifier-hover);
      }

      .result-title {
        font-weight: 600;
        font-size: 1rem;
        line-height: 1.3;
        color: var(--text-normal);
      }

      .result-excerpt {
        font-size: 0.9rem;
        line-height: 1.5;
        color: var(--text-muted);
      }

      .result-excerpt mark {
        background: rgba(250, 204, 21, 0.4);
        color: inherit;
        border-radius: 2px;
        padding: 0 1px;
      }

      /* Mobile: no sticky (the fixed nav-toggle owns that corner) and tighter
         gutters. */
      @media (max-width: 768px) {
        .search-page {
          padding: 24px 16px 64px;
        }

        .search-form {
          position: static;
          padding-top: 0;
          border-bottom: none;
        }
      }
    `,
  ],
})
export class SearchView {
  protected readonly query = signal('');
  /** The term the current results (or empty state) belong to — kept so the
   * "no results for …" line doesn't change if the user edits the box. */
  protected readonly submitted = signal('');
  protected readonly results = signal<SearchResult[]>([]);
  protected readonly status = signal<SearchStatus>('idle');

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly router = inject(Router);
  private readonly search = inject(SearchService);

  constructor() {
    // Chrome page: title/description/canonical only, no note body to excerpt.
    void inject(SeoService).set({
      title: 'Search',
      description: 'Search every note in this knowledge base.',
      path: '/search',
      type: 'website',
    });

    // Warm the index while the user types, so the first submit rarely waits on
    // the fetch. Swallow failures here — the submit path owns the error state.
    void this.search.preload().catch(() => {});

    // Focus on arrival (sidebar launcher / Ctrl+K / direct URL). `autofocus`
    // alone doesn't fire on client-side route changes, so do it explicitly.
    afterNextRender(() => this.focus());
  }

  protected canSubmit(): boolean {
    return this.query().trim().length > 0 && this.status() !== 'searching';
  }

  protected submit(): void {
    const term = this.query().trim();
    if (!term || this.status() === 'searching') {
      return;
    }
    void this.run(term);
  }

  protected clear(): void {
    this.query.set('');
    this.submitted.set('');
    this.results.set([]);
    this.status.set('idle');
    this.focus();
  }

  private focus(): void {
    this.inputEl()?.nativeElement.focus();
  }

  private async run(term: string): Promise<void> {
    this.status.set('searching');
    this.results.set([]);
    this.submitted.set(term);
    try {
      const hits = await this.search.search(term, MAX_RESULTS);
      this.results.set(hits.map((h) => ({ url: h.url, title: h.title, segments: h.segments })));
      this.status.set(hits.length ? 'results' : 'empty');
    } catch {
      this.results.set([]);
      this.status.set('error');
    }
  }

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
