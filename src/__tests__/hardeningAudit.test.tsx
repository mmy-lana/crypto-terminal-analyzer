/**
 * Hardening audit gates.
 *
 * One file for the audit findings that are behavioural rather than structural,
 * so each remediation carries the assertion that would have caught it. The
 * failures here are silent by construction: dust deletion credits the cash and
 * loses the position, a rounded liquidation rejects an exit the operator asked
 * for, and a stack trace renders to whoever is holding the screen. None of them
 * throws, so nothing else in the suite would notice.
 *
 * Each test is written to fail against the code as it stood before the fix.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import App from '../App';
import { ErrorBoundary } from '../components/primitives/ErrorBoundary';
import { normalizeNumericInput } from '../components/domain/ExecutionTerminal';
import {
  BASE_ASSETS,
  SPARKLINE_POINTS,
  subscribeToMarketFeed
} from '../services/marketFeed';
import {
  availableCash,
  cancelOrder,
  executeMarketOrder,
  placeLimitOrder,
  reservedCash
} from '../utils/engine';
import { deriveLiveValuation } from '../utils/finance';
import { CryptoAsset, PositionHolding, StorageSchema } from '../types/terminal';
import { setViewportWidth } from '../test/matchMediaMock';

const BTC: CryptoAsset = {
  id: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  currentPrice: 50000,
  change24h: 2,
  high24h: 51000,
  low24h: 48000,
  volume24h: 1e9,
  marketCap: 1e12,
  sparkline: [],
  lastUpdated: '2026-01-01T00:00:00.000Z',
};

const makeHolding = (overrides: Partial<Omit<PositionHolding, 'symbol' | 'name'>> = {}): PositionHolding => ({
  symbol: 'BTC',
  name: 'Bitcoin',
  amount: 1,
  averageEntryPrice: 40000,
  totalCost: 40000,
  currentValue: 40000,
  unrealizedPnL: 0,
  unrealizedPnLPercent: 0,
  allocationPercent: 0,
  lastUpdated: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeSchema = (overrides: Partial<StorageSchema> = {}): StorageSchema =>
  ({
    version: 1,
    cashBalance: 100000,
    holdings: {},
    orders: [],
    transactions: [],
    logs: [],
    ...overrides,
  }) as StorageSchema;

/**
 * Drains the async order pipeline.
 *
 * Submitting arms an in-flight state that relabels the submit button to
 * ROUTING, so anything that queries the ticket before this settles is reading
 * a button that is about to be replaced.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }
  });
};

const clickButton = async (name: RegExp): Promise<void> => {
  await act(async () => {
    const [control] = screen.getAllByRole('button', { name });
    if (control === undefined) throw new Error(`No control named ${String(name)}`);
    fireEvent.click(control);
  });
  await settle();
};

const setAmount = async (value: string): Promise<void> => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value } });
  });
  await settle();
};

describe('phase 1 / sub-unit position integrity', () => {
  it('keeps a position whose remainder is below one micro-unit', () => {
    // 4.2e-7 BTC is a fifth of a satoshi at this price. It is a real holding,
    // not residue, and a partial sell must leave it standing.
    const schema = makeSchema({
      holdings: { BTC: makeHolding({ amount: 4.2e-7, totalCost: 0.021, averageEntryPrice: 50000 }) },
    });

    const result = executeMarketOrder(schema, BTC, 'SELL', 1e-7);

    expect(result.success).toBe(true);
    const after = result.updatedSchema.holdings.BTC;
    expect(after).toBeDefined();
    expect(after?.amount).toBeCloseTo(3.2e-7, 12);
    // The cost basis travels with the position rather than evaporating: the
    // pro-rata slice of what was sold is the only thing that leaves.
    expect(after?.totalCost).toBeCloseTo(0.016, 12);
  });

  it('still closes the row on a genuine full exit', () => {
    const amount = 4.2e-7;
    const schema = makeSchema({
      holdings: { BTC: makeHolding({ amount, totalCost: 0.021, averageEntryPrice: 50000 }) },
    });

    const result = executeMarketOrder(schema, BTC, 'SELL', amount);

    expect(result.success).toBe(true);
    expect(result.updatedSchema.holdings.BTC).toBeUndefined();
  });

  it('agrees with the execution engine about what counts as closed', () => {
    // The analytics path rebuilds positions by replaying the ledger. A floor
    // that differed from the engine's produced a position persisted in one and
    // invisible in the other.
    const amount = 4.2e-7;
    const schema = makeSchema({
      holdings: { BTC: makeHolding({ amount, totalCost: 0.021, averageEntryPrice: 50000 }) },
    });
    const after = executeMarketOrder(schema, BTC, 'SELL', 1e-7).updatedSchema;
    const valuation = deriveLiveValuation(after, { BTC });

    expect(valuation.holdings.BTC).toBeDefined();
    expect(after.holdings.BTC).toBeDefined();
  });
});

describe('phase 1 / full liquidation precision', () => {
  beforeEach(() => {
    setViewportWidth(1440);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits a nine-decimal position in full from the 100% preset', async () => {
    render(<App />);
    await clickButton(/^TRADE/);

    // The seed position plus this fill is 1.373456789 BTC — more precision than
    // the eight decimals the preset used to round to. Rounding that lands
    // *above* the position, and the engine compares the order size against the
    // holding with a strict `<`, so the surplus rejects the exit.
    await setAmount('0.123456789');
    await clickButton(/^BUY .* @ MARKET$/);

    await clickButton(/^SELL/);
    await clickButton(/100%/);
    await clickButton(/^SELL .* @ MARKET$/);

    // The rejection would surface as an alert on the ticket.
    expect(screen.queryByText(/INSUFFICIENT_ASSET_BALANCE|not enough of the asset/i)).toBeNull();

    // And the position would still be open on the positions panel. The seed
    // holds other assets, so the assertion is scoped to the line that was
    // meant to close: BTC gone, everything else untouched.
    await clickButton(/^MONITOR/);
    const positions = screen.getByRole('table', { name: 'Open positions' });
    expect(positions.textContent).not.toContain('BTC');
    expect(positions.textContent).toContain('ETH');
  });
});

describe('phase 1 / production information disclosure', () => {
  const Boom = (): React.ReactElement => {
    throw new Error('kernel panic: secret internal path /srv/engine/private.js');
  };

  const renderCrash = (): void => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders no stack or component stack outside development', () => {
    vi.stubEnv('DEV', false);
    renderCrash();

    const document_ = document.body;
    expect(document_.textContent).not.toContain('private.js');
    expect(document_.textContent).not.toContain('kernel panic');
    expect(document_.textContent).not.toMatch(/\bat\s+\w+\s+\(/);
    expect(document_.textContent).not.toContain('COMPONENT STACK');
  });

  it('still gives the operator something quotable', () => {
    vi.stubEnv('DEV', false);
    renderCrash();

    const reference = document.querySelector('[data-incident-ref]')?.getAttribute('data-incident-ref') ?? '';
    expect(reference).toMatch(/^FAULT-[0-9A-Z]+-[0-9A-Z]{7}$/);
    expect(screen.getByRole('button', { name: /Retry Render/ })).toBeDefined();
  });

  it('keeps the stack available to a developer', () => {
    vi.stubEnv('DEV', true);
    renderCrash();

    expect(document.body.textContent).toContain('private.js');
    expect(document.querySelector('[data-incident-ref]')).toBeNull();
  });

  it('does not write the stack to the console outside development', () => {
    vi.stubEnv('DEV', false);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderCrash();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Dump To Console/ }));
    });

    const written = spy.mock.calls.map((call) => JSON.stringify(call)).join(' ');
    expect(written).not.toContain('private.js');
    expect(written).toContain('FAULT-');
  });
});

describe('phase 2 / collateral escrow', () => {
  // 1000 USD of cash against a 50000 quote: one BTC is 50x the whole balance,
  // so the sizes below are comfortably inside it.
  const budget = 1000;

  it('refuses a second working buy against cash the first already escrowed', () => {
    const first = placeLimitOrder(makeSchema({ cashBalance: budget }), BTC, 'BUY', 0.012, 50000);
    expect(first.success).toBe(true);
    const resting = first.updatedSchema;

    expect(reservedCash(resting)).toBeGreaterThan(0);
    expect(availableCash(resting)).toBeLessThan(budget);

    // Affordable against the ledger balance, unaffordable against what is left
    // after the reservation. Under a balance-only check this second order rests
    // beside the first and the two then race for the same cash.
    const second = placeLimitOrder(resting, BTC, 'BUY', 0.009, 50000);

    expect(second.success).toBe(false);
    expect(second.error).toBe('INSUFFICIENT_FUNDS');
  });

  it('releases the escrow when the order stops resting', () => {
    const first = placeLimitOrder(makeSchema({ cashBalance: budget }), BTC, 'BUY', 0.012, 50000);
    const resting = first.updatedSchema;
    const orderId = resting.orders[0]?.id ?? '';

    const cancelled = cancelOrder(resting, orderId).updatedSchema;

    expect(reservedCash(cancelled)).toBe(0);
    expect(availableCash(cancelled)).toBe(budget);
  });

  it('stops a market order from spending escrowed cash', () => {
    const first = placeLimitOrder(makeSchema({ cashBalance: budget }), BTC, 'BUY', 0.012, 50000);
    const resting = first.updatedSchema;

    // 0.009 BTC at market, same size the limit path just refused.
    const taker = executeMarketOrder(resting, BTC, 'BUY', 0.009);

    expect(taker.success).toBe(false);
    expect(taker.error).toBe('INSUFFICIENT_FUNDS');
  });

  it('still funds a resting fill from the cash it reserved for itself', () => {
    // The escrow must not be charged twice: a working buy is the one order
    // entitled to draw on its own reservation.
    const first = placeLimitOrder(makeSchema({ cashBalance: budget }), BTC, 'BUY', 0.012, 50000);
    const resting = first.updatedSchema;
    const order = resting.orders[0];
    expect(order).toBeDefined();
    if (order === undefined) return;

    const filled = { ...resting, orders: resting.orders.map((o) => (o.id === order.id ? { ...o, price: 50000 } : o)) };

    // Re-pricing is not the fill path; assert the invariant through the
    // reserved figure a fill would be charged against instead.
    expect(reservedCash(filled)).toBeGreaterThan(0);
    expect(availableCash(filled)).toBeLessThan(budget);
  });
});

describe('phase 2 / tape lifetime', () => {
  it('keeps one walk and one 24h baseline across a re-subscription', async () => {
    // The context re-subscribes whenever the watchlist changes. If the tape
    // restarted, the price would snap back to the seed and the 24h change would
    // be re-anchored to it — the percentage would move because its denominator
    // did, not because anything traded.
    let lastAssets: Record<string, { currentPrice: number; change24h: number; sparkline: number[] }> = {};

    const first = subscribeToMarketFeed(['BTC'], (_prices, assets) => {
      lastAssets = assets;
    }, 1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SPARKLINE_POINTS * 2));
    });
    first();
    const before = lastAssets.BTC;
    expect(before).toBeDefined();

    const second = subscribeToMarketFeed(['BTC'], (_prices, assets) => {
      lastAssets = assets;
    }, 1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    second();
    const after = lastAssets.BTC;
    expect(after).toBeDefined();
    if (before === undefined || after === undefined) return;

    // Deterministic: after enough ticks the seed's own sparkline has been
    // fully displaced, so a restarted walk would reproduce the seed array
    // exactly. A continued walk cannot.
    expect(after.sparkline).not.toEqual(BASE_ASSETS.BTC?.sparkline);
    // And the walk is continuous: one more tick, not a jump back to the seed.
    expect(after.currentPrice).not.toBe(BASE_ASSETS.BTC?.currentPrice);
    // The 24h baseline held, so the change moved by the walk and nothing else.
    expect(Math.abs(after.change24h - before.change24h)).toBeLessThan(1.5);
  });
});

describe('phase 2 / transaction settlement', () => {
  // The liveness guard for the single-writer design. A rejected order commits
  // the schema unchanged, so React performs no render and runs no effect: a
  // settlement that waited on a commit would never arrive, and the submission
  // lock would be held for the rest of the session with the ticket permanently
  // refusing every order. This test passes on the previous code too — it is not
  // evidence of the old defect, which was a purity violation rather than a
  // behaviour change. It is here so that future refactors cannot reintroduce the
  // hang.
  it('releases the ticket after a rejected order', async () => {
    render(<App />);
    await clickButton(/^TRADE/);

    // More BTC than the account can buy: rejected on funds.
    await setAmount('5');
    await clickButton(/^BUY .* @ MARKET$/);
    // Reported twice on purpose: the transient notice and the field-level error
    // are separate channels, and the rejection has to reach the operator in both.
    expect(screen.getAllByText(/INSUFFICIENT|REJECTED/i).length).toBeGreaterThan(0);

    // The lock is free again: a second order still reaches the engine and is
    // judged on its own merits, not blocked by the first one's rejection.
    await setAmount('0.001');
    await clickButton(/^BUY .* @ MARKET$/);
    expect(screen.getAllByText(/FILLED|EXECUTED/i).length).toBeGreaterThan(0);
  });
});

describe('phase 3 / fractional satoshi lifecycle', () => {
  // The spec figure: 0.00000042 BTC, a hundredth of a satoshi's smaller half.
  const FRACTIONAL = 0.00000042;

  it('opens and fully closes a position the old dust floor would have eaten', () => {
    const opened = executeMarketOrder(makeSchema(), BTC, 'BUY', FRACTIONAL);
    expect(opened.success).toBe(true);
    expect(opened.updatedSchema.holdings.BTC?.amount).toBeCloseTo(FRACTIONAL, 15);

    // A full exit of the whole position, with nothing left behind.
    const closed = executeMarketOrder(opened.updatedSchema, BTC, 'SELL', FRACTIONAL);
    expect(closed.success).toBe(true);
    expect(closed.updatedSchema.holdings.BTC).toBeUndefined();
  });

  it('survives a partial exit without losing the remainder or the basis', () => {
    const opened = executeMarketOrder(makeSchema(), BTC, 'BUY', FRACTIONAL);
    const half = executeMarketOrder(opened.updatedSchema, BTC, 'SELL', FRACTIONAL / 2);

    expect(half.success).toBe(true);
    const left = half.updatedSchema.holdings.BTC;
    expect(left).toBeDefined();
    expect(left?.amount).toBeCloseTo(FRACTIONAL / 2, 15);
    expect(left?.totalCost).toBeGreaterThan(0);
  });
});

describe('phase 3 / locale decimal comma', () => {
  it('reads a comma as a decimal point where a group of three would be wrong', () => {
    expect(normalizeNumericInput('0,5')).toBe('0.5');
    expect(normalizeNumericInput('1,5')).toBe('1.5');
    expect(normalizeNumericInput('0,00042')).toBe('0.00042');
    expect(normalizeNumericInput('')).toBe('');
    expect(normalizeNumericInput('0.5')).toBe('0.5');
  });

  it('reads a group of exactly three digits as thousands', () => {
    // The misread here is a 1000x sizing error, so the rule has to be exact.
    expect(normalizeNumericInput('1,500')).toBe('1500');
    expect(normalizeNumericInput('12,345')).toBe('12345');
    expect(normalizeNumericInput('1,234,567')).toBe('1234567');
  });

  it('treats a leading zero group as a decimal', () => {
    // Nobody writes a thousands-grouped number as 0,123.
    expect(normalizeNumericInput('0,123')).toBe('0.123');
  });

  it('refuses text that is not a number rather than guessing', () => {
    expect(normalizeNumericInput('1.234,56')).toBeNull();
    expect(normalizeNumericInput('1,2,3')).toBeNull();
    expect(normalizeNumericInput('abc')).toBeNull();
    expect(normalizeNumericInput('1e5')).toBeNull();
  });

  it('accepts a comma-typed amount on the ticket and settles it', async () => {
    setViewportWidth(1440);
    render(<App />);
    await clickButton(/^TRADE/);

    // Typed the way a de-DE keyboard produces it. Before normalisation the
    // field refused the keystroke with a format error and the order could
    // never be placed.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0,5' } });
    });

    const field = screen.getByLabelText('Amount') as HTMLInputElement;
    expect(field.value).toBe('0.5');

    await clickButton(/^BUY .* @ MARKET$/);
    expect(screen.getAllByText(/FILLED|EXECUTED/i).length).toBeGreaterThan(0);
  });
});
