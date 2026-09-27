/**
 * Phase 4 verification gate.
 *
 * Drives a complete trade through the real provider stack and asserts that the
 * five surfaces the plan names all move together: holdings, risk metrics, the
 * system log, the cash balance, and the settlement ledger. The order is placed
 * through the actual ticket UI and the expected cash is recomputed here from
 * the engine's own fee and slippage rules, so a drift between the ticket and
 * the ledger fails the test instead of being asserted against itself.
 *
 * The account is seeded with an open BTC position and $100,000 of cash, so the
 * assertions below are written against that state rather than an empty book.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TerminalProvider, useTerminal } from '../../../context/TerminalContext';
import { ExecutionTerminal } from '../ExecutionTerminal';
import { HoldingsTable } from '../HoldingsTable';
import { PortfolioSummaryPanel } from '../PortfolioSummaryPanel';
import { TransactionLedger } from '../TransactionLedger';
import { SystemLogFeed } from '../../compound/SystemLogFeed';
import { MAKER_FEE_RATE, TAKER_FEE_RATE, applySlippage } from '../../../utils/engine';
import { formatCurrency, formatQuantity } from '../../../utils/formatters';

function Probe(): React.ReactElement {
  const { livePortfolio, riskMetrics, schema, selectedAsset } = useTerminal();
  return (
    <dl>
      <dd data-testid="cash">{schema.cashBalance}</dd>
      <dd data-testid="equity">{riskMetrics.totalEquity}</dd>
      <dd data-testid="unrealized">{riskMetrics.unrealizedPnL}</dd>
      <dd data-testid="orders">{schema.orders.length}</dd>
      <dd data-testid="transactions">{schema.transactions.length}</dd>
      <dd data-testid="mark">{selectedAsset?.currentPrice ?? 0}</dd>
      <dd data-testid="btc-amount">{livePortfolio.holdings['BTC']?.amount ?? 0}</dd>
    </dl>
  );
}

/** Every real panel that must move together, driven by the real provider. */
function Workstation(): React.ReactElement {
  const { schema } = useTerminal();
  return (
    <>
      <ExecutionTerminal />
      <HoldingsTable />
      <PortfolioSummaryPanel />
      <SystemLogFeed logs={schema.logs} />
      <TransactionLedger />
    </>
  );
}

function Harness(): React.ReactElement {
  return (
    <TerminalProvider>
      <Probe />
      <Workstation />
    </TerminalProvider>
  );
}

const cash = (): number => Number(screen.getByTestId('cash').textContent);
const btcAmount = (): number => Number(screen.getByTestId('btc-amount').textContent);
const transactions = (): number => Number(screen.getByTestId('transactions').textContent);

/** The seeded account, restated here so a seed change fails loudly. */
const SEED_CASH = 100_000;
const SEED_BTC = 1.25;

/** The ticket form, so the ledger's identically named filter buttons stay out. */
function ticket(): HTMLElement {
  return screen.getByRole('form', { name: /order ticket/i });
}

async function fillAmount(user: ReturnType<typeof userEvent.setup>, value: string): Promise<void> {
  const field = within(ticket()).getByLabelText(/^amount$/i) as HTMLInputElement;
  await user.clear(field);
  await user.type(field, value);
}

function selectSide(user: ReturnType<typeof userEvent.setup>, side: 'BUY' | 'SELL'): Promise<void> {
  return user.click(within(ticket()).getByRole('button', { name: new RegExp(`^${side}$`, 'i') }));
}

function selectType(user: ReturnType<typeof userEvent.setup>, type: 'MARKET' | 'LIMIT'): Promise<void> {
  return user.click(within(ticket()).getByRole('button', { name: new RegExp(`^${type}$`, 'i') }));
}

describe('end-to-end trade execution', () => {
  it('moves cash, holdings, risk metrics, log and ledger together on one fill', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const cashBefore = cash();
    const mark = Number(screen.getByTestId('mark').textContent);
    const equityAtRest = Number(screen.getByTestId('equity').textContent);
    expect(cashBefore).toBe(SEED_CASH);
    expect(btcAmount()).toBe(SEED_BTC);
    expect(mark).toBeGreaterThan(0);

    // The ledger starts empty, and says so.
    expect(screen.getByText(/Ledger empty/i)).toBeTruthy();

    await fillAmount(user, '0.5');

    // The ticket previews the cash consequence before anything is committed.
    const fillPrice = applySlippage(mark, 'BUY');
    const fee = fillPrice * 0.5 * TAKER_FEE_RATE;
    expect(within(ticket()).queryByText(/Insufficient cash/i)).toBeNull();
    expect(within(ticket()).getByRole('button', { name: /BUY .* BTC @ MARKET/i })).toBeEnabled();

    await user.click(within(ticket()).getByRole('button', { name: /BUY .* BTC @ MARKET/i }));

    // 1. Cash debited by notional plus commission, to the cent.
    await waitFor(() => {
      expect(cash()).toBeCloseTo(cashBefore - (fillPrice * 0.5 + fee), 6);
    });

    // 2. The holding is larger and the position table shows it, inside the
    //    table's own row structure.
    expect(btcAmount()).toBeCloseTo(SEED_BTC + 0.5, 8);
    const positions = screen.getByRole('table', { name: 'Open positions' });
    // The action button loads the symbol into the ticket; it does not sell. Its
    // label says so explicitly, because "EXIT" here would be a promise the app
    // breaks — and the row's first column is plain text, not a second button
    // with the same accessible name.
    expect(within(positions).getByRole('button', { name: /Load BTC into the order ticket/i })).toBeTruthy();
    expect(within(positions).queryByRole('button', { name: /^EXIT$/ })).toBeNull();
    expect(within(positions).getByText(formatQuantity(SEED_BTC + 0.5))).toBeTruthy();
    // Header and both seeded rows are all rows of that one table.
    expect(within(positions).getAllByRole('row')).toHaveLength(3);
    expect(within(positions).getAllByRole('columnheader')).toHaveLength(8);

    // 3. Risk metrics are recomputed. Cash spent at mark + slippage converts
    //    into position value marked at the mark, so equity falls by exactly the
    //    slippage paid plus the commission — never by the whole notional.
    const equityAfter = Number(screen.getByTestId('equity').textContent);
    const unrealized = Number(screen.getByTestId('unrealized').textContent);
    expect(Number.isFinite(unrealized)).toBe(true);
    expect(equityAfter).toBeCloseTo(equityAtRest - 0.5 * (fillPrice - mark) - fee, 6);
    // Equity is cash plus the marked book, so it still exceeds the cash line.
    expect(equityAfter).toBeGreaterThan(cash());

    // 4. The execution is in the system log at EXEC level.
    const log = screen.getByRole('log');
    expect(within(log).getAllByText('EXEC').length).toBeGreaterThan(0);
    expect(log.textContent).toMatch(/EXECUTED BUY 0\.50 BTC @ \$[\d,]+\.\d{2}/i);

    // 5. Exactly one order and one settled transaction were recorded.
    expect(screen.getByTestId('orders').textContent).toBe('1');
    expect(transactions()).toBe(1);
    expect(screen.getByText(/of 1 executions/i)).toBeTruthy();
  });

  it('round-trips a fill and returns cash minus exactly two commissions', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const cashAtStart = cash();
    const mark = Number(screen.getByTestId('mark').textContent);

    await fillAmount(user, '0.25');
    await user.click(within(ticket()).getByRole('button', { name: /BUY .* BTC @ MARKET/i }));
    await waitFor(() => {
      expect(cash()).toBeLessThan(cashAtStart);
    });

    await selectSide(user, 'SELL');
    // A successful fill clears the ticket, so re-enter the size for the exit.
    await fillAmount(user, '0.25');
    await user.click(within(ticket()).getByRole('button', { name: /SELL .* BTC @ MARKET/i }));

    const buyPrice = applySlippage(mark, 'BUY');
    const sellPrice = applySlippage(mark, 'SELL');
    const fees = 0.25 * (buyPrice + sellPrice) * TAKER_FEE_RATE;
    const expected = cashAtStart + 0.25 * (sellPrice - buyPrice) - fees;

    await waitFor(() => {
      expect(cash()).toBeCloseTo(expected, 6);
    });

    // Net of two commissions the account is never richer than it started.
    expect(cash()).toBeLessThanOrEqual(cashAtStart);
    expect(btcAmount()).toBeCloseTo(SEED_BTC, 8);
    expect(transactions()).toBe(2);
  });

  it('rejects an oversized order and leaves the account untouched', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const cashBefore = cash();

    await fillAmount(user, '99999');
    await user.click(within(ticket()).getByRole('button', { name: /BUY .* BTC @ MARKET/i }));

    const alert = await within(ticket()).findByRole('alert');
    expect(alert.textContent).toMatch(/Insufficient cash/i);

    // Nothing was written: no order, no transaction, no cash movement.
    expect(cash()).toBe(cashBefore);
    expect(screen.getByTestId('orders').textContent).toBe('0');
    expect(transactions()).toBe(0);
  });

  it('refuses to oversell a position', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await selectSide(user, 'SELL');
    await fillAmount(user, '1000');
    await user.click(within(ticket()).getByRole('button', { name: /SELL .* BTC @ MARKET/i }));

    const alert = await within(ticket()).findByRole('alert');
    expect(alert.textContent).toMatch(/smaller than the requested size|Position is/i);
    expect(transactions()).toBe(0);
    expect(btcAmount()).toBe(SEED_BTC);
  });

  it('rests a limit order until the market reaches it, then cancels it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const mark = Number(screen.getByTestId('mark').textContent);
    const cashBefore = cash();
    const restingPrice = Number((mark * 0.5).toFixed(2));

    await selectType(user, 'LIMIT');
    const priceField = within(ticket()).getByLabelText(/^limit price$/i) as HTMLInputElement;
    await user.clear(priceField);
    await user.type(priceField, String(restingPrice));
    await fillAmount(user, '0.1');
    await user.click(within(ticket()).getByRole('button', { name: /BUY .* BTC @/i }));

    // 1. It is working, not filled: one order, zero executions, no cash moved.
    await waitFor(() => {
      expect(screen.getByTestId('orders').textContent).toBe('1');
    });
    expect(within(ticket()).getByText('PENDING')).toBeTruthy();
    expect(transactions()).toBe(0);
    expect(cash()).toBe(cashBefore);

    // 2. The order is cancellable, and cancelling leaves the account as it was.
    await user.click(
      within(ticket()).getByRole('button', { name: new RegExp(`Cancel BUY order for 0\\.1 BTC`, 'i') })
    );

    await waitFor(() => {
      expect(within(ticket()).getByText(/No resting orders/i)).toBeTruthy();
    });
    expect(cash()).toBe(cashBefore);
    expect(transactions()).toBe(0);

    // 3. The cancellation is in the system log.
    expect(screen.getByRole('log').textContent).toMatch(/CANCELLED/i);
  });

  it('rests a limit order, previews the maker rate, and fills at the limit price', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const mark = Number(screen.getByTestId('mark').textContent);
    const cashBefore = cash();

    // 5% above the mark: the simulated tape moves at most ±0.4% per tick, so
    // the very next quote trades through the bid and it fills for real.
    const limitPrice = Number((mark * 1.05).toFixed(2));
    const amount = 0.1;

    await selectType(user, 'LIMIT');

    // 1. The ticket prices the order at the limit, with the cheaper commission.
    const priceField = within(ticket()).getByLabelText(/^limit price$/i) as HTMLInputElement;
    await user.clear(priceField);
    await user.type(priceField, String(limitPrice));
    await fillAmount(user, String(amount));

    // The fee line switches to the maker rate, and "cash after fill" previews
    // the exact debit: limit-price notional plus the cheaper commission.
    expect(within(ticket()).getByText('Fee (0.05%)')).toBeTruthy();
    expect(
      within(ticket()).getByText(formatCurrency(cashBefore - (limitPrice * amount + limitPrice * amount * MAKER_FEE_RATE)))
    ).toBeTruthy();
    expect(cash()).toBe(cashBefore);

    // 2. Submitting rests it: one working order, zero executions, no cash moved.
    await user.click(within(ticket()).getByRole('button', { name: /BUY .* BTC @/i }));
    await waitFor(() => {
      expect(screen.getByTestId('orders').textContent).toBe('1');
    });
    expect(transactions()).toBe(0);
    expect(cash()).toBe(cashBefore);

    // 3. The next quote crosses the bid, and it settles at the limit price with
    //    the maker commission — never at the mark, and never with slippage.
    await waitFor(() => {
      expect(transactions()).toBe(1);
    }, { timeout: 3000 });

    expect(cash()).toBeCloseTo(cashBefore - (limitPrice * amount + limitPrice * amount * MAKER_FEE_RATE), 6);
    expect(btcAmount()).toBeCloseTo(SEED_BTC + amount, 8);
    expect(screen.getByRole('log').textContent).toMatch(/LIMIT ORDER FILLED: BUY 0\.10 BTC/i);
  });

  it('serialises rapid submissions so one tap produces one fill', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await fillAmount(user, '0.1');

    // Three clicks inside one task: the re-entrancy guard is a ref, because a
    // state flag would not have re-rendered yet.
    const submit = within(ticket()).getByRole('button', { name: /BUY .* BTC @ MARKET/i });
    await act(async () => {
      submit.click();
      submit.click();
      submit.click();
    });

    await waitFor(() => {
      expect(transactions()).toBe(1);
    });
    expect(screen.getByTestId('orders').textContent).toBe('1');
  });
});
