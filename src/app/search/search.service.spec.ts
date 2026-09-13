import { TestBed } from '@angular/core/testing';
import type { SearchIndex } from '@shared/content-model';
import { ContentService } from '../content/content.service';
import { SearchService } from './search.service';

const INDEX: SearchIndex = {
  docs: [
    {
      slug: 'mexico',
      title: 'México',
      url: '/mexico',
      text: 'México es un país de América. La Ciudad de México es su capital.',
    },
    {
      slug: 'correr',
      title: 'Correr',
      url: '/correr',
      text: 'Correr es un verbo. Correr por el parque es divertido.',
    },
    {
      slug: 'start',
      title: 'Start',
      url: '/start',
      text: 'A start is the beginning of something.',
    },
  ],
};

const loadSearchIndex = vi.fn();

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

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    loadSearchIndex.mockReset();
    loadSearchIndex.mockResolvedValue(INDEX);
    TestBed.configureTestingModule({
      providers: [{ provide: ContentService, useValue: contentStub as unknown as ContentService }],
    });
    service = TestBed.inject(SearchService);
  });

  it('returns no hits (and does not load the index) for a blank query', async () => {
    expect(await service.search('   ')).toEqual([]);
    expect(loadSearchIndex).not.toHaveBeenCalled();
  });

  it('matches substrings and ranks title hits above body-only hits', async () => {
    const hits = await service.search('correr');
    expect(hits.map((h) => h.slug)).toEqual(['correr']);
    // "start" appears only in a body and title that contain the query "art"
    const artHits = await service.search('art');
    expect(artHits.map((h) => h.slug)).toContain('start');
  });

  it('folds accents so an unaccented query matches accented text', async () => {
    const hits = await service.search('mexico');
    expect(hits.map((h) => h.slug)).toEqual(['mexico']);
  });

  it('splits the snippet into segments whose concatenation equals it', async () => {
    const [hit] = await service.search('mexico');
    expect(hit.segments.map((s) => s.text).join('')).toBe(hit.snippet);
    expect(hit.segments.some((s) => s.match)).toBe(true);
    // the matched run keeps the original spelling, not the folded query
    expect(hit.segments.find((s) => s.match)?.text).toBe('México');
  });

  it('respects the limit', async () => {
    const hits = await service.search('a', 1);
    expect(hits).toHaveLength(1);
  });

  it('preload warms the index so a later search does not re-fetch', async () => {
    await service.preload();
    await service.search('mexico');
    expect(loadSearchIndex).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load, so a later search retries', async () => {
    loadSearchIndex.mockRejectedValueOnce(new Error('offline'));
    await expect(service.search('mexico')).rejects.toThrow('offline');
    expect(loadSearchIndex).toHaveBeenCalledTimes(1);
    const hits = await service.search('mexico');
    expect(hits.map((h) => h.slug)).toEqual(['mexico']);
    expect(loadSearchIndex).toHaveBeenCalledTimes(2);
  });
});
