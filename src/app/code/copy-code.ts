import { Directive, DOCUMENT, ElementRef, inject, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/* Copy-to-clipboard for fenced code blocks.
 *
 * Deliberately runtime-only chrome: the parser emits plain `<pre><code>` and
 * the same HTML feeds NoteView, QuizView, canvas nodes, the hover preview and
 * the WebMCP `get_note` tool. Emitting a button at build time would leak a
 * dead control into all of them (and into agent-facing HTML), so it is added
 * here and only on the surfaces that opt in via the `appCopyCode` attribute.
 *
 * Inline `<code>` is intentionally left alone: a tap-to-copy affordance there
 * fights native text selection, which is how people copy single words.
 */

/** Inline SVGs (repo convention: no icon library — see app-shell.html). */
const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_FAIL =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

type CopyState = 'idle' | 'copied' | 'failed';

const ICONS: Record<CopyState, string> = {
  idle: ICON_COPY,
  copied: ICON_CHECK,
  failed: ICON_FAIL,
};

const LABELS: Record<CopyState, string> = {
  idle: 'Copy code',
  copied: 'Copied',
  failed: 'Copy failed',
};

/** Long enough to read, short enough not to leave a stale green tick behind. */
const REVERT_MS = 2000;

@Directive({ selector: '[appCopyCode]' })
export class CopyCode implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private observer?: MutationObserver;

  /** Wrapping a `<pre>` is itself a childList mutation, so without this guard
   *  the observer would schedule a scan of the DOM it just mutated. */
  private scanning = false;

  /** Per-button revert timers, cleared on destroy so a detached button's
   *  timeout can't fire after the note it belonged to is gone. */
  private readonly revertTimers = new Map<HTMLButtonElement, number>();

  constructor() {
    if (!this.isBrowser) {
      return;
    }
    // Hydrated content is already in the DOM at construction time; async
    // content (resource fetch in NoteView, reveal in QuizView, swapping the
    // bound HTML) arrives later and is caught by the observer.
    this.enhanceAll();
    this.observer = new MutationObserver(() => this.enhanceAll());
    this.observer.observe(this.host.nativeElement, { childList: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    for (const timer of this.revertTimers.values()) {
      clearTimeout(timer);
    }
    this.revertTimers.clear();
  }

  /** Idempotent: `pre[data-copy-code]` marks blocks that already have chrome,
   *  so repeated scans (and re-renders of the same HTML) are no-ops. */
  private enhanceAll(): void {
    if (this.scanning) {
      return;
    }
    this.scanning = true;
    try {
      const blocks = this.host.nativeElement.querySelectorAll<HTMLPreElement>(
        'pre:not([data-copy-code])',
      );
      for (const pre of blocks) {
        this.enhance(pre);
      }
    } finally {
      this.scanning = false;
    }
  }

  /** The `<pre>` keeps `overflow-x: auto`, so the button must be a sibling of
   *  it (not a child) to stay pinned in the corner while long lines scroll
   *  underneath — a child would scroll out of reach. */
  private enhance(pre: HTMLPreElement): void {
    const parent = pre.parentNode;
    if (!parent) {
      return;
    }
    pre.setAttribute('data-copy-code', '');

    const wrap = this.doc.createElement('div');
    wrap.className = 'code-block';
    parent.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const status = this.doc.createElement('span');
    status.className = 'code-copy-status';
    // Sibling of the button, not a child: screen readers flatten a button's
    // contents into its name and would drop a nested live region.
    status.setAttribute('role', 'status');
    wrap.appendChild(status);

    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.innerHTML = `<span class="code-copy-icon" aria-hidden="true">${ICON_COPY}</span>`;
    button.addEventListener('click', () => void this.copy(pre, button));
    wrap.appendChild(button);
    this.setState(button, 'idle');
  }

  private async copy(pre: HTMLPreElement, button: HTMLButtonElement): Promise<void> {
    // textContent, not innerHTML: highlight.js spans contribute no text.
    // The fenced body carries a trailing newline from markdown-it — strip one
    // so a paste doesn't end with a blank line.
    const text = (pre.querySelector('code')?.textContent ?? pre.textContent ?? '').replace(
      /\n$/,
      '',
    );
    try {
      // Clipboard API only (no execCommand fallback): the failures it can hit
      // (insecure context, refused permission, missing API in in-app webviews)
      // are rare enough that a silent no-op would be worse than showing one.
      await navigator.clipboard.writeText(text);
      this.flash(button, 'copied');
    } catch (error) {
      console.warn('[copy-code] clipboard write failed', error);
      this.flash(button, 'failed');
    }
  }

  private flash(button: HTMLButtonElement, state: CopyState): void {
    const pending = this.revertTimers.get(button);
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    this.setState(button, state);
    this.revertTimers.set(
      button,
      window.setTimeout(() => {
        this.revertTimers.delete(button);
        this.setState(button, 'idle');
      }, REVERT_MS),
    );
  }

  private setState(button: HTMLButtonElement, state: CopyState): void {
    const icon = button.querySelector('.code-copy-icon');
    if (icon) {
      icon.innerHTML = ICONS[state];
    }
    button.setAttribute('aria-label', LABELS[state]);
    button.classList.toggle('is-copied', state === 'copied');
    button.classList.toggle('is-failed', state === 'failed');
    const status = button.parentElement?.querySelector('.code-copy-status');
    if (status) {
      status.textContent = state === 'idle' ? '' : LABELS[state];
    }
  }
}
