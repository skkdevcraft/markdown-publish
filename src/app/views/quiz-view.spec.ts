import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import type { Manifest, Note, Quiz } from '@shared/content-model';
import { ContentService } from '../content/content.service';
import { SeoService } from '../seo/seo.service';
import { QuizView, type CardStats } from './quiz-view';

const QUIZ: Quiz = {
  slug: 'quiz/spanish',
  title: 'Spanish',
  description: 'Do you remember these words?',
  tags: ['quiz'],
  notes: [
    { slug: 'quiz/palabra', title: 'Palabra' },
    { slug: 'quiz/word', title: 'Word' },
  ],
};

const EMPTY_QUIZ: Quiz = { ...QUIZ, notes: [] };

const STATS_KEY = 'markdown-publish:quiz-stats:quiz/spanish';

const loadQuiz = vi.fn();
const loadNote = vi.fn();

/** Hermetic stand-in for the fetch-based ContentService (app.spec.ts pattern):
 *  quiz/note loads are stubbed per-test; everything else throws loudly. */
const contentStub = {
  loadManifest: async (): Promise<Manifest> => {
    throw new Error('loadManifest not stubbed');
  },
  loadQuiz,
  loadNote,
  loadCanvas: async () => {
    throw new Error('loadCanvas not stubbed');
  },
  loadGraph: async () => {
    throw new Error('loadGraph not stubbed');
  },
  loadSearchIndex: async () => {
    throw new Error('loadSearchIndex not stubbed');
  },
};

const seoStub = { set: vi.fn().mockResolvedValue(undefined) };

function noteBody(slug: string): Note {
  const note = QUIZ.notes.find((n) => n.slug === slug);
  const title = note?.title ?? slug;
  return {
    slug,
    title,
    html: `<p>body of ${title}</p>`,
    markdown: '',
    headings: [],
    backlinks: [],
    outgoing: [],
    frontmatter: {},
    publish: 'public',
    tags: [],
  };
}

async function render(slug = QUIZ.slug): Promise<ComponentFixture<QuizView>> {
  const fixture = TestBed.createComponent(QuizView);
  fixture.componentRef.setInput('slug', slug);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/** Click the button whose trimmed text matches, then re-render. */
function click(fixture: ComponentFixture<QuizView>, text: string): void {
  const buttons = [...fixture.nativeElement.querySelectorAll('button')];
  const btn = buttons.find((b) => (b.textContent ?? '').trim() === text);
  expect(btn, `button "${text}" not found`).toBeTruthy();
  (btn as HTMLButtonElement).click();
  fixture.detectChanges();
}

/** Title currently on the card face (session screen). */
function currentTitle(fixture: ComponentFixture<QuizView>): string {
  const h = fixture.nativeElement.querySelector('h2.quiz-card-title');
  expect(h, 'no card face rendered').toBeTruthy();
  return (h as HTMLElement).textContent ?? '';
}

function remaining(fixture: ComponentFixture<QuizView>): string {
  const el = fixture.nativeElement.querySelector('.quiz-remaining');
  return (el as HTMLElement)?.textContent ?? '';
}

describe('QuizView', () => {
  beforeEach(async () => {
    localStorage.clear();
    loadQuiz.mockReset();
    loadNote.mockReset();
    loadQuiz.mockResolvedValue(QUIZ);
    loadNote.mockImplementation(async (slug: string) => noteBody(slug));
    seoStub.set.mockClear();
    await TestBed.configureTestingModule({
      imports: [QuizView],
      providers: [
        provideRouter([]),
        { provide: ContentService, useValue: contentStub as unknown as ContentService },
        { provide: SeoService, useValue: seoStub as unknown as SeoService },
      ],
    }).compileComponents();
  });

  it('renders the start screen (title, description, count) with SEO', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Spanish');
    expect(el.textContent).toContain('Do you remember these words?');
    expect(el.textContent).toContain('2 notes');
    expect(el.textContent).toContain('Start quiz');
    // SEO is set from the quiz's own metadata, like NoteView does for notes.
    expect(seoStub.set).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Spanish', type: 'website', path: '/quiz/spanish' }),
    );
  });

  it('shows cumulative progress from localStorage on the start screen', async () => {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        version: 1,
        cards: { 'quiz/palabra': { known: 3, again: 1, lastResult: 'known', lastSeen: 1 } },
      }),
    );
    const fixture = await render();
    const progress = fixture.nativeElement.querySelector('.quiz-progress') as HTMLElement;
    expect(progress).toBeTruthy();
    expect(progress.textContent).toContain('1 of 2 reviewed · 1 known');
  });

  it('renders the empty-pool state with no start button', async () => {
    loadQuiz.mockResolvedValueOnce(EMPTY_QUIZ);
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No notes match these tags yet');
    expect(el.textContent).toContain('0 notes');
    const start = [...el.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Start quiz'),
    );
    expect(start).toBeUndefined();
  });

  it('starts a session and "I know it" advances + writes the stats key', async () => {
    const fixture = await render();
    click(fixture, 'Start quiz');

    // session screen: card face (title only) + remaining counter
    const first = currentTitle(fixture);
    expect(remaining(fixture)).toBe('2 remaining');
    expect(fixture.nativeElement.querySelector('.note-body')).toBeNull();

    click(fixture, 'I know it');
    expect(remaining(fixture)).toBe('1 remaining');
    expect(currentTitle(fixture)).not.toBe(first);

    // write-through: one graded card in the versioned, namespaced key
    const raw = localStorage.getItem(STATS_KEY);
    expect(raw, 'stats key missing after grade').toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(1);
    const entries = Object.values(parsed.cards) as Array<CardStats>;
    expect(entries).toHaveLength(1);
    expect(entries[0].known).toBe(1);
    expect(entries[0].again).toBe(0);
    expect(entries[0].lastResult).toBe('known');
    expect(typeof entries[0].lastSeen).toBe('number');
  });

  it('"Ask me again" re-queues the card to the end without shrinking the queue', async () => {
    const fixture = await render();
    click(fixture, 'Start quiz');
    const first = currentTitle(fixture);
    const other = QUIZ.notes.find((n) => n.title !== first)!.title;

    click(fixture, 'Ask me again');
    expect(remaining(fixture)).toBe('2 remaining');
    expect(currentTitle(fixture)).toBe(other);

    const parsed = JSON.parse(localStorage.getItem(STATS_KEY) as string);
    const entries = Object.values(parsed.cards) as Array<CardStats>;
    expect(entries).toHaveLength(1);
    expect(entries[0].again).toBe(1);
    expect(entries[0].lastResult).toBe('again');
  });

  it('"Remind me" fetches + reveals the body, disables itself, links to the note, no grade', async () => {
    const fixture = await render();
    click(fixture, 'Start quiz');
    const card = currentTitle(fixture);
    const slug = QUIZ.notes.find((n) => n.title === card)!.slug;

    click(fixture, 'Remind me');
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const body = el.querySelector('.note-body');
    expect(body?.textContent).toContain(`body of ${card}`);
    expect(loadNote).toHaveBeenCalledWith(slug);

    // button disabled after reveal; "Open note" link points at the note route
    const remind = [...el.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Remind me'),
    ) as HTMLButtonElement;
    expect(remind.disabled).toBe(true);
    const link = el.querySelector('a.quiz-open-note') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toContain(slug);

    // no grade: queue untouched, no stats written
    expect(remaining(fixture)).toBe('2 remaining');
    expect(localStorage.getItem(STATS_KEY)).toBeNull();
    expect(currentTitle(fixture)).toBe(card);
  });

  it('reveal caches the body per session — no refetch when a card cycles back', async () => {
    const fixture = await render();
    click(fixture, 'Start quiz');
    const first = currentTitle(fixture);
    const slug = QUIZ.notes.find((n) => n.title === first)!.slug;

    click(fixture, 'Remind me');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(loadNote).toHaveBeenCalledTimes(1);
    expect(loadNote).toHaveBeenCalledWith(slug);

    // send the card back to the end of the queue, clear the other card, and
    // the same card comes up again — the second reveal must hit the cache
    click(fixture, 'Ask me again');
    const other = QUIZ.notes.find((n) => n.title !== first)!.title;
    expect(currentTitle(fixture)).toBe(other);
    click(fixture, 'I know it');
    expect(currentTitle(fixture)).toBe(first);

    const callsBefore = loadNote.mock.calls.length;
    click(fixture, 'Remind me');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(loadNote.mock.calls.length).toBe(callsBefore);
    expect(
      (fixture.nativeElement.querySelector('.note-body') as HTMLElement).textContent,
    ).toContain(`body of ${first}`);
  });

  it('queue empty → end screen with session summary + per-card cumulative stats', async () => {
    const fixture = await render();
    click(fixture, 'Start quiz');
    click(fixture, 'I know it');
    click(fixture, 'I know it');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('This session: 2 known · 0 again');
    const results = [...el.querySelectorAll('.quiz-result')];
    expect(results).toHaveLength(2);
    for (const row of results) {
      expect(row.textContent).toContain('1 known · 0 again');
      expect(row.querySelector('.quiz-result-last')?.textContent?.trim()).toBe('known');
    }
  });

  it('"End session" exits mid-session; "Restart quiz" reshuffles into a new session', async () => {
    const fixture = await render();
    click(fixture, 'Start quiz');
    click(fixture, 'I know it'); // one card graded, one still queued

    click(fixture, 'End session');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('This session: 1 known · 0 again');
    const rows = [...el.querySelectorAll('.quiz-result')];
    expect(rows.some((r) => r.textContent?.includes('not reviewed'))).toBe(true);

    click(fixture, 'Restart quiz');
    expect(remaining(fixture)).toBe('2 remaining');
    expect(currentTitle(fixture)).toBeTruthy();
  });
});

describe('QuizView (SSR simulation)', () => {
  beforeEach(async () => {
    localStorage.clear();
    loadQuiz.mockReset();
    loadQuiz.mockResolvedValue(QUIZ);
    await TestBed.configureTestingModule({
      imports: [QuizView],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ContentService, useValue: contentStub as unknown as ContentService },
        { provide: SeoService, useValue: seoStub as unknown as SeoService },
      ],
    }).compileComponents();
  });

  it('renders the static start screen without localStorage and without crashing', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Spanish');
    expect(el.textContent).toContain('2 notes');
    expect(el.textContent).toContain('Start quiz');
    // the crawlable shell: no browser-only stats, and no session UI
    expect(el.querySelector('.quiz-progress')).toBeNull();
    expect(el.querySelector('.quiz-remaining')).toBeNull();
  });
});
