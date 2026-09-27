// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  aggregateRiskMetrics,
  calculateDailyVolatility,
  calculateMaxDrawdown,
  calculateReturnSeries,
  calculateSharpeRatio,
  calculateStandardDeviation,
  computeAllocation,
  deriveLiveValuation,
  orderTransactionsByTime,
  reconstructLedger,
} from '../finance';
import {
  CryptoAsset,
  PositionHolding,
  StorageSchema,
  TransactionRecord,
} from '../../types/terminal';

const BTC: CryptoAsset = {
  id: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  currentPrice: 150,
  change24h: 0,
  high24h: 160,
  low24h: 140,
  volume24h: 1_000_000,
  sparkline: [150],
  marketCap: 1_000_000_000,
  lastUpdated: '2026-01-01T00:00:00.000Z',
};

function makeHolding(overrides: Partial<PositionHolding> = {}): PositionHolding {
  return {
    symbol: 'BTC',
    name: 'Bitcoin',
    amount: 2,
    averageEntryPrice: 100,
    totalCost: 200,
    currentValue: 300,
    unrealizedPnL: 100,
    unrealizedPnLPercent: 50,
    allocationPercent: 0,
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSchema(overrides: Partial<StorageSchema> = {}): StorageSchema {
  return {
    version: 1,
    cashBalance: 1000,
    initialDeposit: 1000,
    holdings: {},
    orders: [],
    transactions: [],
    watchlist: ['BTC'],
    logs: [],
    lastCheckpoint: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let transactionCounter = 0;

function makeTransaction(
  side: 'BUY' | 'SELL',
  executionPrice: number,
  amount: number,
  fee: number = 0,
  timestamp: string = '2026-01-01T00:00:00.000Z'
): TransactionRecord {
  transactionCounter += 1;
  return {
    id: `TX-${transactionCounter}`,
    orderId: `ORD-${transactionCounter}`,
    symbol: 'BTC',
    side,
    executionPrice,
    amount,
    totalValue: executionPrice * amount,
    fee,
    timestamp,
  };
}

describe('risk statistics', () => {
  it('returns a zero Sharpe ratio for an unusable sample', () => {
    expect(calculateSharpeRatio([])).toBe(0);
    expect(calculateSharpeRatio([0.01])).toBe(0);
    expect(calculateSharpeRatio([0.01, 0.01, 0.01])).toBe(0);
  });

  it('does not inflate the Sharpe ratio out of float residue', () => {
    // Every tick identical: variance is ~1e-18, not a real risk signal. Dividing
    // by it would print a 1e15 Sharpe for a perfectly flat account.
    expect(calculateSharpeRatio([0.0004, 0.0004, 0.0004, 0.0004, 0.0004])).toBe(0);
    expect(calculateDailyVolatility([0.0004, 0.0004, 0.0004, 0.0004, 0.0004])).toBe(0);
  });

  it('rewards a positive mean over a volatile sample', () => {
    const returns = [0.02, -0.01, 0.03, 0.005, 0.015];
    expect(calculateSharpeRatio(returns)).toBeGreaterThan(0);
  });

  it('drops non-finite observations instead of reporting NaN', () => {
    const clean = [0.02, -0.01, 0.03, 0.005, 0.015];
    const expected = calculateSharpeRatio(clean);

    // One bad sample must not poison the moments of the whole series — a NaN
    // Sharpe on the risk panel reads as "the maths is broken", not "one point
    // was missing".
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(calculateSharpeRatio([...clean, poison])).toBe(expected);
      expect(calculateSharpeRatio([poison, ...clean])).toBe(expected);
    }
  });

  it('reports a zero Sharpe ratio when nothing usable is left', () => {
    expect(calculateSharpeRatio([Number.NaN, Number.NaN])).toBe(0);
    expect(calculateSharpeRatio([Number.NaN, 0.01, Number.POSITIVE_INFINITY])).toBe(0);
  });

  it('guards the standard deviation against an empty or flat series', () => {
    expect(calculateStandardDeviation([])).toBe(0);
    expect(calculateStandardDeviation([0.05])).toBe(0);
    expect(calculateStandardDeviation([0.05, 0.05, 0.05])).toBe(0);
  });

  it('reports daily volatility as a percentage', () => {
    expect(calculateDailyVolatility([])).toBe(0);
    expect(calculateDailyVolatility([0.01, 0.01, 0.01])).toBe(0);
    expect(calculateDailyVolatility([-0.02, 0.02])).toBeGreaterThan(0);
  });

  it('measures the deepest peak-to-trough decline', () => {
    expect(calculateMaxDrawdown([])).toBe(0);
    expect(calculateMaxDrawdown([100, 110, 120])).toBe(0);
    expect(calculateMaxDrawdown([100, 50, 80])).toBe(50);
    expect(calculateMaxDrawdown([100, 0])).toBe(100);
    // Drawdown is measured from the running peak, not from the first value.
    expect(calculateMaxDrawdown([100, 110, 105])).toBeCloseTo(4.55, 2);
  });

  it('skips intervals whose opening equity is not positive', () => {
    expect(calculateReturnSeries([100, 110])).toEqual([0.1]);
    expect(calculateReturnSeries([0, 10, 20])).toEqual([1]);
    expect(calculateReturnSeries([100])).toEqual([]);
    expect(calculateReturnSeries([])).toEqual([]);
  });

  it('returns no allocation when equity is not positive', () => {
    expect(computeAllocation({ BTC: makeHolding() }, 0)).toEqual({});
    expect(computeAllocation({ BTC: makeHolding({ currentValue: 250 }) }, 1000)).toEqual({ BTC: 25 });
  });
});

describe('ledger reconstruction', () => {
  it('orders transactions in both directions', () => {
    const older = makeTransaction('BUY', 100, 1, 0, '2026-01-01T00:00:00.000Z');
    const newer = makeTransaction('SELL', 120, 1, 0, '2026-01-02T00:00:00.000Z');

    expect(orderTransactionsByTime([newer, older])).toEqual([newer, older]);
    expect(orderTransactionsByTime([newer, older], 'oldest')).toEqual([older, newer]);
  });

  it('reports a clean slate for an account with no trades', () => {
    const ledger = reconstructLedger([], 1000);

    expect(ledger.equityCurve).toEqual([1000]);
    expect(ledger.tradeCount).toBe(0);
    expect(ledger.realizedPnL).toBe(0);
    expect(ledger.winRatePercent).toBe(0);
    expect(ledger.profitFactor).toBe(0);
    expect(ledger.largestWin).toBe(0);
    expect(ledger.largestLoss).toBe(0);
    expect(ledger.returns).toEqual([]);
  });

  it('realises profit against the average cost basis', () => {
    const transactions = [
      makeTransaction('BUY', 100, 2, 0.2, '2026-01-01T00:00:00.000Z'),
      makeTransaction('BUY', 120, 1, 0.12, '2026-01-02T00:00:00.000Z'),
      makeTransaction('SELL', 150, 3, 0.45, '2026-01-03T00:00:00.000Z'),
    ];
    const ledger = reconstructLedger(transactions, 1000);

    // Average entry across 3 units bought for 320; sold 3 units for 450.
    expect(ledger.realizedPnL).toBeCloseTo(450 - 320, 10);
    expect(ledger.tradeCount).toBe(1);
    expect(ledger.winCount).toBe(1);
    expect(ledger.lossCount).toBe(0);
    expect(ledger.winRatePercent).toBe(100);
    expect(ledger.largestWin).toBeCloseTo(130, 10);
    expect(ledger.largestLoss).toBe(0);
    expect(ledger.profitFactor).toBe(Number.POSITIVE_INFINITY);
    expect(ledger.totalFees).toBeCloseTo(0.77, 10);
    expect(ledger.equityCurve[0]).toBe(1000);
    expect(ledger.equityCurve[ledger.equityCurve.length - 1]).toBeCloseTo(1000 + 130 - 0.77, 10);
    expect(ledger.openPositions).toEqual({});
  });

  it('books a losing exit as a loss and a finite profit factor', () => {
    const transactions = [
      makeTransaction('BUY', 200, 1, 0, '2026-01-01T00:00:00.000Z'),
      makeTransaction('SELL', 150, 1, 0, '2026-01-02T00:00:00.000Z'),
    ];
    const ledger = reconstructLedger(transactions, 1000);

    expect(ledger.realizedPnL).toBeCloseTo(-50, 10);
    expect(ledger.lossCount).toBe(1);
    expect(ledger.winRatePercent).toBe(0);
    expect(ledger.grossLoss).toBeCloseTo(50, 10);
    expect(ledger.largestLoss).toBeCloseTo(-50, 10);
    expect(ledger.profitFactor).toBe(0);
  });

  it('averages gross wins and gross losses into a profit factor', () => {
    const transactions = [
      makeTransaction('BUY', 100, 1, 0, '2026-01-01T00:00:00.000Z'),
      makeTransaction('SELL', 150, 1, 0, '2026-01-02T00:00:00.000Z'),
      makeTransaction('BUY', 100, 1, 0, '2026-01-03T00:00:00.000Z'),
      makeTransaction('SELL', 90, 1, 0, '2026-01-04T00:00:00.000Z'),
    ];
    const ledger = reconstructLedger(transactions, 1000);

    expect(ledger.grossProfit).toBeCloseTo(50, 10);
    expect(ledger.grossLoss).toBeCloseTo(10, 10);
    expect(ledger.profitFactor).toBeCloseTo(5, 10);
    expect(ledger.winRatePercent).toBe(50);
  });

  it('leaves an open position with its running average entry', () => {
    const transactions = [
      makeTransaction('BUY', 100, 1, 0, '2026-01-01T00:00:00.000Z'),
      makeTransaction('BUY', 200, 1, 0, '2026-01-02T00:00:00.000Z'),
    ];
    const ledger = reconstructLedger(transactions, 1000);

    expect(ledger.openPositions.BTC).toEqual({
      symbol: 'BTC',
      amount: 2,
      averageEntryPrice: 150,
      totalCost: 300,
    });
  });

  it('books sale proceeds without phantom P&L when no cost basis exists', () => {
    const transactions = [makeTransaction('SELL', 100, 1, 0.1, '2026-01-01T00:00:00.000Z')];
    const ledger = reconstructLedger(transactions, 1000);

    expect(ledger.realizedPnL).toBe(0);
    expect(ledger.tradeCount).toBe(0);
    expect(ledger.equityCurve[ledger.equityCurve.length - 1]).toBeCloseTo(1099.9, 10);
  });

  it('ignores malformed ledger rows instead of corrupting the curve', () => {
    const transactions = [
      makeTransaction('BUY', 100, 1, 0, '2026-01-01T00:00:00.000Z'),
      { ...makeTransaction('BUY', 100, 0, 0, '2026-01-02T00:00:00.000Z') },
    ];
    const ledger = reconstructLedger(transactions, 1000);

    expect(ledger.equityCurve).toHaveLength(2);
  });
});

describe('aggregateRiskMetrics', () => {
  it('returns a fully defined zeroed payload for a fresh account', () => {
    const schema = makeSchema();
    const valuation = deriveLiveValuation(schema, {});
    const metrics = aggregateRiskMetrics(schema, valuation);

    expect(metrics).toEqual({
      totalEquity: 1000,
      cashBalance: 1000,
      unrealizedPnL: 0,
      realizedPnL: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      winRatePercent: 0,
      profitFactor: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      volatilityDaily: 0,
      largestWin: 0,
      largestLoss: 0,
      totalTradesCount: 0,
    });
    expect(Object.values(metrics).every((value) => Number.isFinite(value))).toBe(true);
  });

  it('combines realised and unrealised performance', () => {
    const schema = makeSchema({
      cashBalance: 300,
      transactions: [
        makeTransaction('BUY', 100, 1, 0, '2026-01-01T00:00:00.000Z'),
        makeTransaction('SELL', 120, 1, 0, '2026-01-02T00:00:00.000Z'),
      ],
      holdings: { BTC: makeHolding({ currentValue: 300, unrealizedPnL: 100 }) },
    });
    const valuation = deriveLiveValuation(schema, { BTC: BTC });
    const metrics = aggregateRiskMetrics(schema, valuation);

    expect(metrics.realizedPnL).toBeCloseTo(20, 10);
    expect(metrics.unrealizedPnL).toBeCloseTo(100, 10);
    expect(metrics.totalPnL).toBeCloseTo(120, 10);
    expect(metrics.totalPnLPercent).toBeCloseTo(12, 10);
    expect(metrics.totalEquity).toBeCloseTo(300 + 300, 10);
    expect(metrics.totalTradesCount).toBe(1);
    expect(metrics.winRatePercent).toBe(100);
  });

  it('never divides by a zero deposit', () => {
    const schema = makeSchema({ initialDeposit: 0, cashBalance: 0 });
    const metrics = aggregateRiskMetrics(schema, deriveLiveValuation(schema, {}));
    expect(metrics.totalPnLPercent).toBe(0);
  });
});

describe('deriveLiveValuation', () => {
  it('re-prices holdings against the live feed', () => {
    const schema = makeSchema({ holdings: { BTC: makeHolding() } });
    const valuation = deriveLiveValuation(schema, { BTC: BTC });

    expect(valuation.holdings.BTC?.liveMarketPrice).toBe(150);
    expect(valuation.holdings.BTC?.currentValue).toBe(300);
    expect(valuation.holdings.BTC?.unrealizedPnL).toBe(100);
    expect(valuation.totalMarketValue).toBe(300);
    expect(valuation.totalEquity).toBe(1300);
    expect(valuation.holdings.BTC?.allocationPercent).toBeCloseTo(23.08, 2);
  });

  it('falls back to the committed entry price for an unquoted symbol', () => {
    const schema = makeSchema({ holdings: { BTC: makeHolding() } });
    const valuation = deriveLiveValuation(schema, {});

    expect(valuation.holdings.BTC?.liveMarketPrice).toBe(100);
    expect(valuation.unrealizedPnL).toBe(0);
    expect(valuation.unrealizedPnLPercent).toBe(0);
  });

  it('keeps allocation weights at zero when equity is wiped out', () => {
    const schema = makeSchema({
      cashBalance: 0,
      holdings: { BTC: makeHolding({ amount: 0, totalCost: 0, currentValue: 0, unrealizedPnL: 0 }) },
    });
    const valuation = deriveLiveValuation(schema, { BTC: BTC });

    expect(valuation.totalEquity).toBe(0);
    expect(valuation.holdings.BTC?.allocationPercent).toBe(0);
  });
});
