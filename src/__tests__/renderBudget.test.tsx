import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import App from '../App';
import { setViewportWidth } from '../test/matchMediaMock';
import { renderWithTerminal } from '../test/renderWithTerminal';
import { useTerminal } from '../context/TerminalContext';

/**
 * Render-pass budget (plan §5, Phase 5 gate: at most 4 render passes per
 * market tick).
 *
 * A tick is a pure data push, so a correctly memoised tree commits once. The
 * budget exists to catch the failure mode where one tick cascades: an effect
 * that derives state, a context value rebuilt from scratch, a callback
 * recreated per frame — each adding another commit for the same second of
 * market data. React's `Profiler` counts *commits*, which is the number that
 * actually costs a frame, so that is what these tests assert on.
 */
describe('render budget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits a live panel at most once per market tick', () => {
    let commits = 0;
    let renderPasses = 0;

    // Every panel in the terminal subscribes to the live asset map exactly
    // this way, so if the tick fans out, it fans out here too.
    const MarketReadout: React.FC = () => {
      const { assets } = useTerminal();
      renderPasses += 1;
      return <span data-testid="symbols">{Object.keys(assets).join(',')}</span>;
    };

    renderWithTerminal(
      <React.Profiler
        id="panel"
        onRender={() => {
          commits += 1;
        }}
      >
        <MarketReadout />
      </React.Profiler>
    );

    const base = { commits, renderPasses };

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // A single data push must not cost a second pass over the tree: that is
    // what a derived-state effect or an unmemoised callback would cause.
    expect(renderPasses - base.renderPasses).toBeLessThanOrEqual(1);
    expect(commits - base.commits).toBeLessThanOrEqual(1);

    // Five more ticks, each still inside the 4-commits-per-tick gate.
    const marks = { commits, renderPasses };
    for (let tick = 0; tick < 5; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(renderPasses - marks.renderPasses).toBeLessThanOrEqual(5);
    expect(commits - marks.commits).toBeLessThanOrEqual(5);
  });

  it.each([
    ['MONITOR', /^MONITOR/],
    ['TRADE', /^TRADE/],
    ['ANALYTICS', /^ANALYTICS/],
    ['LEDGER', /^LEDGER/],
  ] as Array<[string, RegExp]>)('keeps the %s tab within budget for ten ticks', (_name, tabLabel) => {
    let commits = 0;

    // The profiler wraps the real application, so this is the whole terminal's
    // commit count for the window, not a stand-in's.
    render(
      <React.Profiler
        id="app"
        onRender={() => {
          commits += 1;
        }}
      >
        <App />
      </React.Profiler>
    );

    act(() => {
      screen.getByRole('button', { name: tabLabel }).click();
    });

    // Discard the commits caused by opening the tab — the clock is the cost
    // under test, not the navigation.
    const marks = commits;

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    // Plan §5: no more than 4 render passes per 1s tick.
    const allowedCommits = 10 * 4;
    expect(commits - marks).toBeLessThanOrEqual(allowedCommits);
  });

  it('keeps the ledger tab mounted and coherent across a tick burst', () => {
    render(<App />);

    act(() => {
      screen.getByRole('button', { name: /^LEDGER/ }).click();
    });

    const tablesBefore = screen.queryAllByRole('table').length;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // A burst of ticks must not crash the heaviest tab, nor swap its state
    // for another (an unmount/remount would change the table count).
    expect(screen.queryAllByRole('table').length).toBe(tablesBefore);
    expect(screen.getByRole('button', { name: /^LEDGER/ })).toHaveAttribute('aria-current', 'page');
  });
});

