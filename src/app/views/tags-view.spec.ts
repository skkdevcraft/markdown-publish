import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Manifest, TagIndex } from '@shared/content-model';
import { ContentService } from '../content/content.service';
import { SeoService } from '../seo/seo.service';
import { TagsView } from './tags-view';

const INDEX: TagIndex = {
  tags: [
    { name: 'quiz', slug: 'tags/quiz', count: 3 },
    { name: 'spanish', slug: 'tags/spanish', count: 2 },
  ],
};

const loadTagIndex = vi.fn();

/** Hermetic stand-in for the fetch-based ContentService (app.spec.ts pattern):
 *  only the tag index is stubbed; everything else throws loudly. */
const contentStub = {
  loadManifest: async (): Promise<Manifest> => {
    throw new Error('loadManifest not stubbed');
  },
  loadTagIndex,
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
  loadSearchIndex: async () => {
    throw new Error('loadSearchIndex not stubbed');
  },
};

const seoStub = { set: vi.fn().mockResolvedValue(undefined) };

async function render(): Promise<ComponentFixture<TagsView>> {
  const fixture = TestBed.createComponent(TagsView);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('TagsView', () => {
  beforeEach(async () => {
    loadTagIndex.mockReset();
    loadTagIndex.mockResolvedValue(INDEX);
    seoStub.set.mockClear();
    await TestBed.configureTestingModule({
      imports: [TagsView],
      providers: [
        provideRouter([]),
        { provide: ContentService, useValue: contentStub as unknown as ContentService },
        { provide: SeoService, useValue: seoStub as unknown as SeoService },
      ],
    }).compileComponents();
  });

  it('renders every tag as a #name pill with its count, in bundle order, each linking to its quiz', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const pills = [...el.querySelectorAll('a.tag-pill')];
    expect(pills).toHaveLength(2);
    // the parser already sorts count-descending then name-ascending — the view
    // must render the bundle's order untouched
    expect(pills.map((p) => p.querySelector('.tag-pill-name')?.textContent)).toEqual([
      '#quiz',
      '#spanish',
    ]);
    expect(pills.map((p) => p.querySelector('.tag-pill-count')?.textContent)).toEqual(['3', '2']);
    const hrefs = pills.map((p) => p.getAttribute('href'));
    expect(hrefs).toEqual(['/tags/quiz', '/tags/spanish']);
  });

  it('sets SEO with a description that mentions the tag count', async () => {
    await render();
    expect(seoStub.set).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tags', path: '/tags', type: 'website' }),
    );
    const [call] = seoStub.set.mock.calls;
    expect(call[0].description).toContain('2');
  });

  it('renders an empty state for a vault with no tags — no pills, no error', async () => {
    loadTagIndex.mockResolvedValueOnce({ tags: [] });
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('a.tag-pill')).toHaveLength(0);
    expect(el.textContent).toContain('No tags yet');
    expect(seoStub.set).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tags', description: 'No tags yet.' }),
    );
  });
});
