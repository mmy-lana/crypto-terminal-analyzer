/**
 * Rejection-diagnostics gate.
 *
 * The order callbacks are `useCallback`s, and their dependency list does not
 * include `schema` or `livePortfolio`. That is only safe if the callback never
 * reads them — and it used to. A rejection therefore quoted the cash balance
 * and position size captured by whichever render created the callback, which is
 * the *first* one, for the whole life of the terminal.
 *
 * The failure is quiet and very convincing: you spend two thirds of the
 * account, the panel updates, you order again, and the rejection tells you that
 * your $100,000 will not cover a $65,000 order. The number is right; it is
 * simply about a ledger that no longer exists.
 *
 * The remedy is now built inside the `runTransaction` updater, where `prev` is
 * the schema the order was actually judged against. These tests pin that.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import App from '../App';
import { setViewportWidth } from '../test/matchMediaMock';
import { formatCurrency } from '../utils/formatters';

/** The paper account opens with this much cash. */
const SEED_CASH = 100_000;

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  });
};

/** The transient notice bar, identified by the level badge that opens it. */
const noticeBanner = (): HTMLElement | null =>
  screen.getAllByRole('status').find((element) => /^(EXEC|WARN|INFO)/.test((element.textContent ?? '').trim())) ??
  null;

/** Arms a side on the ticket. */
const armSide = (name: RegExp): void => {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

/** Fills the ticket and submits it, asserting nothing about the outcome. */
const submit = async (side: 'BUY' | 'SELL', amount: string): Promise<void> => {
  act(() => {
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: amount } });
  });
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${side} .* BTC @ MARKET$`) }));
  });
  await flush();
};

const submitBuy = (amount: string): Promise<void> => submit('BUY', amount);

const openTradeWorkspace = (): void => {
  render(<App />);
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^TRADE/ }));
  });
};

describe('rejection diagnostics', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('quotes the cash balance the order was actually judged against', async () => {
    openTradeWorkspace();

    // Spend roughly two thirds of the account. BTC opens at $65,000, so one
    // fill takes the balance from $100,000 to somewhere near $34,000.
    await submitBuy('1.00');
    expect(noticeBanner()).toHaveTextContent(/^EXEC/);

    // The next order is far larger than what is left, so it is rejected.
    await submitBuy('1.00');
    const rejection = noticeBanner();
    expect(rejection).toHaveTextContent('Insufficient cash');

    const quoted = /\$([\d,]+\.\d{2}) will not cover/.exec(rejection?.textContent ?? '');
    expect(quoted, 'the rejection should name a cash balance').not.toBeNull();

    // The regression: this figure was frozen at the seed balance for the whole
    // session, so the rejection described an account the operator no longer has.
    const cash = Number((quoted?.[1] ?? '').replace(/,/g, ''));
    expect(cash).toBeLessThan(SEED_CASH * 0.75);
    expect(cash).toBeGreaterThan(0);
    expect(rejection).not.toHaveTextContent(formatCurrency(SEED_CASH));
  });

  it('quotes the position the order was actually judged against, not the seed', async () => {
    openTradeWorkspace();

    // The account seeds with 1.25 BTC. Buying 1 more leaves 2.25, so an
    // over-large sell must quote the grown position.
    await submitBuy('1.00');
    expect(noticeBanner()).toHaveTextContent(/^EXEC/);

    armSide(/^SELL$/i);
    await submit('SELL', '99');

    const notice = noticeBanner();
    expect(notice).toHaveTextContent('Position is smaller than the requested size');

    const remedy = /Sell at most ([\d.,]+) BTC/.exec(notice?.textContent ?? '');
    expect(remedy, 'the rejection should name a sellable size').not.toBeNull();

    // The regression: this figure was frozen at the seed holding for the whole
    // session, so a refusal to sell would advise dumping 1.25 BTC that the
    // operator had long since sold or doubled.
    const sellable = Number((remedy?.[1] ?? '').replace(/,/g, ''));
    expect(sellable).toBeGreaterThan(1.25);
  });
});
