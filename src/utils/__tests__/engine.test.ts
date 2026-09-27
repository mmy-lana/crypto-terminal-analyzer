import { describe, expect, it } from 'vitest';

import {
  DUST_THRESHOLD,
  MAKER_FEE_RATE,
  SLIPPAGE_FACTOR,
  TAKER_FEE_RATE,
  applyAllocations,
  applySlippage,
  calculateFee,
  cancelOrder,
  createEmptyHolding,
  estimateOrder,
  evaluateOpenOrders,
  executeMarketOrder,
  feeRateForOrderType,
  getOpenOrders,
  getOrderById,
  placeLimitOrder,
  recalculateHolding,
} from '../engine';
import { CryptoAsset, OrderRecord, PositionHolding, StorageSchema } from '../../types/terminal';

const BTC: CryptoAsset = {
  id: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  currentPrice: 100,
  change24h: 0,
  high24h: 110,
  low24h: 90,
  volume24h: 1_000_000,
  sparkline: [100],
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
    currentValue: 200,
    unrealizedPnL: 0,
    unrealizedPnLPercent: 0,
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

describe('fee and slippage model', () => {
  it('charges takers more than resting makers', () => {
    expect(feeRateForOrderType('MARKET')).toBe(TAKER_FEE_RATE);
    expect(feeRateForOrderType('LIMIT')).toBe(MAKER_FEE_RATE);
    expect(TAKER_FEE_RATE).toBeGreaterThan(MAKER_FEE_RATE);
  });

  it('charges nothing on an empty notional', () => {
    expect(calculateFee(0, 'MARKET')).toBe(0);
    expect(calculateFee(-100, 'LIMIT')).toBe(0);
    expect(calculateFee(Number.NaN, 'MARKET')).toBe(0);
  });

  it('makes buyers pay up and sellers receive less', () => {
    expect(applySlippage(100, 'BUY')).toBeCloseTo(100 * (1 + SLIPPAGE_FACTOR), 8);
    expect(applySlippage(100, 'SELL')).toBeCloseTo(100 * (1 - SLIPPAGE_FACTOR), 8);
  });

  it('never returns a negative slipped price', () => {
    expect(applySlippage(0, 'SELL')).toBe(0);
    expect(applySlippage(-50, 'BUY')).toBe(0);
  });

  it('previews cash impact per order type', () => {
    const market = estimateOrder(100, 2, 'MARKET', 'BUY');
    const limit = estimateOrder(100, 2, 'LIMIT', 'BUY');
    const sale = estimateOrder(100, 2, 'LIMIT', 'SELL');

    expect(market.executionPrice).toBeGreaterThan(limit.executionPrice);
    expect(market.fee).toBeGreaterThan(limit.fee);
    expect(market.cashDelta).toBe(-(market.totalValue + market.fee));
    expect(sale.cashDelta).toBe(sale.totalValue - sale.fee);
  });
});

describe('holding arithmetic', () => {
  it('creates a zeroed holding', () => {
    const holding = createEmptyHolding('SOL', 'Solana');
    expect(holding).toMatchObject({
      symbol: 'SOL',
      name: 'Solana',
      amount: 0,
      averageEntryPrice: 0,
      totalCost: 0,
      unrealizedPnLPercent: 0,
    });
  });

  it('recomputes average entry and mark from a new cost basis', () => {
    const holding = recalculateHolding(createEmptyHolding('BTC', 'Bitcoin'), 2, 200, 150);
    expect(holding.averageEntryPrice).toBe(100);
    expect(holding.currentValue).toBe(300);
    expect(holding.unrealizedPnL).toBe(100);
    expect(holding.unrealizedPnLPercent).toBe(50);
  });

  it('guards division by zero when a position is fully closed', () => {
    const holding = recalculateHolding(makeHolding(), 0, 0, 100);
    expect(holding.averageEntryPrice).toBe(0);
    expect(holding.unrealizedPnLPercent).toBe(0);
    expect(Number.isNaN(holding.unrealizedPnLPercent)).toBe(false);
  });

  it('leaves the schema untouched when equity is wiped out', () => {
    const schema = makeSchema({ cashBalance: 0, holdings: { BTC: makeHolding({ currentValue: 0 }) } });
    expect(applyAllocations(schema)).toBe(schema);
  });

  it('allocates portfolio weight against total equity', () => {
    const schema = makeSchema({ cashBalance: 500, holdings: { BTC: makeHolding({ currentValue: 500 }) } });
    const next = applyAllocations(schema);
    expect(next.holdings.BTC?.allocationPercent).toBe(50);
  });
});

describe('executeMarketOrder — buy side', () => {
  it('rejects a non-positive amount without touching the ledger', () => {
    const schema = makeSchema();
    expect(executeMarketOrder(schema, BTC, 'BUY', 0)).toMatchObject({
      success: false,
      error: 'INVALID_AMOUNT',
    });
    expect(executeMarketOrder(schema, BTC, 'BUY', -1).updatedSchema).toBe(schema);
    expect(executeMarketOrder(schema, BTC, 'BUY', Number.NaN).error).toBe('INVALID_AMOUNT');
  });

  it('rejects a purchase the account cannot fund', () => {
    const schema = makeSchema({ cashBalance: 10 });
    const result = executeMarketOrder(schema, BTC, 'BUY', 1);

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_FUNDS');
    expect(result.updatedSchema).toBe(schema);
    expect(result.updatedSchema.transactions).toHaveLength(0);
  });

  it('rejects a symbol or a price it cannot quote', () => {
    const schema = makeSchema();
    expect(executeMarketOrder(schema, { ...BTC, symbol: '' }, 'BUY', 1).error).toBe('INVALID_SYMBOL');
    expect(executeMarketOrder(schema, { ...BTC, currentPrice: 0 }, 'BUY', 1).error).toBe('INVALID_PRICE');
  });

  it('debits notional plus taker fee and opens the position', () => {
    const schema = makeSchema({ cashBalance: 1000 });
    const result = executeMarketOrder(schema, BTC, 'BUY', 2);

    expect(result.success).toBe(true);
    const next = result.updatedSchema;
    const expectedPrice = 100 * (1 + SLIPPAGE_FACTOR);
    const expectedValue = expectedPrice * 2;
    const expectedFee = expectedValue * TAKER_FEE_RATE;

    expect(next.cashBalance).toBeCloseTo(1000 - expectedValue - expectedFee, 10);
    expect(next.holdings.BTC?.amount).toBe(2);
    expect(next.holdings.BTC?.totalCost).toBeCloseTo(expectedValue, 10);

    const order = next.orders[0];
    expect(order).toMatchObject({ side: 'BUY', type: 'MARKET', status: 'FILLED', filledAmount: 2 });
    expect(order?.executedAt).toBeTruthy();

    const transaction = next.transactions[0];
    expect(transaction).toMatchObject({ orderId: order?.id, side: 'BUY', amount: 2 });
    expect(transaction?.fee).toBeCloseTo(expectedFee, 10);

    expect(next.logs[0]?.level).toBe('EXEC');
    expect(next.logs[0]?.source).toBe('MATCH_ENGINE');
    expect(next.logs[0]?.message).toContain('EXECUTED BUY');
  });

  it('averages the cost basis across repeated buys', () => {
    const first = executeMarketOrder(makeSchema(), BTC, 'BUY', 1);
    const second = executeMarketOrder(first.updatedSchema, BTC, 'BUY', 3);
    const holding = second.updatedSchema.holdings.BTC;

    expect(holding?.amount).toBe(4);
    expect(holding?.totalCost).toBeCloseTo((100 * (1 + SLIPPAGE_FACTOR)) * 4, 10);
    expect(holding?.averageEntryPrice).toBeCloseTo(100 * (1 + SLIPPAGE_FACTOR), 10);
  });
});

describe('executeMarketOrder — sell side', () => {
  it('rejects selling a token the account never held', () => {
    const schema = makeSchema();
    const result = executeMarketOrder(schema, BTC, 'SELL', 1);

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_ASSET_BALANCE');
    expect(result.updatedSchema).toBe(schema);
  });

  it('rejects selling more than the held quantity', () => {
    const schema = makeSchema({ holdings: { BTC: makeHolding({ amount: 1 }) } });
    const result = executeMarketOrder(schema, BTC, 'SELL', 2);

    expect(result.error).toBe('INSUFFICIENT_ASSET_BALANCE');
    expect(result.updatedSchema).toBe(schema);
  });

  it('realises profit against the average cost basis on a partial close', () => {
    const schema = makeSchema({ holdings: { BTC: makeHolding() } });
    const result = executeMarketOrder(schema, { ...BTC, currentPrice: 120 }, 'SELL', 1);

    expect(result.success).toBe(true);
    const next = result.updatedSchema;
    const executionPrice = 120 * (1 - SLIPPAGE_FACTOR);
    const realised = executionPrice - 100;

    expect(next.cashBalance).toBeCloseTo(1000 + executionPrice - executionPrice * TAKER_FEE_RATE, 10);
    expect(next.holdings.BTC?.amount).toBe(1);
    expect(next.holdings.BTC?.totalCost).toBeCloseTo(100, 10);
    expect(next.logs[0]?.message).toContain(realised.toFixed(2));

    const transaction = next.transactions[0];
    expect(transaction?.side).toBe('SELL');
  });

  it('closes the row when the position is sold out', () => {
    const schema = makeSchema({ holdings: { BTC: makeHolding({ amount: DUST_THRESHOLD / 2 }) } });
    const result = executeMarketOrder(schema, BTC, 'SELL', DUST_THRESHOLD / 2);

    expect(result.success).toBe(true);
    expect(result.updatedSchema.holdings.BTC).toBeUndefined();
  });
});

describe('placeLimitOrder', () => {
  it('validates amount, price and symbol', () => {
    const schema = makeSchema();
    expect(placeLimitOrder(schema, BTC, 'BUY', 0, 90).error).toBe('INVALID_AMOUNT');
    expect(placeLimitOrder(schema, BTC, 'BUY', 1, 0).error).toBe('INVALID_PRICE');
    expect(placeLimitOrder(schema, BTC, 'BUY', 1, -90).error).toBe('INVALID_PRICE');
    expect(placeLimitOrder(schema, { ...BTC, symbol: '' }, 'BUY', 1, 90).error).toBe('INVALID_SYMBOL');
  });

  it('refuses a buy the account cannot fund at the limit price', () => {
    const schema = makeSchema({ cashBalance: 50 });
    expect(placeLimitOrder(schema, BTC, 'BUY', 1, 90).error).toBe('INSUFFICIENT_FUNDS');
  });

  it('refuses a sell larger than the held quantity', () => {
    const schema = makeSchema({ holdings: { BTC: makeHolding({ amount: 1 }) } });
    expect(placeLimitOrder(schema, BTC, 'SELL', 2, 150).error).toBe('INSUFFICIENT_ASSET_BALANCE');
  });

  it('rests a working order without moving cash or inventory', () => {
    const schema = makeSchema();
    const result = placeLimitOrder(schema, BTC, 'BUY', 2, 90);

    expect(result.success).toBe(true);
    const next = result.updatedSchema;
    expect(next.cashBalance).toBe(1000);
    expect(next.holdings).toEqual({});

    const order = next.orders[0];
    expect(order).toMatchObject({
      symbol: 'BTC',
      side: 'BUY',
      type: 'LIMIT',
      price: 90,
      amount: 2,
      filledAmount: 0,
      status: 'PENDING',
      fee: 0,
    });
    expect(next.logs[0]?.level).toBe('INFO');
    expect(next.logs[0]?.source).toBe('ORDER_ENTRY');
    expect(getOpenOrders(next)).toHaveLength(1);
  });
});

describe('cancelOrder', () => {
  it('reports an unknown order', () => {
    const schema = makeSchema();
    expect(cancelOrder(schema, 'ORD-nope').error).toBe('ORDER_NOT_FOUND');
  });

  it('refuses to rewrite settled history', () => {
    const filled = executeMarketOrder(makeSchema(), BTC, 'BUY', 1).updatedSchema;
    const orderId = filled.orders[0]?.id ?? '';
    expect(cancelOrder(filled, orderId).error).toBe('ORDER_NOT_CANCELABLE');
  });

  it('cancels a working order and logs the event', () => {
    const resting = placeLimitOrder(makeSchema(), BTC, 'BUY', 1, 90).updatedSchema;
    const orderId = resting.orders[0]?.id ?? '';
    const result = cancelOrder(resting, orderId);

    expect(result.success).toBe(true);
    expect(getOrderById(result.updatedSchema, orderId)?.status).toBe('CANCELLED');
    expect(getOpenOrders(result.updatedSchema)).toHaveLength(0);
    expect(result.updatedSchema.logs[0]).toMatchObject({ level: 'WARN', source: 'ORDER_ENTRY' });
  });
});

describe('evaluateOpenOrders', () => {
  function withLimitBuy(price: number, amount: number, cash: number = 1000): StorageSchema {
    return placeLimitOrder(makeSchema({ cashBalance: cash }), BTC, 'BUY', amount, price).updatedSchema;
  }

  it('returns the same schema reference when nothing fills', () => {
    const schema = withLimitBuy(90, 1);
    expect(evaluateOpenOrders(schema, { BTC: 95 })).toBe(schema);
  });

  it('fills a buy limit once the market trades down to it', () => {
    const schema = withLimitBuy(90, 2);
    const next = evaluateOpenOrders(schema, { BTC: 89 });

    expect(next).not.toBe(schema);
    const expectedFee = 90 * 2 * MAKER_FEE_RATE;
    expect(next.cashBalance).toBeCloseTo(1000 - 180 - expectedFee, 10);
    expect(next.holdings.BTC?.amount).toBe(2);
    expect(next.holdings.BTC?.totalCost).toBeCloseTo(180, 10);

    const order = next.orders[0];
    expect(order?.status).toBe('FILLED');
    expect(order?.filledAmount).toBe(2);
    expect(next.transactions[0]).toMatchObject({ orderId: order?.id, executionPrice: 90, fee: expectedFee });
    expect(next.logs[0]).toMatchObject({ level: 'EXEC', source: 'LIMIT_MATCH' });
  });

  it('fills exactly at the limit price', () => {
    const schema = withLimitBuy(90, 1);
    expect(evaluateOpenOrders(schema, { BTC: 90 }).orders[0]?.status).toBe('FILLED');
  });

  it('leaves a sell limit working while the market is below it', () => {
    const resting = placeLimitOrder(
      makeSchema({ holdings: { BTC: makeHolding() } }),
      BTC,
      'SELL',
      1,
      150
    ).updatedSchema;

    expect(getOpenOrders(evaluateOpenOrders(resting, { BTC: 120 }))).toHaveLength(1);
  });

  it('fills a sell limit and books the proceeds', () => {
    const resting = placeLimitOrder(
      makeSchema({ holdings: { BTC: makeHolding() } }),
      BTC,
      'SELL',
      1,
      150
    ).updatedSchema;

    const next = evaluateOpenOrders(resting, { BTC: 150 });
    expect(next.cashBalance).toBeCloseTo(1000 + 150 - 150 * MAKER_FEE_RATE, 10);
    expect(next.holdings.BTC?.amount).toBe(1);
    expect(next.holdings.BTC?.totalCost).toBeCloseTo(100, 10);
  });

  it('ignores ticks that carry no usable price for the symbol', () => {
    const schema = withLimitBuy(90, 1);

    expect(evaluateOpenOrders(schema, {})).toBe(schema);
    expect(evaluateOpenOrders(schema, { BTC: 0 })).toBe(schema);
    expect(evaluateOpenOrders(schema, { BTC: Number.NaN })).toBe(schema);
    expect(evaluateOpenOrders(schema, { BTC: Number.POSITIVE_INFINITY })).toBe(schema);
  });

  it('keeps an order working when the account can no longer settle it', () => {
    // Cash was available when the order was placed and spent before the limit
    // price traded: the fill is skipped and the order keeps resting.
    const unaffordable: OrderRecord = {
      id: 'ORD-unfunded',
      clientOrderId: 'CLI-unfunded',
      symbol: 'BTC',
      side: 'BUY',
      type: 'LIMIT',
      price: 90,
      amount: 5,
      filledAmount: 0,
      totalValue: 450,
      status: 'PENDING',
      fee: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const schema = makeSchema({ cashBalance: 100, orders: [unaffordable] });
    const next = evaluateOpenOrders(schema, { BTC: 80 });

    expect(next).toBe(schema);
    expect(next.orders[0]?.status).toBe('PENDING');
  });

  it('settles fills sequentially so one tick cannot overspend the account', () => {
    const first: OrderRecord = {
      id: 'ORD-first',
      clientOrderId: 'CLI-first',
      symbol: 'BTC',
      side: 'BUY',
      type: 'LIMIT',
      price: 90,
      amount: 1,
      filledAmount: 0,
      totalValue: 90,
      status: 'PENDING',
      fee: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const second: OrderRecord = { ...first, id: 'ORD-second', clientOrderId: 'CLI-second' };
    const schema = makeSchema({ cashBalance: 100, orders: [first, second] });

    const next = evaluateOpenOrders(schema, { BTC: 80 });
    const statuses = next.orders.map((order) => `${order.id}:${order.status}`);

    expect(statuses).toEqual(['ORD-first:FILLED', 'ORD-second:PENDING']);
    expect(next.cashBalance).toBeCloseTo(100 - 90 - 90 * MAKER_FEE_RATE, 10);
    expect(next.holdings.BTC?.amount).toBe(1);
    expect(next.transactions).toHaveLength(1);
  });

  it('fills several affordable orders that cross on the same tick', () => {
    let schema = placeLimitOrder(makeSchema({ cashBalance: 200 }), BTC, 'BUY', 1, 90).updatedSchema;
    schema = placeLimitOrder(schema, BTC, 'BUY', 1, 90).updatedSchema;
    expect(getOpenOrders(schema)).toHaveLength(2);

    const next = evaluateOpenOrders(schema, { BTC: 88 });
    const fillCost = 90 + 90 * MAKER_FEE_RATE;

    expect(next.orders.every((order) => order.status === 'FILLED')).toBe(true);
    expect(next.cashBalance).toBeCloseTo(200 - fillCost * 2, 10);
    expect(next.holdings.BTC?.amount).toBe(2);
  });

  it('closes the position and drops the row on a full limit sell', () => {
    const resting = placeLimitOrder(
      makeSchema({ holdings: { BTC: makeHolding({ amount: DUST_THRESHOLD / 2 }) } }),
      BTC,
      'SELL',
      DUST_THRESHOLD / 2,
      150
    ).updatedSchema;

    const next = evaluateOpenOrders(resting, { BTC: 160 });
    expect(next.holdings.BTC).toBeUndefined();
  });

  it('preserves the relative order of the order book', () => {
    const resting = withLimitBuy(90, 1);
    const next = evaluateOpenOrders(resting, { BTC: 80 });
    expect(next.orders).toHaveLength(1);
    expect(getOrderById(next, resting.orders[0]?.id ?? '')).toBeDefined();
  });
});
