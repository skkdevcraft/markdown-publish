import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  HostListener,
  inject,
  resource,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { ContentService } from '../content/content.service';
import { NavTree } from '../nav/nav-tree';
import { ThemeToggle } from '../theme/theme-toggle';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, NavTree, ThemeToggle],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  private readonly content = inject(ContentService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  protected readonly navOpen = signal(false);

  protected readonly manifest = resource({
    loader: () => this.content.loadManifest(),
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.navOpen.set(false));
  }

  @HostListener('document:keydown.escape')
  protected closeNav(): void {
    this.navOpen.set(false);
  }

  /**
   * Ctrl/Cmd+K jumps to the dedicated search page and focuses its input.
   * When already there, navigation is a no-op, so focus the input directly
   * (the input id is stable for exactly this).
   */
  @HostListener('document:keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') {
      return;
    }
    event.preventDefault();
    const input = this.doc.getElementById('search-input') as HTMLInputElement | null;
    if (this.router.url.startsWith('/search') && input) {
      input.focus();
      return;
    }
    void this.router.navigateByUrl('/search');
  }
}
