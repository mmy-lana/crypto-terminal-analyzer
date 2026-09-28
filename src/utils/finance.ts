/**
 * Pure financial mathematics for the terminal.
 *
 * Nothing in this module touches React, storage or the DOM: every export is a
 * deterministic function of its arguments, which is what makes the risk
 * console reproducible and unit-testable.
 *
 * Division-by-zero is guarded everywhere. A brand new paper account has no
 * transactions, no cost basis and therefore no defined volatility, drawdown or
 * profit factor — those must degrade to `0` (or `Infinity` for a profit factor
 * with no losing trade) instead of poisoning the panel with `NaN`.
 *
 * Note: real-time mark-to-market calculations live here. Committed
 * transaction-state calculations reside in engine.ts (`recalculateHolding`).
 * Keep calculation formulas aligned.
 */

import {
  CryptoAsset,
  PositionHolding,
  RiskMetrics,
  StorageSchema,
  TransactionRecord,
} from '../types/terminal';
import { DUST_THRESHOLD as ENGINE_DUST_THRESHOLD } from './engine';

/** Crypto trades every calendar day, so annualisation uses a 365-day year. */
export const TRADING_DAYS_PER_YEAR = 365;

/** Daily risk-free rate assumed by the Sharpe ratio, in decimal form. */
export const DEFAULT_RISK_FREE_RATE_DAILY = 0.0001;

/**
 * Position size at or below which a holding is treated as fully closed.
 *
 * Deliberately the execution engine's constant rather than a second copy of
 * it. This module rebuilds positions by replaying the transaction log, the
 * engine writes them by applying fills, and a floor that differed between the
 * two produced a position that was persisted in one and invisible in the
 * other: the ledger and the portfolio disagreed about what was held.
 */
const DUST_THRESHOLD = ENGINE_DUST_THRESHOLD;

/**
 * Variance below this is float residue, not risk.
 *
 * A perfectly flat series (every tick identical) still yields ~1e-18 after the
 * sum-of-squares pass. Without this guard the Sharpe numerator stays finite
 * while the denominator collapses to nothing, and the panel would print a
 * meaningless 1e15 ratio for a flat account.
 */
const VARIANCE_EPSILON = 1e-12;

/**
 * Annualised Sharpe ratio of a daily return series.
 *
 * Returns `0` for series shorter than two observations or with zero variance —
 * a flat equity curve is not a risk-adjusted opportunity, it is an absence of
 * data, and reporting `Infinity` there would be misleading.
 *
 * Non-finite observations are dropped before the moments are taken. A single
 * `NaN` in the input would otherwise make the mean `NaN` and collapse the
 * reported Sharpe to `NaN` for the whole panel; a single `Infinity` would do
 * the same with a far more alarming print. Both are worse than ignoring the
 * sample, and the remaining observations are still a valid series.
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRateDaily: number = DEFAULT_RISK_FREE_RATE_DAILY
): number {
  const cleanReturns = returns.filter((r) => Number.isFinite(r));
  if (cleanReturns.length < 2) return 0;
  const meanReturn = cleanReturns.reduce((acc, r) => acc + r, 0) / cleanReturns.length;
  const variance =
    cleanReturns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) /
    (cleanReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (!Number.isFinite(stdDev) || stdDev <= VARIANCE_EPSILON) return 0;
  return Number((((meanReturn - riskFreeRateDaily) / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR)).toFixed(2));
}

/** Largest peak-to-trough decline of an equity curve, expressed as a percentage. */
export function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;
  let peak = equityCurve[0] ?? 0;
  let maxDrawdown = 0;

  for (const value of equityCurve) {
    if (value > peak) {
      peak = value;
    }
    if (peak <= 0) {
      continue;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Number((maxDrawdown * 100).toFixed(2));
}

/** Sample standard deviation of a return series, in decimal form. */
export function calculateStandardDeviation(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((acc, r) => acc + r, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  return stdDev <= VARIANCE_EPSILON ? 0 : stdDev;
}

/** Daily volatility (sample standard deviation of daily returns) as a percentage. */
export function calculateDailyVolatility(returns: number[]): number {
  const stdDev = calculateStandardDeviation(returns);
  if (stdDev === 0) return 0;
  return Number((stdDev * 100).toFixed(2));
}

/**
 * Converts an equity curve into period-over-period returns.
 *
 * Any interval whose opening equity is zero or negative has no defined return
 * and is skipped, so a wiped-out account yields a shorter series instead of an
 * infinite one.
 */
export function calculateReturnSeries(equityCurve: number[]): number[] {
  if (equityCurve.length < 2) return [];

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const previous = equityCurve[i - 1] ?? 0;
    const current = equityCurve[i] ?? 0;
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0) {
      continue;
    }
    returns.push((current - previous) / previous);
  }
  return returns;
}

/** Portfolio weight of every holding, as a percentage of total equity. */
export function computeAllocation(
  holdings: Record<string, PositionHolding>,
  totalEquity: number
): Record<string, number> {
  const allocation: Record<string, number> = {};
  if (totalEquity <= 0) return allocation;

  Object.entries(holdings).forEach(([symbol, pos]) => {
    allocation[symbol] = Number(((pos.currentValue / totalEquity) * 100).toFixed(2));
  });

  return allocation;
}

/** A holding marked against the live market feed rather than its last committed value. */
export interface LiveHolding extends PositionHolding {
  liveMarketPrice: number;
}

/** Mark-to-market snapshot of the whole paper account. */
export interface LivePortfolioValuation {
  holdings: Record<string, LiveHolding>;
  totalInvested: number;
  totalMarketValue: number;
  totalEquity: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

/** A holding rebuilt by replaying the transaction ledger. */
export interface LedgerPosition {
  symbol: string;
  amount: number;
  averageEntryPrice: number;
  totalCost: number;
}

/** Performance statistics recovered by replaying every settled transaction. */
export interface LedgerReconstruction {
  /** Equity after each transaction, starting from the initial deposit. */
  equityCurve: number[];
  /** Period-over-period returns derived from {@link equityCurve}. */
  returns: number[];
  realizedPnL: number;
  totalFees: number;
  /** Number of closing executions, i.e. realised round trips. */
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRatePercent: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  /** Positions still open according to the ledger, keyed by symbol. */
  openPositions: Record<string, LedgerPosition>;
}

/** Sort direction for ledger reads. */
export type TransactionOrder = 'newest' | 'oldest';

/** Stable ledger sort: newest first by default, oldest first for replay. */
export function orderTransactionsByTime(
  transactions: TransactionRecord[],
  order: TransactionOrder = 'newest'
): TransactionRecord[] {
  const sorted = [...transactions].sort((a, b) => {
    const left = Date.parse(a.timestamp);
    const right = Date.parse(b.timestamp);
    const safeLeft = Number.isNaN(left) ? 0 : left;
    const safeRight = Number.isNaN(right) ? 0 : right;
    if (safeLeft === safeRight) {
      return a.id.localeCompare(b.id);
    }
    return safeLeft - safeRight;
  });
  return order === 'newest' ? sorted.reverse() : sorted;
}

/**
 * Replays the transaction ledger to recover realised performance.
 *
 * The paper account has no historical price feed, so the equity curve is built
 * from cash-accurate information only: the initial deposit, realised P&L
 * obtained by matching each sale against its average cost basis, and fees.
 * A sale whose opening position is not in the ledger (possible after a seed
 * portfolio is traded) still contributes its net proceeds to equity, but it
 * cannot be attributed a cost basis and therefore books no realised P&L.
 */
export function reconstructLedger(
  transactions: TransactionRecord[],
  initialDeposit: number
): LedgerReconstruction {
  const ordered = orderTransactionsByTime(transactions, 'oldest');

  const positions = new Map<string, LedgerPosition>();
  const equityCurve: number[] = [initialDeposit];

  let equity = initialDeposit;
  let realizedPnL = 0;
  let totalFees = 0;
  let tradeCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin = 0;
  let largestLoss = 0;

  for (const tx of ordered) {
    if (!Number.isFinite(tx.amount) || !Number.isFinite(tx.totalValue) || tx.amount <= 0) {
      continue;
    }
    const fee = Number.isFinite(tx.fee) ? tx.fee : 0;
    totalFees += fee;

    if (tx.side === 'BUY') {
      const position = positions.get(tx.symbol) ?? {
        symbol: tx.symbol,
        amount: 0,
        averageEntryPrice: 0,
        totalCost: 0,
      };
      position.amount += tx.amount;
      position.totalCost += tx.totalValue;
      position.averageEntryPrice = position.amount > 0 ? position.totalCost / position.amount : 0;
      positions.set(tx.symbol, position);

      // Cash leaves the account for inventory, so equity only moves by the fee.
      equity -= fee;
    } else {
      const position = positions.get(tx.symbol);

      if (position !== undefined && position.amount > 0) {
        const soldAmount = Math.min(tx.amount, position.amount);
        const costBasisSold = position.averageEntryPrice * soldAmount;
        const realised = tx.totalValue - costBasisSold;

        realizedPnL += realised;
        equity += realised - fee;
        tradeCount += 1;

        if (realised > 0) {
          winCount += 1;
          grossProfit += realised;
          largestWin = Math.max(largestWin, realised);
        } else if (realised < 0) {
          lossCount += 1;
          grossLoss += -realised;
          largestLoss = Math.min(largestLoss, realised);
        }

        position.amount -= soldAmount;
        position.totalCost = Math.max(0, position.totalCost - costBasisSold);
        position.averageEntryPrice = position.amount > 0 ? position.totalCost / position.amount : 0;

        if (position.amount <= DUST_THRESHOLD) {
          positions.delete(tx.symbol);
        }
      } else {
        // No cost basis available: book the cash, not a phantom gain.
        equity += tx.totalValue - fee;
      }
    }

    equityCurve.push(equity);
  }

  const openPositions: Record<string, LedgerPosition> = {};
  for (const [symbol, position] of positions) {
    if (position.amount > DUST_THRESHOLD) {
      openPositions[symbol] = { ...position };
    }
  }

  return {
    equityCurve,
    returns: calculateReturnSeries(equityCurve),
    realizedPnL,
    totalFees,
    tradeCount,
    winCount,
    lossCount,
    winRatePercent: tradeCount > 0 ? Number(((winCount / tradeCount) * 100).toFixed(2)) : 0,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    largestWin,
    largestLoss,
    openPositions,
  };
}

/**
 * Full risk console payload: live mark-to-market equity combined with the
 * realised history recovered from the ledger.
 */
export function aggregateRiskMetrics(
  schema: StorageSchema,
  valuation: LivePortfolioValuation
): RiskMetrics {
  const ledger = reconstructLedger(schema.transactions, schema.initialDeposit);
  const totalPnL = ledger.realizedPnL + valuation.unrealizedPnL;
  const initialDeposit = Number.isFinite(schema.initialDeposit) ? schema.initialDeposit : 0;

  return {
    totalEquity: valuation.totalEquity,
    cashBalance: schema.cashBalance,
    unrealizedPnL: valuation.unrealizedPnL,
    realizedPnL: ledger.realizedPnL,
    totalPnL,
    totalPnLPercent: initialDeposit > 0 ? Number(((totalPnL / initialDeposit) * 100).toFixed(2)) : 0,
    winRatePercent: ledger.winRatePercent,
    profitFactor: ledger.profitFactor,
    maxDrawdownPercent: calculateMaxDrawdown(ledger.equityCurve),
    sharpeRatio: calculateSharpeRatio(ledger.returns),
    volatilityDaily: calculateDailyVolatility(ledger.returns),
    largestWin: ledger.largestWin,
    largestLoss: ledger.largestLoss,
    totalTradesCount: ledger.tradeCount,
  };
}

/**
 * Mark-to-market valuation of the whole account against the live market feed.
 *
 * Holdings are re-priced every tick; the committed values in storage are the
 * ledger truth and are never mutated by a price move.
 */
export function deriveLiveValuation(
  schema: StorageSchema,
  assets: Record<string, CryptoAsset>
): LivePortfolioValuation {
  let totalInvested = 0;
  let totalMarketValue = 0;
  const liveHoldings: Record<string, LiveHolding> = {};

  Object.entries(schema.holdings).forEach(([symbol, holding]) => {
    const marketPrice = assets[symbol]?.currentPrice ?? holding.averageEntryPrice;
    const currentValue = holding.amount * marketPrice;
    const unrealizedPnL = currentValue - holding.totalCost;
    const unrealizedPnLPercent =
      holding.totalCost > 0 ? (unrealizedPnL / holding.totalCost) * 100 : 0;

    totalInvested += holding.totalCost;
    totalMarketValue += currentValue;

    liveHoldings[symbol] = {
      ...holding,
      liveMarketPrice: marketPrice,
      currentValue,
      unrealizedPnL,
      unrealizedPnLPercent,
      allocationPercent: 0,
    };
  });

  const totalEquity = schema.cashBalance + totalMarketValue;
  const unrealizedPnL = totalMarketValue - totalInvested;
  const unrealizedPnLPercent = totalInvested > 0 ? (unrealizedPnL / totalInvested) * 100 : 0;

  if (totalEquity > 0) {
    for (const holding of Object.values(liveHoldings)) {
      holding.allocationPercent = Number(((holding.currentValue / totalEquity) * 100).toFixed(2));
    }
  }

  return {
    holdings: liveHoldings,
    totalInvested,
    totalMarketValue,
    totalEquity,
    unrealizedPnL,
    unrealizedPnLPercent,
  };
}

/**
 * Pearson correlation between two equal-length return series.
 *
 * Returns 0 when the inputs are too short, misaligned, or when either series
 * is constant — a constant series has zero variance, so the denominator is
 * zero and the coefficient is undefined rather than infinite.
 */
export function calculatePearsonCorrelation(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length < 2) return 0;

  let sumLeft = 0;
  let sumRight = 0;
  for (let i = 0; i < length; i++) {
    sumLeft += left[i] ?? 0;
    sumRight += right[i] ?? 0;
  }
  const meanLeft = sumLeft / length;
  const meanRight = sumRight / length;

  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let i = 0; i < length; i++) {
    const deltaLeft = (left[i] ?? 0) - meanLeft;
    const deltaRight = (right[i] ?? 0) - meanRight;
    covariance += deltaLeft * deltaRight;
    varianceLeft += deltaLeft * deltaLeft;
    varianceRight += deltaRight * deltaRight;
  }

  const denominator = Math.sqrt(varianceLeft * varianceRight);
  if (!Number.isFinite(denominator) || denominator < VARIANCE_EPSILON) return 0;

  const correlation = covariance / denominator;
  if (!Number.isFinite(correlation)) return 0;
  // Guard against float overshoot past the mathematical bound.
  return Math.max(-1, Math.min(1, correlation));
}

/**
 * Drawdown at every point of an equity curve, as a percentage below the
 * running peak. Index 0 is always 0 because the first point is its own peak.
 *
 * The output is the same length as the input so it can be plotted against the
 * equity curve. A non-finite sample is therefore carried forward as the
 * previous drawdown rather than propagated: a `NaN` here would be drawn as a
 * collapsed area chart and would break the peak recovery that follows it.
 */
export function calculateDrawdownSeries(equityCurve: number[]): number[] {
  const series: number[] = [];
  let peak = Number.NEGATIVE_INFINITY;
  let lastDrawdown = 0;

  for (const equity of equityCurve) {
    if (!Number.isFinite(equity)) {
      series.push(lastDrawdown);
      continue;
    }
    if (equity > peak) {
      peak = equity;
    }
    lastDrawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    series.push(lastDrawdown);
  }

  return series;
}
