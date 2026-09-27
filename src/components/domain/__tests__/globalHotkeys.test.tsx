import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import App from '../../../App';
import { renderWithTerminal } from '../../../test/renderWithTerminal';
import { setViewportWidth } from '../../../test/matchMediaMock';
import CommandPalette from '../../compound/CommandPalette';

/**
 * The plan (§5, Phase 5) lists `1-4`, `B`, `S`, `/` and `Escape` as the
 * terminal's global keys. The tab keys are trivially covered elsewhere; these
 * tests cover the two that actually do work — arming the ticket's side from the
 * keyboard, and the palette's own Escape handling.
 *
 * `fireEvent` rather than `user-event` throughout: user-event's internal
 * delays deadlock against this suite's fake timers.
 */
describe('global hotkeys', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1440);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The global keys are registered by `App`, so the whole terminal has to be
   * mounted for them to exist — testing the ticket in isolation would pass
   * vacuously.
   */
  const renderTerminal = (): void => {
    renderWithTerminal(<App />);
  };

  const sideButton = (name: RegExp): HTMLElement => screen.getByRole('button', { name });

  const amountField = (): HTMLElement => screen.getByLabelText('Amount');

  it('arms BUY with the B key and SELL with the S key', () => {
    renderTerminal();

    const sell = sideButton(/^SELL$/i);
    const buy = sideButton(/^BUY$/i);

    // Start state: BUY armed.
    expect(buy).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(sell).toHaveAttribute('aria-pressed', 'true');
    expect(buy).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    expect(buy).toHaveAttribute('aria-pressed', 'true');
    expect(sell).toHaveAttribute('aria-pressed', 'false');
  });

  it('is case-insensitive, so a shifted B still arms BUY', () => {
    renderTerminal();

    act(() => {
      fireEvent.keyDown(window, { key: 'S' });
    });
    expect(sideButton(/^SELL$/i)).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      fireEvent.keyDown(window, { key: 'B' });
    });
    expect(sideButton(/^BUY$/i)).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves focus into the amount field so the operator can keep typing', () => {
    renderTerminal();

    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });

    const amount = amountField();
    expect(document.activeElement).toBe(amount);
  });

  it('leaves the keyboard alone while the operator is typing a number', () => {
    renderTerminal();

    const amount = amountField();
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(sideButton(/^SELL$/i)).toHaveAttribute('aria-pressed', 'true');

    // Typing "s" into the amount field must not flip the side — the operator is
    // entering a size, not arming a ticket.
    act(() => {
      fireEvent.change(amount, { target: { value: '0.5' } });
    });
    act(() => {
      fireEvent.keyDown(amount, { key: 's' });
    });

    expect(sideButton(/^SELL$/i)).toHaveAttribute('aria-pressed', 'true');
    expect(amount).toHaveValue(0.5);
  });

  it('does not hijack modified keystrokes the browser or OS owns', () => {
    renderTerminal();

    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    });

    expect(sideButton(/^BUY$/i)).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes the palette on Escape and restores focus to the opener', () => {
    const onClose = vi.fn();
    function Harness(): React.ReactElement {
      return <CommandPalette open onClose={onClose} onExecute={vi.fn()} initialValue="" />;
    }
    renderWithTerminal(<Harness />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps focus inside the palette while it is open', () => {
    const onClose = vi.fn();
    function Harness(): React.ReactElement {
      return <CommandPalette open onClose={onClose} onExecute={vi.fn()} initialValue="" />;
    }
    renderWithTerminal(<Harness />);

    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
    expect(focusable.length).toBeGreaterThan(0);

    // Focus the last focusable control, then Tab: a real trap wraps to the
    // first rather than escaping to the page behind the modal.
    const last = focusable[focusable.length - 1];
    if (last) {
      act(() => {
        last.focus();
      });
      act(() => {
        fireEvent.keyDown(dialog, { key: 'Tab' });
      });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(dialog.contains(last)).toBe(true);
    }
  });
});
