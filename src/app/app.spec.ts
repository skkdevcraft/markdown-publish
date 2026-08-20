import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Manifest } from '@shared/content-model';
import { App } from './app';
import { ContentService } from './content/content.service';

/** Minimal manifest so AppShell's nav/resource wiring resolves without I/O. */
const manifest: Manifest = {
  site: {
    title: 'Test',
    homeSlug: 'home',
    defaultTheme: 'light',
    url: '',
    description: '',
    lang: 'en',
    footer: '',
  },
  routes: [],
  nav: [],
};

/**
 * Hermetic stand-in for the fetch-based browser ContentService. Only
 * loadManifest is exercised by the shell smoke tests; the rest throw loudly
 * so an accidental deep render fails fast instead of hitting the network.
 */
const contentStub = {
  loadManifest: async (): Promise<Manifest> => manifest,
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

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        // RouterLink/RouterOutlet/ActivatedRoute need the router stack; empty
        // routes keep this shell smoke test from triggering app navigation
        // (the redirect-to-home guard and RouteDispatch would pull in views).
        provideRouter([]),
        { provide: ContentService, useValue: contentStub as unknown as ContentService },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the app shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-shell')).toBeTruthy();
  });
});
