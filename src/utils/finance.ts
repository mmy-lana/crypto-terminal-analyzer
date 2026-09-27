import { StorageSchema, CryptoAsset, PositionHolding } from '../types/terminal';

export function calculateSharpeRatio(
  returns: number[],
  riskFreeRateDaily: number = 0.0001
): number {
  if (returns.length < 2) return 0;
  const meanReturn = returns.reduce((acc, r) => acc + r, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) /
    (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return Number(((meanReturn - riskFreeRateDaily) / stdDev * Math.sqrt(365)).toFixed(2));
}

export function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;
  let peak = equityCurve[0];
  let maxDrawdown = 0;

  for (let i = 0; i < equityCurve.length; i++) {
    const current = equityCurve[i];
    if (current > peak) {
      peak = current;
    }
    const drawdown = (peak - current) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Number((maxDrawdown * 100).toFixed(2));
}

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

export interface LiveHolding extends PositionHolding {
  liveMarketPrice: number;
}

export interface LivePortfolioValuation {
  holdings: Record<string, LiveHolding>;
  totalInvested: number;
  totalMarketValue: number;
  totalEquity: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

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
    Object.keys(liveHoldings).forEach((symbol) => {
      liveHoldings[symbol].allocationPercent = Number(
        ((liveHoldings[symbol].currentValue / totalEquity) * 100).toFixed(2)
      );
    });
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
