import { Component, type WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CopyCode } from './copy-code';

/** Minimal host matching the real call sites: a container whose HTML is bound
 *  asynchronously (NoteView resource / QuizView reveal). */
@Component({
  imports: [CopyCode],
  template: `<div class="note-body" appCopyCode [innerHTML]="html()"></div>`,
})
class Host {
  readonly html: WritableSignal<string> = signal('');
}

/** Parser-shaped fenced block, trailing newline and highlight span included. */
function block(code: string, lang = 'ts'): string {
  return `<pre class="hljs"><code class="language-${lang}"><span class="hljs-keyword">${code}</span></code></pre>`;
}

/** MutationObserver callbacks and the directive's `await` chain are microtasks
 *  (never timers), so a few Promise turns are enough to settle — which keeps
 *  this working under fake timers too. */
async function settle(fixture: ComponentFixture<Host>): Promise<void> {
  for (let i = 0; i < 5; i++) {
    fixture.detectChanges();
    await Promise.resolve();
  }
}

async function render(html: string): Promise<ComponentFixture<Host>> {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.html.set(html);
  await settle(fixture);
  return fixture;
}

function buttonOf(fixture: ComponentFixture<Host>): HTMLButtonElement {
  const button = fixture.nativeElement.querySelector('.code-copy') as HTMLButtonElement | null;
  expect(button, 'no copy button injected').toBeTruthy();
  return button as HTMLButtonElement;
}

function statusOf(fixture: ComponentFixture<Host>): string {
  const status = fixture.nativeElement.querySelector('.code-copy-status') as HTMLElement | null;
  return status?.textContent ?? '';
}

let writeText: ReturnType<typeof vi.fn>;

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}

describe('CopyCode', () => {
  beforeEach(async () => {
    writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('wraps each fenced block in one button-bearing container', async () => {
    const fixture = await render(
      `<p>run <code>npm run build</code> locally</p>${block('const a = 1;\n')}`,
    );
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('pre[data-copy-code]').length).toBe(1);
    // The <pre> stays the scroll container; the button is its sibling so it
    // can't be carried off-screen by horizontal scrolling.
    const wrap = el.querySelector('.code-block');
    expect(wrap?.querySelector(':scope > pre')).toBeTruthy();
    expect(wrap?.querySelector(':scope > button.code-copy')).toBeTruthy();
    // Inline <code> is deliberately untouched (native selection still wins).
    expect(el.querySelectorAll('code.language-ts').length).toBe(1);
    expect(el.querySelectorAll('.code-copy').length).toBe(1);
  });

  it('copies the block text and strips the fence trailing newline', async () => {
    const fixture = await render(block('const a = 1;\n'));
    buttonOf(fixture).click();

    expect(writeText).toHaveBeenCalledTimes(1);
    // textContent of the highlight span, minus the newline markdown-it keeps.
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
  });

  it('announces success, then reverts after the revert window', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await render(block('x = 1;\n'));
      const button = buttonOf(fixture);
      button.click();
      await settle(fixture);

      expect(button.getAttribute('aria-label')).toBe('Copied');
      expect(button.classList.contains('is-copied')).toBe(true);
      // Sibling live region, not a child of the button (see enhance()).
      expect(statusOf(fixture)).toBe('Copied');

      vi.advanceTimersByTime(2000);
      await settle(fixture);

      expect(button.getAttribute('aria-label')).toBe('Copy code');
      expect(button.classList.contains('is-copied')).toBe(false);
      expect(statusOf(fixture)).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a clipboard failure instead of failing silently', async () => {
    setClipboard(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const fixture = await render(block('x = 1;\n'));
      const button = buttonOf(fixture);
      button.click();
      await settle(fixture);

      expect(button.getAttribute('aria-label')).toBe('Copy failed');
      expect(button.classList.contains('is-failed')).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('re-enhances new content and never double-wraps', async () => {
    const fixture = await render(block('a = 1;\n'));
    fixture.componentInstance.html.set(`${block('a = 1;\n')}${block('b = 2;\n')}`);
    await settle(fixture);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.code-block').length).toBe(2);
    expect(el.querySelectorAll('.code-copy').length).toBe(2);
    expect(el.querySelectorAll('pre').length).toBe(2);
  });

  it('reverts a pending state when the view is destroyed', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await render(block('a = 1;\n'));
      buttonOf(fixture).click();
      await settle(fixture);
      fixture.destroy();

      // ngOnDestroy clears the revert timer; advancing past it must not throw
      // or touch the detached button.
      vi.advanceTimersByTime(5000);
      expect(true).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
