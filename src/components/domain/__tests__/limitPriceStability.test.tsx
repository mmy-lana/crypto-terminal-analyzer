/**
 * Regression gate for the LIMIT price field.
 *
 * The mark price moves on every 1s tick, and the ticket used to re-seed the
 * limit price from that tick. An operator typing "6" and reaching for a decimal
 * point lost the character once a second, so a limit order could not be entered
 * at all. These tests pin the behaviour in both directions: a half-typed price
 * survives ticks, and a freshly armed LIMIT ticket still picks the mark up.
 *
 * The feed is driven by fake timers, so a tick is instant and deterministic.
 * Input is set with `fireEvent` rather than `userEvent` because user-event's
 * internal delays deadlock against fake timers in this setup; the value under
 * test is the field's own, either way.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { TerminalProvider, useTerminal } from '../../../context/TerminalContext';
import { ExecutionTerminal } from '../ExecutionTerminal';
import { MARKET_TICK_INTERVAL_MS } from '../../../services/marketFeed';

function Harness(): React.ReactElement {
  return (
    <TerminalProvider>
      <ExecutionTerminal />
    </TerminalProvider>
  );
}

/** The ticket form, so the ledger's identically named controls stay out. */
function ticket(): HTMLElement {
  return screen.getByRole('form', { name: /order ticket/i });
}

function priceField(): HTMLInputElement {
  return within(ticket()).getByLabelText(/^limit price$/i) as HTMLInputElement;
}

/** The mark the field is quoting, read through the hint TerminalInput points at. */
function markHint(field: HTMLInputElement): string {
  const hintId = (field.getAttribute('aria-describedby') ?? '').split(' ')[0] ?? '';
  return hintId === '' ? '' : (document.getElementById(hintId)?.textContent ?? '');
}

function type(field: HTMLInputElement, value: string): void {
  fireEvent.change(field, { target: { value } });
}

function press(label: string): void {
  fireEvent.click(within(ticket()).getByRole('button', { name: label }));
}

/** Advance the market feed by whole ticks, wrapped so React can flush. */
function tick(times = 1): void {
  act(() => {
    vi.advanceTimersByTime(MARKET_TICK_INTERVAL_MS * times);
  });
}

describe('limit price stability under live ticks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a partially typed price while the mark moves on every tick', () => {
    render(<Harness />);

    press('LIMIT');
    const field = priceField();
    type(field, '65');

    // The tick has to actually land, or this test proves nothing.
    const markBefore = markHint(field);
    tick();
    expect(markHint(field)).not.toBe(markBefore);

    expect(field.value).toBe('65');

    // Three more seconds of tape — well past the point at which an effect
    // declared against markPrice would have overwritten the caret.
    tick(3);
    expect(field.value).toBe('65');
  });

  it('still re-seeds from the mark when a LIMIT ticket is armed afresh', () => {
    render(<Harness />);

    press('LIMIT');
    const seeded = priceField().value;
    expect(seeded).not.toBe('');

    type(priceField(), '12');
    expect(priceField().value).toBe('12');

    // Re-arming LIMIT is an explicit re-price, not a tick.
    press('MARKET');
    press('LIMIT');

    expect(priceField().value).toBe(seeded);
  });

  it('re-prices when the instrument changes, not on every tick of the old one', () => {
    // The watchlist owns instrument selection in the real app; the provider's
    // own setter is the same path, without dragging the whole terminal in.
    function Switcher(): React.ReactElement {
      const { setSelectedSymbol } = useTerminal();
      return (
        <button type="button" onClick={() => setSelectedSymbol('ETH')}>
          Switch to ETH
        </button>
      );
    }

    render(
      <TerminalProvider>
        <Switcher />
        <ExecutionTerminal />
      </TerminalProvider>
    );

    press('LIMIT');
    const btcPrice = priceField().value;
    expect(btcPrice).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: /switch to eth/i }));

    expect(priceField().value).not.toBe(btcPrice);
  });
});
