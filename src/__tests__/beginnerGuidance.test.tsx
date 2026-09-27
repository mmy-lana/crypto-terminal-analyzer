/**
 * Beginner-guidance surface: metric tooltips, the walkthrough modal, and the
 * retro CRT toggle.
 *
 * The general accessibility audit already enforces the invariants these
 * features could break — 44px targets, accessible names, DOM-order focus — so
 * these tests cover what the audit cannot: that the controls do the thing they
 * claim, and that the dialog keeps the focus contract `aria-modal` promises.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import App from '../App';
import { setViewportWidth } from '../test/matchMediaMock';

const flushTimers = (): void => {
  act(() => {
    vi.advanceTimersByTime(0);
  });
};

const openTradeWorkspace = (): void => {
  render(<App />);
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^TRADE/ }));
  });
};

const overlay = (className: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.${className}`);

describe('metric tooltips', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('explains a jargon term on demand and is named for a screen reader', () => {
    render(<App />);

    const trigger = screen.getByRole('button', { name: 'Explain Sharpe' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Nothing is announced until asked for: a tooltip that fires on render
    // would talk over the market data.
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      fireEvent.click(trigger);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(/return earned per unit of volatility/i);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // The explanation is tied to the trigger, not announced on its own.
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('dismisses on Escape and on an outside click', () => {
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Explain Max drawdown' });

    act(() => {
      fireEvent.click(trigger);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      fireEvent.click(trigger);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('covers the headline portfolio metrics', () => {
    render(<App />);
    for (const term of [
      'Total equity',
      'Unrealized P&L',
      'Realized P&L',
      'Total P&L',
      'Sharpe',
      'Max drawdown',
      'Win rate',
      'Profit factor',
      'Daily volatility',
      'Fees paid',
    ]) {
      expect(screen.getByRole('button', { name: `Explain ${term}` })).toBeInTheDocument();
    }
  });

  it('explains the order type next to the toggle that changes it', () => {
    openTradeWorkspace();

    const trigger = screen.getByRole('button', { name: 'Explain Market order' });
    act(() => {
      fireEvent.click(trigger);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent(/taker fee/i);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: /^LIMIT$/ }));
    });

    // The explanation follows the selected type rather than staying stale.
    const limitTrigger = screen.getByRole('button', { name: 'Explain Limit order' });
    act(() => {
      fireEvent.click(limitTrigger);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent(/maker fee/i);
  });
});

describe('beginner guide modal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const openGuide = (): HTMLElement => {
    render(<App />);
    const launcher = screen.getByRole('button', { name: 'Beginner trading guide' });
    // A real browser moves focus to a button when it is pressed; jsdom does not,
    // and the dialog captures `document.activeElement` as the element to restore
    // focus to. Without this the focus-return contract cannot be observed.
    act(() => {
      launcher.focus();
    });
    act(() => {
      fireEvent.click(launcher);
    });
    flushTimers();
    return launcher;
  };

  it('is not rendered until it is asked for', () => {
    render(<App />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a labelled modal and moves focus into it', () => {
    openGuide();

    const dialog = screen.getByRole('dialog', { name: /Beginner Guide/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // `aria-modal` promises focus stays inside; the sheet has to honour that or
    // the promise is worse than no dialog at all.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and hands focus back to the launcher', () => {
    const launcher = openGuide();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it('closes from the backdrop', () => {
    openGuide();
    act(() => {
      fireEvent.click(document.querySelector<HTMLElement>('.fixed.inset-0') as HTMLElement);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from the close button', () => {
    openGuide();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close guide' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from the confirmation button', () => {
    openGuide();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Got It' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not dismiss when the click lands on the panel itself', () => {
    openGuide();
    const dialog = screen.getByRole('dialog');

    act(() => {
      fireEvent.click(dialog);
    });

    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('wraps Tab from the last control back to the first', () => {
    openGuide();
    const dialog = screen.getByRole('dialog');
    const last = screen.getByRole('button', { name: 'Got It' });
    const first = screen.getByRole('button', { name: 'Close guide' });

    act(() => {
      last.focus();
      fireEvent.keyDown(dialog, { key: 'Tab' });
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    });
    expect(document.activeElement).toBe(last);
  });
});

describe('retro CRT toggle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts clean, because scanlines cost legibility', () => {
    render(<App />);
    expect(overlay('scanline-overlay')).toBeNull();
    expect(overlay('vignette-overlay')).toBeNull();
  });

  it('adds the overlay on demand and reports its state', () => {
    render(<App />);
    const toggle = screen.getByRole('button', { name: /Retro CRT scanlines/ });

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName('Retro CRT scanlines, currently off');

    act(() => {
      fireEvent.click(toggle);
    });

    expect(overlay('scanline-overlay')).not.toBeNull();
    expect(overlay('vignette-overlay')).not.toBeNull();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName('Retro CRT scanlines, currently on');

    act(() => {
      fireEvent.click(toggle);
    });

    expect(overlay('scanline-overlay')).toBeNull();
  });

  it('keeps the decorative overlay out of the accessibility tree', () => {
    render(<App />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Retro CRT scanlines/ }));
    });

    expect(overlay('scanline-overlay')).toHaveAttribute('aria-hidden', 'true');
  });
});
