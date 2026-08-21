import { ChangeDetectionStrategy, Component, effect, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TagIndex } from '@shared/content-model';
import { ContentService } from '../content/content.service';
import { SeoService } from '../seo/seo.service';

/**
 * Tags index at /tags: every surviving frontmatter tag as a #name pill with
 * its note count, in the bundle's order (count descending, then name
 * ascending — the parser emits it already sorted, so the view renders rows
 * as-is and stays byte-deterministic across builds). Each pill links to the tag's
 * generated quiz route (tags/<slug>) via RouterLink, which bakes <base href>
 * into the href like every other app link. The SEO description carries the tag
 * count so crawlers see it in the prerendered head (PendingTasks keeps
 * serialization alive until the index resolves).
 */
@Component({
  selector: 'app-tags-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="tags-page">
      <header class="tags-head">
        <p class="tags-eyebrow">Index</p>
        <h1 class="tags-title">Tags</h1>
        @if (index.value(); as index) {
          @if (index.tags.length > 0) {
            <p class="tags-description">
              {{ index.tags.length }}
              {{ index.tags.length === 1 ? 'tag' : 'tags' }} — each with its own quiz deck.
            </p>
          }
        }
      </header>

      @if (index.value(); as index) {
        @if (index.tags.length > 0) {
          <ul class="tags-grid">
            @for (tag of index.tags; track tag.slug) {
              <li>
                <a class="tag-pill" [routerLink]="['/' + tag.slug]">
                  <span class="tag-pill-name">#{{ tag.name }}</span>
                  <span class="tag-pill-count">{{ tag.count }}</span>
                </a>
              </li>
            }
          </ul>
        } @else {
          <p class="tags-empty">No tags yet — tag a note and rebuild to see it here.</p>
        }
      } @else if (index.error()) {
        <p class="tags-error">Could not load the tag index.</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .tags-page {
        box-sizing: border-box;
        max-width: 720px;
        margin: 0 auto;
        padding: 48px 24px 96px;
      }

      .tags-eyebrow {
        margin: 0 0 0.4em;
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-faint);
      }

      .tags-title {
        margin: 0 0 0.4em;
        font-size: 2em;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -0.015em;
        color: var(--text-normal);
      }

      .tags-description {
        margin: 0 0 1.6em;
        font-size: 1.05em;
        line-height: 1.6;
        color: var(--text-muted);
      }

      .tags-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .tag-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px 6px 14px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        background: var(--background-primary-alt);
        color: var(--text-normal);
        font-size: 0.95rem;
        text-decoration: none;
        transition:
          border-color 140ms ease,
          background 140ms ease,
          color 140ms ease;
      }

      .tag-pill:hover {
        border-color: var(--interactive-accent);
        background: var(--background-modifier-hover);
        color: var(--text-accent);
      }

      .tag-pill-name {
        font-weight: 500;
      }

      .tag-pill-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        font-size: 0.78rem;
        font-weight: 600;
      }

      .tags-empty,
      .tags-error {
        margin: 2em 0 0;
        padding: 1.2em 1.4em;
        border: 1px dashed var(--background-modifier-border);
        border-radius: 8px;
        color: var(--text-muted);
      }
    `,
  ],
})
export class TagsView {
  private readonly content = inject(ContentService);
  private readonly seo = inject(SeoService);

  protected readonly index = resource({
    loader: () => this.content.loadTagIndex(),
  });

  constructor() {
    // The description mentions the tag count, so SEO waits for the index to
    // resolve (quiz pages use the same effect + PendingTasks pattern).
    effect(() => {
      const tags = this.index.value()?.tags;
      if (!tags) {
        return;
      }
      const n = tags.length;
      void this.seo.set({
        title: 'Tags',
        description:
          n === 0
            ? 'No tags yet.'
            : n === 1
              ? '1 tag, one quiz deck.'
              : `${n} tags, each with its own quiz deck.`,
        path: '/tags',
        type: 'website',
      });
    });
  }
}
