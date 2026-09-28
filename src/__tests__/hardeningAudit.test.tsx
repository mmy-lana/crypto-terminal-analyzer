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
import { executeMarketOrder } from '../utils/engine';
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
