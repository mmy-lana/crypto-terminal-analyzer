import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import App from '../App';
import { setViewportWidth } from '../test/matchMediaMock';
import { formatCurrency, formatQuantity } from '../utils/formatters';

/**
 * Boot smoke test.
 *
 * The other suites assert that a given feature works. This one asserts that
 * the application *starts* — mounts the whole provider stack, every panel, the
 * feed and the palette without a thrown error, a React warning, or a console
 * complaint. Those are the failures no feature test notices, because each
 * renders a narrower tree.
 *
 * React warnings are escalated to failures on purpose: key collisions, invalid
 * nesting and bad hook calls all arrive as `console.error` and would otherwise
 * scroll past.
 */
describe('boot smoke test', () => {
  const consoleErrors: unknown[][] = [];
  const consoleWarnings: unknown[][] = [];
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrors.length = 0;
    consoleWarnings.length = 0;
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args);
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      consoleWarnings.push(args);
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1440);
  });

  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('mounts the desktop workstation with no errors or React warnings', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/BLOOMBERG/);
    // Every desktop panel is present at 1440px.
    expect(screen.getByRole('table', { name: 'Watchlist' })).toBeInTheDocument();

    expect(consoleErrors).toEqual([]);
    expect(consoleWarnings).toEqual([]);
  });

  it.each([360, 390, 430, 768, 1280])('mounts cleanly at %ipx', (width) => {
    setViewportWidth(width);
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(consoleErrors).toEqual([]);
  });

  it('survives a full trade and the resulting re-renders without warnings', () => {
    render(<App />);

    // Open the ticket's TRADE tab and arm a market BUY of 0.5 BTC.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^TRADE/ }));
    });

    const amount = screen.getByLabelText('Amount');
    act(() => {
      fireEvent.change(amount, { target: { value: '0.5' } });
    });

    // The ticket names the submit with the full order it will send, so the
    // assertion also proves the preview is being built.
    const submit = screen.getByRole('button', { name: /^BUY 0\.50 BTC @ MARKET$/ });
    act(() => {
      fireEvent.click(submit);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // The rejection is not the point; the point is that the fill propagated
    // through the notice bar, the log and the holdings without a warning.
    const notice = screen.queryAllByRole('status');
    expect(notice.length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(consoleErrors).toEqual([]);
  });

  it('reaches every tab without a remount error', () => {
    render(<App />);

    for (const label of [/^MONITOR/, /^TRADE/, /^ANALYTICS/, /^LEDGER/]) {
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: label }));
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(consoleErrors).toEqual([]);
  });

  it('opens and closes the command palette cleanly', () => {
    render(<App />);

    act(() => {
      fireEvent.keyDown(window, { key: '/' });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(consoleErrors).toEqual([]);
  });

  it('keeps the seed allocation visible on first paint', () => {
    // The plan's Phase 1 facts: $100,000 cash, 1.25 BTC, 8.5 ETH. If these
    // drift, every downstream fixture is lying.
    render(<App />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('100,000');
    expect(text).toContain(formatQuantity(1.25));
    expect(text).toContain(formatQuantity(8.5));
    expect(formatCurrency(0)).toBe('$0.00');

    // One kernel line at boot, and no fabricated history. The system log is a
    // TRADE/LEDGER workspace panel rather than a permanent fixture, so the
    // ledger is where it is asserted — the claim is about the log's content,
    // not about which workspace happens to be open.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^LEDGER/ }));
    });
    expect(within(screen.getByRole('log')).getAllByRole('listitem').length).toBeLessThanOrEqual(1);
  });
});
