/**
 * Paper matching & execution engine.
 *
 * Every mutation is expressed as `(schema) => ExecutionResult`: the engine
 * never touches React state or storage, it returns the next committed ledger
 * state. Callers must funnel that through the functional `updateSchema(prev => …)`
 * updater so concurrent market ticks and order submissions can never observe a
 * stale snapshot.
 *
 * Fee model — takers pay 0.1%, resting limit orders earn 0.05% maker rebate.
 * Market orders additionally cross the synthetic spread, modelled as a flat
 * 0.05% adverse slippage on both sides.
 */

import {
  CryptoAsset,
  OrderRecord,
  OrderSide,
  OrderType,
  PositionHolding,
  StorageSchema,
  SystemLogEntry,
  TransactionRecord,
} from '../types/terminal';
import { generateCryptoId } from '../hooks/useTerminalStorage';
import { formatCurrency, formatQuantity, formatSignedCurrency } from './formatters';

/** Taker commission applied to market orders: 0.1%. */
export const TAKER_FEE_RATE = 0.001;
/** Maker commission applied to resting limit fills: 0.05%. */
export const MAKER_FEE_RATE = 0.0005;
/** Synthetic slippage paid when a market order crosses the spread: 0.05%. */
export const SLIPPAGE_FACTOR = 0.0005;
/**
 * Position size at or below which a holding is considered fully closed.
 *
 * This is float residue, not a tradable amount. One micro-unit was far too
 * coarse: an asset quoted in satoshi can legitimately be held in amounts
 * smaller than that, and the old floor deleted the row the moment a partial
 * sell left one behind — taking its cost basis, its allocation and its
 * position count with it, while the cash from the sell had already been
 * credited. The operator is left with proceeds from a position the terminal no
 * longer admits to having held.
 *
 * At 1e-11 the only quantities that disappear are ones that cannot be
 * represented as a position at all: a fully closed line, and the residue a
 * subtraction like 0.3 - 0.1 - 0.2 leaves behind.
 *
 * `finance.ts` reads this same constant rather than keeping a copy, so the
 * execution path and the analytics path cannot disagree about which positions
 * exist.
 */
export const DUST_THRESHOLD = 1e-11;

/** Machine-readable rejection reasons surfaced by the order ticket. */
export type ExecutionErrorCode =
  | 'INVALID_SYMBOL'
  | 'INVALID_AMOUNT'
  | 'INVALID_PRICE'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_ASSET_BALANCE'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_CANCELABLE';

/** Result of any ledger mutation. A failed result returns the input schema untouched. */
export interface ExecutionResult {
  success: boolean;
  error?: ExecutionErrorCode;
  updatedSchema: StorageSchema;
}

/** Pre-trade cost preview used by the order ticket and the command palette. */
export interface OrderEstimate {
  executionPrice: number;
  totalValue: number;
  fee: number;
  /** Signed change to the cash balance once this order settles (negative = debit). */
  cashDelta: number;
}

/** Commission rate for an order type. */
export function feeRateForOrderType(type: OrderType): number {
  return type === 'LIMIT' ? MAKER_FEE_RATE : TAKER_FEE_RATE;
}

/** Commission charged on a notional amount. */
export function calculateFee(notional: number, type: OrderType): number {
  if (!Number.isFinite(notional) || notional <= 0) {
    return 0;
  }
  return notional * feeRateForOrderType(type);
}

/**
 * Price a market order executes at: buys lift the offer, sells hit the bid.
 * Limit orders rest at their limit price and never slip.
 */
export function applySlippage(price: number, side: OrderSide): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  const slipped = side === 'BUY' ? price * (1 + SLIPPAGE_FACTOR) : price * (1 - SLIPPAGE_FACTOR);
  return Number(Math.max(slipped, 0).toFixed(8));
}

/** Full cost preview for a prospective order, including commission and cash impact. */
export function estimateOrder(
  price: number,
  amount: number,
  type: OrderType,
  side: OrderSide
): OrderEstimate {
  const executionPrice = type === 'MARKET' ? applySlippage(price, side) : price;
  const totalValue = executionPrice * amount;
  const fee = calculateFee(totalValue, type);
  const cashDelta = side === 'BUY' ? -(totalValue + fee) : totalValue - fee;
  return { executionPrice, totalValue, fee, cashDelta };
}

/**
 * Cash committed to resting buy-limit orders.
 *
 * Placing a limit order debits nothing — the order may never fill — but the cash
 * it will need is spoken for the moment it rests. Without an escrow the same
 * balance can back any number of working buys: each is checked against a
 * `cashBalance` that none of them has touched, and all of them pass. They then
 * fill against collateral that has already been spent. `applyFill` refuses the
 * ones that no longer have cover, so the ledger does not go negative, but the
 * order does not fail either: it stays `PENDING`, is retried on every market
 * tick, and sits in the working-orders queue for the rest of the session as an
 * order the operator can neither see through nor escape.
 *
 * Escrowed rather than debited, deliberately. The notional stays in
 * `cashBalance`, so a fill, a cancel and the portfolio total need no
 * compensating entry, and the reserved amount is released the instant the order
 * stops resting. What is withheld is the *available* figure, which is what a new
 * order is judged against.
 */
export function reservedCash(schema: StorageSchema): number {
  let total = 0;
  for (const order of schema.orders) {
    if (order.side !== 'BUY' || order.status !== 'PENDING') continue;
    // A partially filled order has already been charged for the filled part, so
    // only the remainder is still collateral.
    const remaining = order.amount - order.filledAmount;
    if (remaining <= 0) continue;
    total += Math.abs(estimateOrder(order.price, remaining, 'LIMIT', 'BUY').cashDelta);
  }
  return total;
}

/** Cash an operator can actually commit to a new order right now. */
export function availableCash(schema: StorageSchema): number {
  return Math.max(0, schema.cashBalance - reservedCash(schema));
}

function isPositiveFinite(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rejection(error: ExecutionErrorCode, schema: StorageSchema): ExecutionResult {
  return { success: false, error, updatedSchema: schema };
}

/** A zeroed position row, ready to be filled by the first execution. */
export function createEmptyHolding(symbol: string, name: string): PositionHolding {
  return {
    symbol,
    name,
    amount: 0,
    averageEntryPrice: 0,
    totalCost: 0,
    currentValue: 0,
    unrealizedPnL: 0,
    unrealizedPnLPercent: 0,
    allocationPercent: 0,
    lastUpdated: nowIso(),
  };
}

/**
 * Recomputes every derived field of a holding after its quantity or cost basis
 * changed. `recalculateHolding` commits ledger truth during trade/limit fills;
 * continuous mark-to-market re-pricing on ticks lives in `deriveLiveValuation`.
 */
export function recalculateHolding(
  holding: PositionHolding,
  newAmount: number,
  newTotalCost: number,
  marketPrice: number
): PositionHolding {
  const currentValue = newAmount * marketPrice;
  const unrealizedPnL = currentValue - newTotalCost;
  const unrealizedPnLPercent = newTotalCost > 0 ? (unrealizedPnL / newTotalCost) * 100 : 0;
  const averageEntryPrice = newAmount > 0 ? newTotalCost / newAmount : 0;

  return {
    ...holding,
    amount: newAmount,
    averageEntryPrice,
    totalCost: newTotalCost,
    currentValue,
    unrealizedPnL,
    unrealizedPnLPercent,
    lastUpdated: nowIso(),
  };
}

/** Recomputes the portfolio weight of every holding against current equity. */
export function applyAllocations(schema: StorageSchema): StorageSchema {
  const holdingsValue = Object.values(schema.holdings).reduce((acc, h) => acc + h.currentValue, 0);
  const totalEquity = schema.cashBalance + holdingsValue;

  if (totalEquity <= 0) return schema;

  const updatedHoldings: Record<string, PositionHolding> = {};
  for (const [symbol, holding] of Object.entries(schema.holdings)) {
    updatedHoldings[symbol] = {
      ...holding,
      allocationPercent: Number(((holding.currentValue / totalEquity) * 100).toFixed(2)),
    };
  }

  return { ...schema, holdings: updatedHoldings };
}

/** Internal fill result: the next ledger plus the order, transaction and log rows it produced. */
interface FillOutcome {
  schema: StorageSchema;
  order: OrderRecord;
  transaction: TransactionRecord;
  log: SystemLogEntry;
}

/**
 * Applies one fill to a ledger snapshot.
 *
 * `fillPrice` is what the order actually paid (limit price, or slipped market
 * price); `markPrice` is the market at the instant of the fill and is what the
 * resulting position is marked against. Returns `null` — leaving the ledger
 * untouched — when the account cannot settle the trade.
 */
function applyFill(
  schema: StorageSchema,
  order: OrderRecord,
  fillPrice: number,
  markPrice: number,
  feeRate: number,
  source: string,
  /**
   * Cash this fill may draw on. Defaults to the ledger balance, which is the
   * right answer for a resting order: its own collateral is already inside
   * `reservedCash`, so discounting the escrow here would make the fill refuse
   * the very reservation that was placed to guarantee it. A market order
   * reserves nothing, so its caller passes the unencumbered figure instead.
   */
  spendable: number = schema.cashBalance
): FillOutcome | null {
  const executedAt = nowIso();
  const totalValue = fillPrice * order.amount;
  const fee = totalValue * feeRate;

  let nextCash: number;
  let nextHoldings: Record<string, PositionHolding>;
  let realisedForLog = '';

  if (order.side === 'BUY') {
    const debit = totalValue + fee;
    if (spendable < debit) {
      return null;
    }

    const current = schema.holdings[order.symbol] ?? createEmptyHolding(order.symbol, order.symbol);
    nextHoldings = {
      ...schema.holdings,
      [order.symbol]: recalculateHolding(
        current,
        current.amount + order.amount,
        current.totalCost + totalValue,
        markPrice
      ),
    };
    nextCash = schema.cashBalance - debit;
  } else {
    const current = schema.holdings[order.symbol];
    if (current === undefined || current.amount < order.amount) {
      return null;
    }

    const credit = totalValue - fee;
    const costBasisSold = current.averageEntryPrice * order.amount;
    const realised = totalValue - costBasisSold;
    const remainingAmount = current.amount - order.amount;

    nextHoldings = { ...schema.holdings };
    // A full exit, and only a full exit, drops the row. A partial sell leaves a
    // position behind and it is carried forward at its pro-rata cost basis, so
    // the terminal keeps admitting to what it is still holding.
    if (remainingAmount <= DUST_THRESHOLD) {
      delete nextHoldings[order.symbol];
    } else {
      const remainingCost = Math.max(0, current.totalCost - costBasisSold);
      nextHoldings[order.symbol] = recalculateHolding(
        current,
        remainingAmount,
        remainingCost,
        markPrice
      );
    }

    nextCash = schema.cashBalance + credit;
    realisedForLog = realised === 0 ? '' : ` (PnL: ${formatSignedCurrency(realised)})`;
  }

  const filledOrder: OrderRecord = {
    ...order,
    filledAmount: order.amount,
    totalValue,
    status: 'FILLED',
    fee,
    executedAt,
  };

  const transaction: TransactionRecord = {
    id: generateCryptoId('TX'),
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    executionPrice: fillPrice,
    amount: order.amount,
    totalValue,
    fee,
    timestamp: executedAt,
  };

  const message =
    source === 'LIMIT_MATCH'
      ? `LIMIT ORDER FILLED: ${order.side} ${formatQuantity(order.amount)} ${order.symbol} @ ${formatCurrency(fillPrice)}`
      : `EXECUTED ${order.side} ${formatQuantity(order.amount)} ${order.symbol} @ ${formatCurrency(fillPrice)}${realisedForLog}`;

  const log: SystemLogEntry = {
    id: generateCryptoId('LOG'),
    timestamp: executedAt,
    level: 'EXEC',
    source,
    message,
  };

  return {
    schema: {
      ...schema,
      cashBalance: nextCash,
      holdings: nextHoldings,
    },
    order: filledOrder,
    transaction,
    log,
  };
}

/**
 * Submits a market order: it crosses the spread immediately and settles in full.
 *
 * Rejects with `INSUFFICIENT_FUNDS` when the debit exceeds free cash, and with
 * `INSUFFICIENT_ASSET_BALANCE` when selling more than the account holds.
 */
export function executeMarketOrder(
  schema: StorageSchema,
  asset: CryptoAsset,
  side: OrderSide,
  amount: number
): ExecutionResult {
  if (typeof asset.symbol !== 'string' || asset.symbol.length === 0) {
    return rejection('INVALID_SYMBOL', schema);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return rejection('INVALID_AMOUNT', schema);
  }
  if (!isPositiveFinite(asset.currentPrice)) {
    return rejection('INVALID_PRICE', schema);
  }

  const executionPrice = applySlippage(asset.currentPrice, side);
  const createdAt = nowIso();
  const pendingOrder: OrderRecord = {
    id: generateCryptoId('ORD'),
    clientOrderId: generateCryptoId('CLI'),
    symbol: asset.symbol,
    side,
    type: 'MARKET',
    price: executionPrice,
    amount,
    filledAmount: 0,
    totalValue: 0,
    status: 'PENDING',
    fee: 0,
    createdAt,
  };

  // A market order holds no reservation of its own, so it is funded from cash
  // that working buy limits have not already escrowed.
  const outcome = applyFill(
    schema,
    pendingOrder,
    executionPrice,
    asset.currentPrice,
    TAKER_FEE_RATE,
    'MATCH_ENGINE',
    availableCash(schema)
  );
  if (outcome === null) {
    return rejection(side === 'BUY' ? 'INSUFFICIENT_FUNDS' : 'INSUFFICIENT_ASSET_BALANCE', schema);
  }

  const settled: StorageSchema = {
    ...outcome.schema,
    orders: [outcome.order, ...schema.orders],
    transactions: [outcome.transaction, ...schema.transactions],
    logs: [outcome.log, ...schema.logs],
  };

  return { success: true, updatedSchema: applyAllocations(settled) };
}

/**
 * Rests a limit order on the book.
 *
 * The order is validated against the account at submission time, but nothing
 * is reserved: a buy that was affordable when it was placed can still fail to
 * settle if the balance is spent before the limit price trades.
 */
export function placeLimitOrder(
  schema: StorageSchema,
  asset: CryptoAsset,
  side: OrderSide,
  amount: number,
  limitPrice: number
): ExecutionResult {
  if (typeof asset.symbol !== 'string' || asset.symbol.length === 0) {
    return rejection('INVALID_SYMBOL', schema);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return rejection('INVALID_AMOUNT', schema);
  }
  if (!isPositiveFinite(limitPrice)) {
    return rejection('INVALID_PRICE', schema);
  }

  const estimate = estimateOrder(limitPrice, amount, 'LIMIT', side);
  // Judged against unencumbered cash, not the ledger balance: working buys
  // ahead of this one have already reserved their collateral.
  if (side === 'BUY' && availableCash(schema) < Math.abs(estimate.cashDelta)) {
    return rejection('INSUFFICIENT_FUNDS', schema);
  }
  if (side === 'SELL') {
    const holding = schema.holdings[asset.symbol];
    if (holding === undefined || holding.amount < amount) {
      return rejection('INSUFFICIENT_ASSET_BALANCE', schema);
    }
  }

  const createdAt = nowIso();
  const order: OrderRecord = {
    id: generateCryptoId('ORD'),
    clientOrderId: generateCryptoId('CLI'),
    symbol: asset.symbol,
    side,
    type: 'LIMIT',
    price: limitPrice,
    amount,
    filledAmount: 0,
    totalValue: limitPrice * amount,
    status: 'PENDING',
    fee: 0,
    createdAt,
  };

  const log: SystemLogEntry = {
    id: generateCryptoId('LOG'),
    timestamp: createdAt,
    level: 'INFO',
    source: 'ORDER_ENTRY',
    message: `LIMIT ORDER WORKING: ${side} ${formatQuantity(amount)} ${asset.symbol} @ ${formatCurrency(limitPrice)}`,
  };

  return {
    success: true,
    updatedSchema: {
      ...schema,
      orders: [order, ...schema.orders],
      logs: [log, ...schema.logs],
    },
  };
}

/** Working (pending) limit orders, newest first. */
export function getOpenOrders(schema: StorageSchema): OrderRecord[] {
  return schema.orders.filter((order) => order.status === 'PENDING');
}

/** Looks up a single order by its exchange-assigned id. */
export function getOrderById(schema: StorageSchema, orderId: string): OrderRecord | undefined {
  return schema.orders.find((order) => order.id === orderId);
}

/**
 * Cancels a working order. Filled, rejected and already cancelled orders are
 * immutable, so they report `ORDER_NOT_CANCELABLE` rather than silently
 * rewriting settled history.
 */
export function cancelOrder(schema: StorageSchema, orderId: string): ExecutionResult {
  const target = getOrderById(schema, orderId);
  if (target === undefined) {
    return rejection('ORDER_NOT_FOUND', schema);
  }
  if (target.status !== 'PENDING') {
    return rejection('ORDER_NOT_CANCELABLE', schema);
  }

  const cancelledAt = nowIso();
  const log: SystemLogEntry = {
    id: generateCryptoId('LOG'),
    timestamp: cancelledAt,
    level: 'WARN',
    source: 'ORDER_ENTRY',
    message: `ORDER CANCELLED: ${target.side} ${formatQuantity(target.amount)} ${target.symbol} @ ${formatCurrency(target.price)}`,
  };

  return {
    success: true,
    updatedSchema: {
      ...schema,
      orders: schema.orders.map((order) =>
        order.id === target.id ? { ...order, status: 'CANCELLED' as const } : order
      ),
      logs: [log, ...schema.logs],
    },
  };
}

/**
 * Advances the resting order book against a tick of live prices.
 *
 * A buy fills when the market trades at or below its limit, a sell at or above
 * it. Fills settle sequentially against the running ledger, so two orders
 * filling on the same tick cannot both spend the same cash or sell the same
 * coins. An order that cannot settle stays working; the original schema is
 * returned by reference when nothing filled, which lets the caller skip the
 * downstream state update entirely.
 */
export function evaluateOpenOrders(
  schema: StorageSchema,
  latestPrices: Record<string, number>
): StorageSchema {
  let workingSchema = schema;
  let hasChanges = false;

  const updatedOrders: OrderRecord[] = [];
  const newTransactions: TransactionRecord[] = [];
  const newLogs: SystemLogEntry[] = [];

  for (const order of schema.orders) {
    if (order.status !== 'PENDING') {
      updatedOrders.push(order);
      continue;
    }

    const currentPrice = latestPrices[order.symbol];
    if (!isPositiveFinite(currentPrice)) {
      updatedOrders.push(order);
      continue;
    }

    const shouldFillBuy = order.side === 'BUY' && currentPrice <= order.price;
    const shouldFillSell = order.side === 'SELL' && currentPrice >= order.price;

    if (!shouldFillBuy && !shouldFillSell) {
      updatedOrders.push(order);
      continue;
    }

    const outcome = applyFill(workingSchema, order, order.price, currentPrice, MAKER_FEE_RATE, 'LIMIT_MATCH');
    if (outcome === null) {
      // Price crossed the limit but the account cannot settle it: keep working.
      updatedOrders.push(order);
      continue;
    }

    workingSchema = outcome.schema;
    hasChanges = true;
    updatedOrders.push(outcome.order);
    newTransactions.push(outcome.transaction);
    newLogs.push(outcome.log);
  }

  if (!hasChanges) {
    return schema;
  }

  const resultSchema: StorageSchema = {
    ...workingSchema,
    orders: updatedOrders,
    transactions: [...newTransactions, ...schema.transactions],
    logs: [...newLogs, ...schema.logs],
  };

  return applyAllocations(resultSchema);
}
