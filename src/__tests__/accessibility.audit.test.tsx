/// <reference types="node" />
// The one assertion below reads `src/index.css` off disk. Vitest stubs CSS
// imports to an empty module, so `?raw` yields nothing here; the Node types
// are pulled in for this file only, which keeps `process` and `node:*` out of
// the app's own type environment rather than widening `types` project-wide.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setViewportWidth } from '../test/matchMediaMock';
import { renderApp } from '../test/renderWithTerminal';

/**
 * Responsive and accessibility gate.
 *
 * jsdom has no layout engine — `offsetWidth` is always 0 and nothing reflows —
 * so this cannot measure overflow directly. It audits the *contract* that
 * produces a non-overflowing layout instead: every touch target declares a
 * 44px minimum, every wide grid is wrapped in a horizontal scroller, the
 * breakpoint changes the rendered structure rather than only CSS, and every
 * interactive and graphic element carries the name assistive tech needs.
 *
 * Overflow itself still needs a real browser; this suite is the automated half
 * of that check, not a replacement for it.
 */

const PHONE_WIDTHS = [360, 390, 430];
const TABLET_WIDTH = 768;
const DESKTOP_WIDTH = 1280;

/** Minimum touch target from the plan's mobile matrix (plan §5). */
const MIN_TOUCH_TARGET_PX = 44;

function interactiveElements(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
}

function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim().length > 0) return ariaLabel.trim();

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text.length > 0) return text;
  }

  const title = element.getAttribute('title');
  if (title && title.trim().length > 0) return title.trim();

  const own = element.textContent ?? '';
  if (own.trim().length > 0) return own.trim();

  // An associated <label for=…> or a wrapping <label>.
  const id = element.getAttribute('id');
  if (id) {
    const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrappingLabel = element.closest('label');
  if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();

  return '';
}

afterEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

describe('accessible names', () => {
  it('gives every interactive element a name', () => {
    renderApp();
    const unnamed = interactiveElements(document.body).filter(
      (element) => accessibleName(element).length === 0
    );
    expect(unnamed.map((element) => element.outerHTML.slice(0, 120))).toEqual([]);
  });

  it('labels every form control', () => {
    renderApp();
    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea'
      )
    );
    const unlabelled = controls.filter((element) => {
      if ((element as HTMLInputElement).type === 'hidden') return false;
      return accessibleName(element).length === 0;
    });
    expect(unlabelled.map((element) => element.outerHTML.slice(0, 120))).toEqual([]);
  });

  it('names or hides every graphic', () => {
    renderApp();
    const graphics = Array.from(document.querySelectorAll('svg, canvas, img'));
    const broken = graphics.filter((element) => {
      if (element.getAttribute('aria-hidden') === 'true') return false;
      if (element.getAttribute('role') === 'presentation' || element.getAttribute('role') === 'none') return false;
      return accessibleName(element).length === 0;
    });
    expect(broken.map((element) => element.outerHTML.slice(0, 120))).toEqual([]);
  });

  it('never leaves a chart or price hidden from assistive tech silently', () => {
    renderApp();
    // Every <svg> in the terminal is a data visualisation: it must either be
    // hidden deliberately or carry a description, never be left unnamed.
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      const labelled =
        svg.getAttribute('aria-hidden') === 'true' ||
        accessibleName(svg).length > 0 ||
        svg.getAttribute('aria-label') !== null;
      expect(labelled, svg.outerHTML.slice(0, 160)).toBe(true);
    }
  });
});

describe('heading structure', () => {
  it('has exactly one h1', () => {
    renderApp();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('never skips a heading level', () => {
    renderApp();
    const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) =>
      Number(heading.tagName.slice(1))
    );

    let previous = 0;
    for (const level of levels) {
      expect(level - previous, `jumped to h${level} after h${previous}`).toBeLessThanOrEqual(1);
      previous = level;
    }
  });
});

describe('touch targets', () => {
  /**
   * Reads the smallest declared box in px out of a control's class list.
   *
   * A regex that only looks for the literal `min-h-[44px]` would silently pass
   * a 28px control, and would also fail a 52px thumb dock that is comfortably
   * above the threshold — so the declared value is parsed and compared.
   */
  const declaredMinimumPx = (className: string): number => {
    const values = [...className.matchAll(/(?:^|[\s:])(?:min-)?[hw]-\[(\d+)px\]/g)].map((match) =>
      Number.parseInt(match[1] ?? '0', 10)
    );
    return values.length === 0 ? 0 : Math.min(...values);
  };

  for (const width of PHONE_WIDTHS) {
    it(`declares a 44px minimum on every control at ${width}px`, () => {
      setViewportWidth(width);
      renderApp();

      const tooSmall = interactiveElements(document.body).filter(
        (element) => declaredMinimumPx(element.className ?? '') < MIN_TOUCH_TARGET_PX
      );

      // A deliberate, documented exception list — each entry names the control
      // and why a 44px box is wrong for it.
      const ALLOWED = [
        // The steppers own a 44px wrapper; the glyph inside is smaller on purpose.
        /aria-label="(Increase|Decrease) /,
      ];

      const violations = tooSmall
        .filter((element) => !ALLOWED.some((pattern) => pattern.test(element.outerHTML)))
        .map((element) => element.outerHTML.slice(0, 140));

      expect(violations).toEqual([]);
    });
  }

  it('keeps every control on the phone tab bar at 44px', () => {
    setViewportWidth(390);
    renderApp();
    const tabbar = screen.getByRole('navigation', { name: 'Terminal section dock' });
    const buttons = within(tabbar).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(declaredMinimumPx(button.className)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });
});

describe('horizontal overflow containment', () => {
  for (const width of [...PHONE_WIDTHS, TABLET_WIDTH, DESKTOP_WIDTH]) {
    it(`wraps every min-width grid track in a scroller at ${width}px`, () => {
      setViewportWidth(width);
      renderApp();

      // A grid with a floor wider than the phone viewport must live inside an
      // overflow-x container, or it widens the whole page.
      const wideTracks = Array.from(document.querySelectorAll<HTMLElement>('div')).filter((element) =>
        (element.className ?? '').includes('min-w-[360px]')
      );
      expect(wideTracks.length).toBeGreaterThan(0);

      const uncontained = wideTracks.filter((track) => {
        const wrapper = track.parentElement;
        return !(wrapper?.className ?? '').includes('overflow-x-auto');
      });

      expect(uncontained.map((track) => track.className)).toEqual([]);
    });
  }

  it('never renders a fixed pixel width wider than the phone viewport', () => {
    setViewportWidth(360);
    renderApp();

    const tooWide: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      // `className` is an SVGAnimatedString on SVG nodes, not a string.
      const className = typeof element.className === 'string' ? element.className : '';
      const width = Number.parseInt(
        (className.match(/(?:^|[\s:])w-\[(\d+)px\]/) ?? [])[1] ?? '',
        10
      );
      if (!Number.isFinite(width) || width <= 360) continue;

      // Permitted only when an ancestor scrolls on the x axis.
      let ancestor: HTMLElement | null = element.parentElement;
      let scrollable = false;
      while (ancestor) {
        if ((ancestor.className ?? '').includes('overflow-x-auto')) {
          scrollable = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!scrollable) tooWide.push(`${element.tagName}.${element.className}`);
    }

    expect(tooWide).toEqual([]);
  });
});

describe('breakpoint structure', () => {
  it('shows the phone dock and a 5-deep book at 360px', () => {
    setViewportWidth(360);
    renderApp();

    expect(screen.getByRole('navigation', { name: 'Terminal sections' })).toBeTruthy();
    // Five asks plus the spread row.
    const asks = screen.getByRole('table', { name: 'Ask depth ladder' });
    expect(within(asks).getAllByRole('row')).toHaveLength(1 + 5);
  });

  it('shows a 12-deep book at desktop width', () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderApp();

    const asks = screen.getByRole('table', { name: 'Ask depth ladder' });
    expect(within(asks).getAllByRole('row').length).toBeGreaterThan(6);
  });

  it('never renders more than 12 ladder levels on any viewport', () => {
    for (const width of [...PHONE_WIDTHS, TABLET_WIDTH, DESKTOP_WIDTH]) {
      setViewportWidth(width);
      const view = renderApp();
      for (const name of ['Ask depth ladder', 'Bid depth ladder']) {
        const rows = within(screen.getByRole('table', { name })).getAllByRole('row').length - 1;
        expect(rows, `${name} at ${width}px`).toBeLessThanOrEqual(12);
      }
      view.unmount();
    }
  });
});

describe('hover independence', () => {
  it('never makes a control reachable only through hover', () => {
    setViewportWidth(360);
    renderApp();

    // Every hover-only affordance would need `hover:` with no always-visible
    // equivalent. Detecting that reliably needs CSS, so the check here is the
    // structural half: no element carries `hover:` on opacity alone to reveal
    // itself, and every button is a real <button> reachable by keyboard.
    const hoverOnly = Array.from(document.querySelectorAll<HTMLElement>('[class*="hover:opacity-0"]')).filter(
      (element) => !(element.className ?? '').includes('hover:opacity-100')
    );

    expect(hoverOnly.map((element) => element.className)).toEqual([]);
  });

  it('uses real buttons and links, never a clickable div or span', () => {
    renderApp();
    const clickableNonControls = Array.from(
      document.querySelectorAll<HTMLElement>('[onclick]')
    ).filter((element) => !['BUTTON', 'A', 'INPUT'].includes(element.tagName));
    expect(clickableNonControls).toEqual([]);
  });

  it('keeps every focusable element keyboard reachable in DOM order', () => {
    renderApp();
    const focusables = interactiveElements(document.body);
    expect(focusables.length).toBeGreaterThan(0);
    for (const element of focusables) {
      if (element.getAttribute('role') === 'button' && element.tagName !== 'BUTTON') continue;
      expect(element.getAttribute('tabindex')).not.toBe('-1');
    }
  });
});

describe('live regions', () => {
  it('announces the system log politely', () => {
    // The log is a TRADE/LEDGER workspace panel, not a permanent fixture, so
    // the audit opens a workspace that owns it before checking the contract.
    renderApp();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^LEDGER/ }));
    });

    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });
});

describe('reduced motion', () => {
  it('is honoured in the stylesheet for continuous market motion', async () => {
    // The ticker tape and the 1s tick are the only continuous animations; both
    // must stop when the user asks for reduced motion. `?raw` is Vite's own
    // typed text import, so this needs no Node types in a browser project.
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const css = await readFile(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toMatch(/@media[^{]*prefers-reduced-motion/);
  });
});
