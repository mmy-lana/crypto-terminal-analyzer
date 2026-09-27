/**
 * Workspace routing gate.
 *
 * The header tabs and the `1`-`4` hotkeys set `activeTab`, but for a long time
 * the desktop and tablet layouts ignored it and rendered every panel at once —
 * four tabs, one undifferentiated wall, and no way to reach the ledger or the
 * analytics inspector at all. A tab that changes nothing is worse than no tab,
 * because the operator believes they have narrowed the view and they have not.
 *
 * These tests assert both directions for every workspace: the panels a tab
 * promises are mounted, *and* the panels it does not belong to are gone. The
 * negative half is the one that catches a regression to the old wall-of-panels
 * behaviour, which a positive-only assertion would sail straight past.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import App from '../App';
import { setViewportWidth } from '../test/matchMediaMock';

/** Panel titles, which `TerminalPanel` renders as its `<h2>`. */
const PANEL = {
  watchlist: 'MARKET WATCH // SPOT',
  book: 'ORDER BOOK // L2 DEPTH',
  ticket: 'EXECUTION TERMINAL',
  summary: 'PORTFOLIO // RISK',
  holdings: 'POSITIONS',
  log: 'SYSTEM LOG',
  ledger: 'TRANSACTION LEDGER',
  analytics: 'ANALYTICS INSPECTOR',
} as const;

type PanelName = keyof typeof PANEL;

/** Mounts the terminal and switches to the named workspace. */
const openWorkspace = (label: RegExp): void => {
  render(<App />);
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: label }));
  });
};

const isMounted = (panel: PanelName): boolean =>
  screen.queryByRole('heading', { level: 2, name: PANEL[panel] }) !== null;

const expectPanels = (present: PanelName[], absent: PanelName[]): void => {
  for (const panel of present) expect(isMounted(panel), `${panel} should be mounted`).toBe(true);
  for (const panel of absent) expect(isMounted(panel), `${panel} should not be mounted`).toBe(false);
};

describe('desktop workspaces', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('MONITOR shows the market and hides the ticket', () => {
    openWorkspace(/^MONITOR/);
    expectPanels(['watchlist', 'book', 'holdings', 'summary'], ['ticket', 'ledger', 'analytics', 'log']);
  });

  it('TRADE shows the ticket and hides the analytics', () => {
    openWorkspace(/^TRADE/);
    expectPanels(['watchlist', 'book', 'ticket', 'log'], ['holdings', 'summary', 'ledger', 'analytics']);
  });

  it('ANALYTICS reveals the inspector, which no other workspace reaches', () => {
    openWorkspace(/^ANALYTICS/);
    expectPanels(['summary', 'analytics', 'holdings'], ['watchlist', 'book', 'ticket', 'log', 'ledger']);
  });

  it('LEDGER reveals the settlement history, which no other workspace reaches', () => {
    openWorkspace(/^LEDGER/);
    expectPanels(['ledger', 'log', 'summary'], ['watchlist', 'book', 'ticket', 'holdings', 'analytics']);
  });

  it('never shows the ticket and the analytics inspector at the same time', () => {
    render(<App />);

    for (const label of [/^MONITOR/, /^TRADE/, /^ANALYTICS/, /^LEDGER/]) {
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: label }));
      });
      expect(isMounted('ticket') && isMounted('analytics')).toBe(false);
    }
  });

  it('reaches every workspace from the number keys', () => {
    render(<App />);

    const expected: Array<[string, PanelName]> = [
      ['1', 'watchlist'],
      ['2', 'ticket'],
      ['3', 'analytics'],
      ['4', 'ledger'],
    ];

    for (const [key, panel] of expected) {
      act(() => {
        fireEvent.keyDown(window, { key });
      });
      expect(isMounted(panel), `key ${key} should open the ${panel} panel`).toBe(true);
    }
  });
});

describe('tablet workspaces', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(768);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('MONITOR shows the market and hides the ticket', () => {
    openWorkspace(/^MONITOR/);
    expectPanels(['watchlist', 'book', 'holdings'], ['ticket', 'ledger', 'analytics', 'log']);
  });

  it('TRADE shows the ticket and hides the analytics', () => {
    openWorkspace(/^TRADE/);
    expectPanels(['book', 'ticket', 'log'], ['watchlist', 'holdings', 'summary', 'ledger', 'analytics']);
  });

  it('ANALYTICS reveals the inspector', () => {
    openWorkspace(/^ANALYTICS/);
    expectPanels(['summary', 'analytics', 'holdings'], ['watchlist', 'book', 'ticket', 'log', 'ledger']);
  });

  it('LEDGER reveals the settlement history', () => {
    openWorkspace(/^LEDGER/);
    expectPanels(['ledger', 'log'], ['watchlist', 'book', 'ticket', 'holdings', 'analytics', 'summary']);
  });
});
