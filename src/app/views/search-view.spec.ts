import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SearchIndex } from '@shared/content-model';
import { ContentService } from '../content/content.service';
import { SeoService } from '../seo/seo.service';
import { SearchView } from './search-view';

const INDEX: SearchIndex = {
  docs: [
    {
      slug: 'mexico',
      title: 'México',
      url: '/mexico',
      text: 'México es un país de América.',
    },
  ],
};

const loadSearchIndex = vi.fn();

/** Hermetic stand-in for the fetch-based ContentService (app.spec.ts pattern):
 *  only the search index is stubbed; everything else throws loudly. */
const contentStub = {
  loadManifest: async () => {
    throw new Error('loadManifest not stubbed');
  },
  loadNote: async () => {
    throw new Error('loadNote not stubbed');
  },
  loadCanvas: async () => {
    throw new Error('loadCanvas not stubbed');
  },
  loadQuiz: async () => {
    throw new Error('loadQuiz not stubbed');
  },
  loadGraph: async () => {
    throw new Error('loadGraph not stubbed');
  },
  loadSearchIndex,
  loadTagIndex: async () => {
    throw new Error('loadTagIndex not stubbed');
  },
};

const seoStub = { set: vi.fn().mockResolvedValue(undefined) };

/** Protected component members, reachable at runtime from the spec. */
type SearchViewInternals = {
  query: { set(value: string): void };
  submit(): void;
  status(): string;
};

async function render(): Promise<ComponentFixture<SearchView>> {
  const fixture = TestBed.createComponent(SearchView);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('SearchView', () => {
  beforeEach(async () => {
    loadSearchIndex.mockReset();
    loadSearchIndex.mockResolvedValue(INDEX);
    seoStub.set.mockClear();
    await TestBed.configureTestingModule({
      imports: [SearchView],
      providers: [
        provideRouter([]),
        { provide: ContentService, useValue: contentStub as unknown as ContentService },
        { provide: SeoService, useValue: seoStub as unknown as SeoService },
      ],
    }).compileComponents();
  });

  it('renders marked excerpts for a query that matches', async () => {
    const fixture = await render();
    const view = fixture.componentInstance as unknown as SearchViewInternals;
    view.query.set('mexico');
    view.submit();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const marks = [...el.querySelectorAll('.result-excerpt mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['México']);
    expect(el.querySelector('.result-title')?.textContent).toContain('México');
  });

  it('shows the empty state for a query with no matches', async () => {
    const fixture = await render();
    const view = fixture.componentInstance as unknown as SearchViewInternals;
    view.query.set('zzzznotfound');
    view.submit();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No results for');
    expect(el.querySelectorAll('.result-excerpt mark')).toHaveLength(0);
  });

  it('shows the error state (not "no results") when the index fails to load', async () => {
    loadSearchIndex.mockRejectedValue(new Error('offline'));
    const fixture = await render();
    const view = fixture.componentInstance as unknown as SearchViewInternals;
    view.query.set('mexico');
    view.submit();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(view.status()).toBe('error');
    expect(el.textContent).toContain('Search is unavailable right now');
  });

  it('warm-up failure stays quiet until search is submitted', async () => {
    loadSearchIndex.mockRejectedValue(new Error('offline'));
    const fixture = await render();
    const view = fixture.componentInstance as unknown as SearchViewInternals;
    // the constructor's preload() rejected, but the page must still be idle
    expect(view.status()).toBe('idle');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Type a query');
  });

  it('sets SEO with a canonical for the search page', async () => {
    await render();
    expect(seoStub.set).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Search', path: '/search', type: 'website' }),
    );
  });
});
