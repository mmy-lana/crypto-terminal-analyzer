/**
 * Layout-integrity gates for the dense table surfaces and the depth canvas.
 *
 * Two of these assert defects that were present in the source rather than in
 * any test: a grid template with fewer tracks than cells (the surplus cell is
 * quietly placed in an implicit auto-sized track, so a column loses its width
 * and the body drifts out of alignment under the header — no exception, no
 * failure, just a table that does not line up), and a repaint skip keyed on a
 * fingerprint that did not cover everything the painter reads.
 *
 * The canvas cases count real draws by proxying the 2D stub, because the
 * failure mode is silent by construction: a stale or blank depth chart looks
 * exactly like a market that has gone quiet.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import App from '../App';
import { DepthVisualizer } from '../components/compound/DepthVisualizer';
import { OrderBookEntry, OrderBookState } from '../types/terminal';
import { setViewportWidth } from '../test/matchMediaMock';

const CELL_ROLES = ['cell', 'columnheader', 'rowheader'];

/**
 * Counts top-level tracks in a `grid-template-columns` value.
 *
 * A regex split is wrong here: `minmax(80px, 1fr)` contains a space, so
 * whitespace would count the argument list as a second track.
 */
function countTracks(template: string): number {
  let depth = 0;
  let tracks = 0;
  let inTrack = false;

  for (const char of template) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    }

    if (depth > 0) continue;
    if (/\s/.test(char)) {
      inTrack = false;
    } else if (!inTrack) {
      inTrack = true;
      tracks += 1;
    }
  }
  return tracks;
}

const countCells = (row: Element): number =>
  Array.from(row.children).filter((child) => CELL_ROLES.includes(child.getAttribute('role') ?? '')).length;

/**
 * Mobile renders a second nav surface, so the cue row and the overlay both
 * carry a MONITOR control. Either reaches the same workspace.
 */
const openWorkspace = (label: RegExp): void => {
  act(() => {
    const [control] = screen.getAllByRole('button', { name: label });
    if (control === undefined) throw new Error(`No control named ${String(label)}`);
    fireEvent.click(control);
  });
};

/**
 * Mounts the terminal and opens a real 0.1 BTC position.
 *
 * Both the ledger and the holdings table render an empty state rather than a
 * table until something settles, so a test measuring their rows has to have a
 * row to measure.
 */
const openPosition = (): void => {
  render(<App />);
  openWorkspace(/^TRADE/);
  act(() => {
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.1' } });
  });
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^BUY 0\.10 BTC @ MARKET$/ }));
  });
};

/** Every row in a table must declare one track per cell it actually renders. */
function expectRowsMatchTheirTracks(table: HTMLElement): void {
  const rows = table.querySelectorAll('[role="row"]');
  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    const cells = countCells(row);
    expect(cells).toBeGreaterThan(0);
    const template = (row as HTMLElement).style.gridTemplateColumns;
    expect(countTracks(template)).toBe(cells);
  }
}

describe('table grid tracks', () => {
  beforeEach(() => {
    setViewportWidth(1440);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives every ledger cell its own track, in the header and every body row', () => {
    openPosition();
    openWorkspace(/^LEDGER/);

    const table = screen.getByRole('table', { name: 'Settled executions' });
    expect(table.querySelectorAll('[role="row"]').length).toBeGreaterThan(1);
    expectRowsMatchTheirTracks(table);
  });

  it('adds a fifth watchlist track once the volume column is present', () => {
    // Wide viewport: showVolume is true, so the row is Symbol/Last/24h/Vol/MCap.
    // The template used to stay at four tracks, dropping MCap into an implicit
    // auto-sized one while its header sat in the fourth.
    render(<App />);
    openWorkspace(/^MONITOR/);
    const table = screen.getByRole('table', { name: 'Watchlist' });
    const header = table.querySelector('[role="row"]');
    expect(countCells(header as Element)).toBe(5);
    expectRowsMatchTheirTracks(table);
  });

  it('keeps the four-column watchlist honest when volume is hidden', () => {
    setViewportWidth(390);
    render(<App />);
    openWorkspace(/^MONITOR/);
    const table = screen.getByRole('table', { name: 'Watchlist' });
    const header = table.querySelector('[role="row"]');
    expect(countCells(header as Element)).toBe(4);
    expectRowsMatchTheirTracks(table);
  });
});

describe('holdings freeze pane', () => {
  beforeEach(() => {
    // Tablet, not phone. The positions panel is absent from the mobile layout
    // entirely, so below 768px there is no table for the freeze pane to act on;
    // it earns its keep from 768px up, where the nine-column table is wider
    // than the panel and scrolls sideways under a stationary symbol.
    setViewportWidth(900);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const PANEL_BACKGROUND = 'bg-[#12151a]';
  const backgroundClasses = (element: Element): string[] =>
    element.getAttribute('class')?.match(/bg-\[#[0-9a-fA-F]{6}\]/g) ?? [];

  /**
   * The colour a cell presents.
   *
   * A plain cell carries no background class at all — it is transparent over
   * the panel — so "no background" resolves to the panel colour. A cell that
   * painted itself differently does not, though: two background utilities on
   * one element is a precedence fight decided by stylesheet order, not by
   * where the class sits in the attribute, so the extra one cannot be treated
   * as harmless.
   */
  const presentedBackground = (element: Element): string | null => {
    const found = backgroundClasses(element);
    return found.length === 0 ? PANEL_BACKGROUND : found.length === 1 ? (found[0] ?? null) : null;
  };

  it('pins the symbol column while it scrolls horizontally', () => {
    openPosition();
    openWorkspace(/^MONITOR/);
    const table = screen.getByRole('table', { name: 'Open positions' });
    const firstBodyRow = table.querySelectorAll('[role="row"]')[1];
    const symbol = firstBodyRow?.querySelector('[role="rowheader"]') as HTMLElement;

    expect(symbol.className).toContain('sticky');
    expect(symbol.className).toContain('left-0');
  });

  it('keeps the frozen column the same colour as the rest of its own row', () => {
    openPosition();
    openWorkspace(/^MONITOR/);
    const table = screen.getByRole('table', { name: 'Open positions' });
    const rows = Array.from(table.querySelectorAll('[role="row"]')).slice(1);
    expect(rows.length).toBeGreaterThan(1);

    for (const row of rows) {
      const symbol = row.querySelector('[role="rowheader"]') as HTMLElement;
      const sibling = row.querySelector('[role="cell"]') as HTMLElement;

      // A freeze pane needs its own opaque background or rows show through it,
      // but a single hardcoded colour flattens the zebra stripe and the
      // selected-row highlight, leaving this cell disagreeing with the rest of
      // the row it belongs to. Exactly one background is the invariant: two is
      // an unresolvable ordering fight, and zero lets the rows show through.
      expect(backgroundClasses(symbol)).toHaveLength(1);
      expect(presentedBackground(symbol)).toBe(presentedBackground(sibling));
    }
  });
});

describe('depth canvas repaint skipping', () => {
  const level = (price: number, total: number): OrderBookEntry => ({ price, total, size: total });

  const makeBook = (bids: OrderBookEntry[], asks: OrderBookEntry[]): OrderBookState => ({
    symbol: 'BTC-USD',
    lastPrice: 100.5,
    bids,
    asks,
    spread: 1,
    spreadPercent: 1,
  });

  /**
   * Counts completed paints. Every frame starts with a `clearRect`, so the
   * counter is frames drawn, not incidental calls.
   */
  function trackDraws(): () => number {
    let draws = 0;
    const original = HTMLCanvasElement.prototype.getContext;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      contextId: string
    ) {
      const context = original.call(this, contextId) as CanvasRenderingContext2D | null;
      if (context === null) return context;

      return new Proxy(context, {
        get(target, property) {
          if (property === 'clearRect') return () => void (draws += 1);
          const value = Reflect.get(target, property) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {
          (target as unknown as Record<string | symbol, unknown>)[property] = value;
          return true;
        },
      }) as CanvasRenderingContext2D;
    });

    return () => draws;
  }

  /** The visualizer's container, whose box the test drives. */
  const containerOf = (): HTMLElement => screen.getByRole('img').parentElement as HTMLElement;

  it('repaints when an intermediate depth level changes', () => {
    const draws = trackDraws();

    // Both books agree on mid, best bid, best ask and the deepest cumulative
    // total on each side. They differ in the middle of the bid ladder, which
    // the polygon and its vertical scale are drawn from — so a skip keyed on
    // those five numbers alone leaves a stale curve on screen.
    const before = makeBook(
      [level(100, 5), level(99, 8), level(98, 12)],
      [level(101, 4), level(102, 9), level(103, 11)]
    );
    const after = makeBook(
      [level(100, 5), level(97, 9), level(98, 12)],
      [level(101, 4), level(102, 9), level(103, 11)]
    );

    const { rerender } = render(<DepthVisualizer book={before} />);
    const baseline = draws();

    rerender(<DepthVisualizer book={after} />);
    expect(draws()).toBeGreaterThan(baseline);
  });

  it('still repaints after a draw was declined for want of a box', () => {
    const draws = trackDraws();

    const before = makeBook(
      [level(100, 5), level(99, 8), level(98, 12)],
      [level(101, 4), level(102, 9), level(103, 11)]
    );
    const after = makeBook(
      [level(100, 6), level(99, 8), level(98, 13)],
      [level(101, 4), level(102, 9), level(103, 11)]
    );

    const { rerender } = render(<DepthVisualizer book={before} />);
    const afterFirstPaint = draws();
    expect(afterFirstPaint).toBeGreaterThan(0);

    // A hidden panel or a pre-layout frame has no box, and the HiDPI helper
    // correctly declines to paint. If that non-paint is remembered as a drawn
    // frame, the next real repaint is suppressed and the chart stays blank.
    containerOf().dataset.testWidth = '0';
    rerender(<DepthVisualizer book={after} />);
    const afterDeclinedDraw = draws();
    expect(afterDeclinedDraw).toBe(afterFirstPaint);

    containerOf().dataset.testWidth = '320';
    rerender(<DepthVisualizer book={{ ...after }} />);
    expect(draws()).toBeGreaterThan(afterDeclinedDraw);
  });
});
