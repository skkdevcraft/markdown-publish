import { DOCUMENT, inject, Injectable } from '@angular/core';
import type {
  CanvasModel,
  GraphData,
  Manifest,
  Note,
  Quiz,
  SearchIndex,
  TagIndex,
} from '@shared/content-model';

/**
 * Loads the content bundle. Browser implementation (default) fetches the static
 * JSON copied to /content. The server (prerender) reads from the filesystem via
 * a provider override in app.config.server.ts (see ServerContentService).
 */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly doc = inject(DOCUMENT);
  private manifest?: Manifest;
  private graph?: GraphData;
  private searchIndex?: SearchIndex;
  private tagIndex?: TagIndex;

  async loadManifest(): Promise<Manifest> {
    if (!this.manifest) {
      this.manifest = await this.read<Manifest>('manifest.json');
    }
    return this.manifest;
  }

  loadNote(slug: string): Promise<Note> {
    return this.read<Note>(`notes/${safeSlug(slug)}.json`);
  }

  loadCanvas(slug: string): Promise<CanvasModel> {
    return this.read<CanvasModel>(`canvas/${safeSlug(slug)}.json`);
  }

  loadQuiz(slug: string): Promise<Quiz> {
    return this.read<Quiz>(`quiz/${safeSlug(slug)}.json`);
  }

  async loadGraph(): Promise<GraphData> {
    if (!this.graph) {
      this.graph = await this.read<GraphData>('graph.json');
    }
    return this.graph;
  }

  async loadSearchIndex(): Promise<SearchIndex> {
    if (!this.searchIndex) {
      this.searchIndex = await this.read<SearchIndex>('search-index.json');
    }
    return this.searchIndex;
  }

  /** Tag index for the /tags view: parser-sorted (count desc, name asc). The
   *  server variant inherits this read — both paths hit the same bundle file. */
  async loadTagIndex(): Promise<TagIndex> {
    if (!this.tagIndex) {
      this.tagIndex = await this.read<TagIndex>('tags.json');
    }
    return this.tagIndex;
  }

  protected async read<T>(relative: string): Promise<T> {
    // Resolve against <base href> so it works under a GitHub Pages project-site
    // subpath (user.github.io/<repo>/) as well as a root site. An absolute
    // "/content/..." would 404 on a subpath.
    const url = new URL(`content/${relative}`, this.doc.baseURI);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load content/${relative}: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

/** Reject path-traversal in slugs (e.g. from the WebMCP get_note tool) before
 *  they reach a filesystem read (server) or cross-origin fetch normalization. */
function safeSlug(slug: string): string {
  if (
    !slug ||
    slug.includes('\\') ||
    slug.startsWith('/') ||
    slug.split('/').some((seg) => seg === '..' || seg === '.')
  ) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  return slug;
}
