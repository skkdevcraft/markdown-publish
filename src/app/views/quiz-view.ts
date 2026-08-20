import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  PLATFORM_ID,
  resource,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import DOMPurify from 'dompurify';
import type { Quiz } from '@shared/content-model';
import { ContentService } from '../content/content.service';
import { SeoService } from '../seo/seo.service';

/** One card's cumulative history across sessions (no SRS scheduling in v1 —
 *  the loop is random by design, so only press counts + last result matter). */
export interface CardStats {
  known: number; // "I know it" presses
  again: number; // "Ask me again" presses
  lastResult: 'known' | 'again';
  lastSeen: number; // epoch ms
}

interface QuizStats {
  version: 1;
  cards: Record<string, CardStats>;
}

// Namespaced + versioned so future migrations can detect old payloads and so
// the key can't collide with other localStorage users on the origin.
const STATS_PREFIX = 'markdown-publish:quiz-stats:';
const STATS_VERSION = 1;

/** Fisher–Yates shuffle over a copy — every session gets a fresh pool order. */
function shuffle<T>(notes: T[]): T[] {
  const a = [...notes];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Read the quiz's cumulative stats. Corrupt or mismatched-version payloads are
 *  ignored (fresh history) rather than crashing the view. */
function readStats(slug: string): Record<string, CardStats> {
  try {
    const raw = window.localStorage.getItem(STATS_PREFIX + slug);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<QuizStats>;
    if (parsed.version !== STATS_VERSION || !parsed.cards || typeof parsed.cards !== 'object') {
      return {};
    }
    return parsed.cards;
  } catch {
    return {};
  }
}

function writeStats(slug: string, cards: Record<string, CardStats>): void {
  try {
    window.localStorage.setItem(
      STATS_PREFIX + slug,
      JSON.stringify({ version: STATS_VERSION, cards } satisfies QuizStats),
    );
  } catch {
    // storage disabled/full — grades are best-effort; the session still works
  }
}

@Component({
  selector: 'app-quiz-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (quiz.value(); as quiz) {
      @switch (screen()) {
        @case ('session') {
          <div class="quiz-session">
            <header class="quiz-session-head">
              <span class="quiz-session-title">{{ quiz.title }}</span>
              <span class="quiz-remaining">{{ queue().length }} remaining</span>
              <button type="button" class="quiz-quit" (click)="endSession()">End session</button>
            </header>

            @if (current(); as card) {
              <div class="quiz-card">
                <h2 class="quiz-card-title">{{ card.title }}</h2>

                @if (revealState() === 'loading') {
                  <p class="quiz-reveal-status">Loading note…</p>
                } @else if (revealState() === 'ready') {
                  <div class="quiz-reveal">
                    <!-- note.html is parser-sanitized; this browser-path pass
                         mirrors NoteView (DOMPurify handles runtime DOM) -->
                    <div class="note-body" [innerHTML]="revealedHtml()"></div>
                    <a class="quiz-open-note" [routerLink]="['/' + card.slug]">Open note →</a>
                  </div>
                }
              </div>

              <div class="quiz-actions">
                <button type="button" class="quiz-btn quiz-btn-secondary" (click)="grade('again')">
                  Ask me again
                </button>
                <button
                  type="button"
                  class="quiz-btn quiz-btn-secondary"
                  (click)="reveal(card)"
                  [disabled]="revealState() === 'ready'"
                >
                  Remind me
                </button>
                <button type="button" class="quiz-btn quiz-btn-known" (click)="grade('known')">
                  I know it
                </button>
              </div>
            }
          </div>
        }
        @case ('end') {
          <div class="quiz-page">
            <header class="quiz-head">
              <p class="quiz-eyebrow">Quiz</p>
              <h1 class="quiz-title">{{ quiz.title }}</h1>
              <p class="quiz-summary">
                This session: {{ sessionKnown() }} known · {{ sessionAgain() }} again
              </p>
            </header>

            <ul class="quiz-results">
              @for (note of quiz.notes; track note.slug) {
                <li class="quiz-result">
                  <span class="quiz-result-title">{{ note.title }}</span>
                  @if (stats()[note.slug]; as s) {
                    <span class="quiz-result-counts">{{ s.known }} known · {{ s.again }} again</span>
                    <span class="quiz-result-last" [class.is-known]="s.lastResult === 'known'">
                      {{ s.lastResult }}
                    </span>
                  } @else {
                    <span class="quiz-result-counts">not reviewed</span>
                  }
                </li>
              }
            </ul>

            <button type="button" class="quiz-btn quiz-btn-primary" (click)="start()">
              Restart quiz
            </button>
          </div>
        }
        @default {
          <div class="quiz-page">
            <header class="quiz-head">
              <p class="quiz-eyebrow">Quiz</p>
              <h1 class="quiz-title">{{ quiz.title }}</h1>
              @if (quiz.description) {
                <p class="quiz-description">{{ quiz.description }}</p>
              }
              <p class="quiz-count">
                {{ quiz.notes.length }} {{ quiz.notes.length === 1 ? 'note' : 'notes' }}
              </p>
              <!-- cumulative progress is browser-only: the server renders the
                   static start screen with no localStorage stats -->
              @if (isBrowser && progress(); as p) {
                <p class="quiz-progress">{{ p.reviewed }} of {{ p.total }} reviewed · {{ p.known }} known</p>
              }
            </header>

            @if (quiz.notes.length > 0) {
              <button type="button" class="quiz-btn quiz-btn-primary" (click)="start()">
                Start quiz
              </button>
            } @else {
              <p class="quiz-empty">No notes match these tags yet</p>
            }
          </div>
        }
      }
    } @else if (quiz.error()) {
      <p class="quiz-error">Could not load this quiz.</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .quiz-page,
      .quiz-session {
        box-sizing: border-box;
      }

      .quiz-page {
        max-width: 720px;
        margin: 0 auto;
        padding: 48px 24px 96px;
      }

      .quiz-eyebrow {
        margin: 0 0 0.4em;
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-faint);
      }

      .quiz-title,
      .quiz-card-title {
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -0.015em;
        color: var(--text-normal);
      }

      .quiz-title {
        margin: 0 0 0.4em;
        font-size: 2em;
      }

      .quiz-description {
        margin: 0 0 0.6em;
        font-size: 1.05em;
        line-height: 1.6;
        color: var(--text-muted);
      }

      .quiz-count {
        margin: 0 0 0.2em;
        font-size: 0.9rem;
        color: var(--text-muted);
      }

      .quiz-progress {
        margin: 0 0 1.6em;
        font-size: 0.9rem;
        color: var(--text-faint);
      }

      .quiz-empty {
        margin: 2em 0 0;
        padding: 1.2em 1.4em;
        border: 1px dashed var(--background-modifier-border);
        border-radius: 8px;
        color: var(--text-muted);
      }

      .quiz-error {
        padding: 48px 24px;
        color: var(--text-muted);
      }

      .quiz-btn,
      .quiz-quit {
        font: inherit;
        cursor: pointer;
      }

      .quiz-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.6em 1.2em;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary-alt);
        color: var(--text-normal);
        font-size: 0.95rem;
        font-weight: 500;
        transition: 140ms ease;
      }

      .quiz-btn:hover:not(:disabled) {
        background: var(--background-modifier-hover);
      }

      .quiz-btn:disabled {
        opacity: 0.55;
        cursor: default;
      }

      .quiz-btn:focus-visible {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
      }

      .quiz-btn-primary {
        margin-top: 1.4em;
      }

      .quiz-btn-primary,
      .quiz-btn-known {
        border-color: var(--interactive-accent);
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }

      .quiz-btn-primary:hover:not(:disabled),
      .quiz-btn-known:hover:not(:disabled) {
        filter: brightness(1.08);
      }

      /* session */
      .quiz-session {
        display: flex;
        flex-direction: column;
        max-width: 720px;
        min-height: calc(100dvh - 16px);
        margin: 0 auto;
        padding: 0 24px;
      }

      .quiz-session-head {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 0;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .quiz-session-title,
      .quiz-result-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .quiz-session-title {
        font-weight: 600;
        color: var(--text-normal);
      }

      .quiz-remaining {
        margin-left: auto;
        font-size: 0.85rem;
        color: var(--text-muted);
        white-space: nowrap;
      }

      .quiz-quit {
        padding: 4px 10px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: transparent;
        color: var(--text-muted);
        font-size: 0.85rem;
        transition: 140ms ease;
      }

      .quiz-quit:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
      }

      .quiz-card {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 48px 0 32px;
      }

      .quiz-card-title {
        margin: 0 0 1.4em;
        font-size: 2.2em;
        text-align: center;
      }

      .quiz-reveal {
        border-top: 1px solid var(--background-modifier-border);
        padding-top: 1.4em;
      }

      .quiz-reveal-status {
        margin: 0;
        text-align: center;
        font-size: 0.9rem;
        color: var(--text-faint);
      }

      .quiz-open-note {
        display: inline-block;
        margin-top: 1em;
        font-size: 0.9rem;
        color: var(--text-accent);
        text-decoration: none;
      }

      .quiz-open-note:hover {
        color: var(--text-accent-hover);
        text-decoration: underline;
      }

      .quiz-actions {
        display: flex;
        justify-content: center;
        gap: 12px;
        padding-bottom: 32px;
      }

      /* end screen */
      .quiz-summary {
        margin: 0 0 1.6em;
        font-size: 1.05em;
        color: var(--text-muted);
      }

      .quiz-results {
        margin: 0 0 2em;
        padding: 0;
        list-style: none;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        overflow: hidden;
      }

      .quiz-result {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .quiz-result:last-child {
        border-bottom: none;
      }

      .quiz-result-title {
        flex: 1 1 auto;
        min-width: 0;
        color: var(--text-normal);
      }

      .quiz-result-counts {
        flex: 0 0 auto;
        font-size: 0.85rem;
        color: var(--text-muted);
      }

      .quiz-result-last {
        flex: 0 0 auto;
        min-width: 52px;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
        text-align: center;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        text-transform: capitalize;
      }

      .quiz-result-last.is-known {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }

      @media (max-width: 480px) {
        .quiz-actions {
          flex-direction: column;
        }

        .quiz-actions .quiz-btn {
          width: 100%;
        }
      }
    `,
  ],
})
export class QuizView {
  readonly slug = input.required<string>();

  private readonly content = inject(ContentService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly seo = inject(SeoService);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** 'start' is also the SSR/prerendered shell: opening the route never
   *  auto-starts a session (crawlers/link previews must see the description). */
  protected readonly screen = signal<'start' | 'session' | 'end'>('start');
  /** Shuffled review queue; `current()` (index 0) is the card on screen. */
  protected readonly queue = signal<Quiz['notes']>([]);
  protected readonly sessionKnown = signal(0);
  protected readonly sessionAgain = signal(0);
  /** "Remind me" fetches each note body at most once per session. */
  private readonly bodyCache = new Map<string, SafeHtml>();
  protected readonly revealState = signal<'hidden' | 'loading' | 'ready'>('hidden');
  protected readonly revealedHtml = signal<SafeHtml>('');
  protected readonly stats = signal<Record<string, CardStats>>({});

  protected readonly quiz = resource({
    params: () => this.slug(),
    loader: ({ params }) => this.content.loadQuiz(params),
  });

  constructor() {
    // RouteDispatch reuses this component instance across quiz navigations, so
    // a slug change must reset the whole session back to the start screen.
    effect(() => {
      this.slug();
      this.resetSession();
    });

    // Quiz pages set their own SEO (title + description live on the start
    // screen, so they land in prerendered HTML) — RouteDispatch deliberately
    // covers only canvases and 404s.
    effect(() => {
      const quiz = this.quiz.value();
      if (!quiz) {
        return;
      }
      void this.seo.set({
        title: quiz.title,
        description: quiz.description,
        path: '/' + this.slug(),
        type: 'website',
      });
    });

    // Cumulative stats are read once when the quiz loads — browser only; the
    // server renders the static start screen with no stats.
    effect(() => {
      if (!this.isBrowser) {
        return;
      }
      const quiz = this.quiz.value();
      if (!quiz) {
        return;
      }
      this.stats.set(readStats(quiz.slug));
    });
  }

  protected readonly current = computed(() => this.queue()[0] ?? null);

  /** Start-screen cumulative progress: reviewed = ever graded, known = last
   *  marked known. Stale entries (notes that left the pool) are ignored here
   *  but kept in storage. */
  protected readonly progress = computed(() => {
    const quiz = this.quiz.value();
    if (!quiz) {
      return null;
    }
    const cards = this.stats();
    let reviewed = 0;
    let known = 0;
    for (const note of quiz.notes) {
      const s = cards[note.slug];
      if (s && s.known + s.again > 0) {
        reviewed++;
        if (s.lastResult === 'known') {
          known++;
        }
      }
    }
    return { total: quiz.notes.length, reviewed, known };
  });

  protected start(): void {
    const quiz = this.quiz.value();
    if (!quiz || quiz.notes.length === 0) {
      return;
    }
    this.resetSession();
    this.queue.set(shuffle(quiz.notes));
    this.screen.set('session');
  }

  protected endSession(): void {
    this.screen.set('end');
  }

  protected grade(result: 'known' | 'again'): void {
    const card = this.current();
    if (!card) {
      return;
    }
    this.applyGrade(card.slug, result);
    if (result === 'known') {
      this.queue.update((q) => q.slice(1));
    } else {
      // "Ask me again": the card stays in the review loop — move it to the end.
      this.queue.update((q) => [...q.slice(1), card]);
    }
    this.hideReveal();
    // Only "known" shrinks the queue, so this is the natural end of the loop.
    if (this.queue().length === 0) {
      this.screen.set('end');
    }
  }

  protected async reveal(card: { slug: string; title: string }): Promise<void> {
    if (this.revealState() !== 'hidden') {
      // already loading or shown — no re-entry while a fetch is in flight
      return;
    }
    const cached = this.bodyCache.get(card.slug);
    if (cached) {
      this.revealedHtml.set(cached);
      this.revealState.set('ready');
      return;
    }
    this.revealedHtml.set('');
    this.revealState.set('loading');
    try {
      const note = await this.content.loadNote(card.slug);
      // The card may have been graded (or the session ended) while the body
      // was loading — only apply the reveal if the card is still up.
      if (this.screen() !== 'session' || this.current()?.slug !== card.slug) {
        return;
      }
      const html = this.sanitizer.bypassSecurityTrustHtml(
        DOMPurify.sanitize(note.html, { ADD_ATTR: ['target'] }),
      );
      this.bodyCache.set(card.slug, html);
      this.revealedHtml.set(html);
      this.revealState.set('ready');
    } catch {
      // Body failed to load — leave "Remind me" active so the user can retry.
      this.revealState.set('hidden');
    }
  }

  private resetSession(): void {
    this.queue.set([]);
    this.sessionKnown.set(0);
    this.sessionAgain.set(0);
    this.hideReveal();
    this.bodyCache.clear();
    this.screen.set('start');
  }

  private hideReveal(): void {
    this.revealState.set('hidden');
    this.revealedHtml.set('');
  }

  /** Write-through on every grade: a mid-session reload must not lose grades. */
  private applyGrade(noteSlug: string, result: 'known' | 'again'): void {
    const quiz = this.quiz.value();
    if (!quiz) {
      return;
    }
    if (result === 'known') {
      this.sessionKnown.update((n) => n + 1);
    } else {
      this.sessionAgain.update((n) => n + 1);
    }
    const cards = { ...this.stats() };
    const prev = cards[noteSlug];
    cards[noteSlug] = {
      known: (prev?.known ?? 0) + (result === 'known' ? 1 : 0),
      again: (prev?.again ?? 0) + (result === 'again' ? 1 : 0),
      lastResult: result,
      lastSeen: Date.now(),
    };
    this.stats.set(cards);
    writeStats(quiz.slug, cards);
  }
}
