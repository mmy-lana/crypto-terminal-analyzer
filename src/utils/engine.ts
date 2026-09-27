import {
  CryptoAsset,
  OrderRecord,
  PositionHolding,
  StorageSchema,
  TransactionRecord,
  SystemLogEntry,
} from '../types/terminal';
import { generateCryptoId } from '../hooks/useTerminalStorage';

const TAKER_FEE_RATE = 0.001;
const MAKER_FEE_RATE = 0.0005;
const SLIPPAGE_FACTOR = 0.0005;

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
    lastUpdated: new Date().toISOString(),
  };
}

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
    lastUpdated: new Date().toISOString(),
  };
}

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

export function executeMarketOrder(
  schema: StorageSchema,
  asset: CryptoAsset,
  side: 'BUY' | 'SELL',
  amount: number
): { success: boolean; error?: string; updatedSchema: StorageSchema } {
  if (amount <= 0) {
    return { success: false, error: 'INVALID_AMOUNT', updatedSchema: schema };
  }

  const executionPrice =
    side === 'BUY'
      ? asset.currentPrice * (1 + SLIPPAGE_FACTOR)
      : asset.currentPrice * (1 - SLIPPAGE_FACTOR);

  const totalValue = executionPrice * amount;
  const fee = totalValue * TAKER_FEE_RATE;

  if (side === 'BUY') {
    const totalRequired = totalValue + fee;
    if (schema.cashBalance < totalRequired) {
      return { success: false, error: 'INSUFFICIENT_FUNDS', updatedSchema: schema };
    }

    const currentHolding = schema.holdings[asset.symbol] || createEmptyHolding(asset.symbol, asset.name);
    const updatedHolding = recalculateHolding(
      currentHolding,
      currentHolding.amount + amount,
      currentHolding.totalCost + totalValue,
      asset.currentPrice
    );

    const orderId = generateCryptoId('ORD');
    const newOrder: OrderRecord = {
      id: orderId,
      clientOrderId: generateCryptoId('CLI'),
      symbol: asset.symbol,
      side: 'BUY',
      type: 'MARKET',
      price: executionPrice,
      amount,
      filledAmount: amount,
      totalValue,
      status: 'FILLED',
      fee,
      createdAt: new Date().toISOString(),
      executedAt: new Date().toISOString(),
    };

    const newTx: TransactionRecord = {
      id: generateCryptoId('TX'),
      orderId,
      symbol: asset.symbol,
      side: 'BUY',
      executionPrice,
      amount,
      totalValue,
      fee,
      timestamp: new Date().toISOString(),
    };

    const draftSchema: StorageSchema = {
      ...schema,
      cashBalance: schema.cashBalance - totalRequired,
      holdings: { ...schema.holdings, [asset.symbol]: updatedHolding },
      orders: [newOrder, ...schema.orders],
      transactions: [newTx, ...schema.transactions],
      logs: [
        {
          id: generateCryptoId('LOG'),
          timestamp: new Date().toISOString(),
          level: 'EXEC',
          source: 'MATCH_ENGINE',
          message: `EXECUTED BUY ${amount} ${asset.symbol} @ ${executionPrice.toFixed(2)} USD`,
        },
        ...schema.logs,
      ],
    };

    return { success: true, updatedSchema: applyAllocations(draftSchema) };
  } else {
    const currentHolding = schema.holdings[asset.symbol];
    if (!currentHolding || currentHolding.amount < amount) {
      return { success: false, error: 'INSUFFICIENT_ASSET_BALANCE', updatedSchema: schema };
    }

    const netReceived = totalValue - fee;
    const remainingAmount = currentHolding.amount - amount;
    const costBasisSold = currentHolding.averageEntryPrice * amount;
    const realizedPnL = totalValue - costBasisSold;

    const updatedHoldings = { ...schema.holdings };
    if (remainingAmount <= 0.000001) {
      delete updatedHoldings[asset.symbol];
    } else {
      const remainingCost = Math.max(0, currentHolding.totalCost - costBasisSold);
      updatedHoldings[asset.symbol] = recalculateHolding(
        currentHolding,
        remainingAmount,
        remainingCost,
        asset.currentPrice
      );
    }

    const orderId = generateCryptoId('ORD');
    const newOrder: OrderRecord = {
      id: orderId,
      clientOrderId: generateCryptoId('CLI'),
      symbol: asset.symbol,
      side: 'SELL',
      type: 'MARKET',
      price: executionPrice,
      amount,
      filledAmount: amount,
      totalValue,
      status: 'FILLED',
      fee,
      createdAt: new Date().toISOString(),
      executedAt: new Date().toISOString(),
    };

    const newTx: TransactionRecord = {
      id: generateCryptoId('TX'),
      orderId,
      symbol: asset.symbol,
      side: 'SELL',
      executionPrice,
      amount,
      totalValue,
      fee,
      timestamp: new Date().toISOString(),
    };

    const draftSchema: StorageSchema = {
      ...schema,
      cashBalance: schema.cashBalance + netReceived,
      holdings: updatedHoldings,
      orders: [newOrder, ...schema.orders],
      transactions: [newTx, ...schema.transactions],
      logs: [
        {
          id: generateCryptoId('LOG'),
          timestamp: new Date().toISOString(),
          level: 'EXEC',
          source: 'MATCH_ENGINE',
          message: `EXECUTED SELL ${amount} ${asset.symbol} @ ${executionPrice.toFixed(2)} USD (PnL: ${realizedPnL.toFixed(2)})`,
        },
        ...schema.logs,
      ],
    };

    return { success: true, updatedSchema: applyAllocations(draftSchema) };
  }
}

export function evaluateOpenOrders(
  schema: StorageSchema,
  latestPrices: Record<string, number>
): StorageSchema {
  let hasChanges = false;
  let modifiedCash = schema.cashBalance;
  const modifiedHoldings = { ...schema.holdings };
  const updatedOrders: OrderRecord[] = [];
  const newTransactions: TransactionRecord[] = [];
  const newLogs: SystemLogEntry[] = [];

  for (const order of schema.orders) {
    if (order.status !== 'PENDING') {
      updatedOrders.push(order);
      continue;
    }

    const currentPrice = latestPrices[order.symbol];
    if (!currentPrice || currentPrice <= 0) {
      updatedOrders.push(order);
      continue;
    }

    const shouldFillBuy = order.side === 'BUY' && currentPrice <= order.price;
    const shouldFillSell = order.side === 'SELL' && currentPrice >= order.price;

    if (shouldFillBuy || shouldFillSell) {
      const fillPrice = order.price;
      const totalVal = fillPrice * order.amount;
      const fee = totalVal * MAKER_FEE_RATE;

      if (order.side === 'BUY') {
        const totalCost = totalVal + fee;
        if (modifiedCash >= totalCost) {
          hasChanges = true;
          modifiedCash -= totalCost;
          const currentH = modifiedHoldings[order.symbol] || createEmptyHolding(order.symbol, order.symbol);
          modifiedHoldings[order.symbol] = recalculateHolding(
            currentH,
            currentH.amount + order.amount,
            currentH.totalCost + totalVal,
            currentPrice
          );

          updatedOrders.push({
            ...order,
            status: 'FILLED',
            filledAmount: order.amount,
            executedAt: new Date().toISOString(),
          });
          newTransactions.push({
            id: generateCryptoId('TX'),
            orderId: order.id,
            symbol: order.symbol,
            side: 'BUY',
            executionPrice: fillPrice,
            amount: order.amount,
            totalValue: totalVal,
            fee,
            timestamp: new Date().toISOString(),
          });
          newLogs.push({
            id: generateCryptoId('LOG'),
            timestamp: new Date().toISOString(),
            level: 'EXEC',
            source: 'LIMIT_MATCH',
            message: `LIMIT ORDER FILLED: BUY ${order.amount} ${order.symbol} @ ${fillPrice.toFixed(2)}`,
          });
          continue;
        }
      } else {
        const currentH = modifiedHoldings[order.symbol];
        if (currentH && currentH.amount >= order.amount) {
          hasChanges = true;
          const netGain = totalVal - fee;
          modifiedCash += netGain;
          const remainingAmount = currentH.amount - order.amount;
          const costSold = currentH.averageEntryPrice * order.amount;

          if (remainingAmount <= 0.000001) {
            delete modifiedHoldings[order.symbol];
          } else {
            const remCost = Math.max(0, currentH.totalCost - costSold);
            modifiedHoldings[order.symbol] = recalculateHolding(
              currentH,
              remainingAmount,
              remCost,
              currentPrice
            );
          }

          updatedOrders.push({
            ...order,
            status: 'FILLED',
            filledAmount: order.amount,
            executedAt: new Date().toISOString(),
          });
          newTransactions.push({
            id: generateCryptoId('TX'),
            orderId: order.id,
            symbol: order.symbol,
            side: 'SELL',
            executionPrice: fillPrice,
            amount: order.amount,
            totalValue: totalVal,
            fee,
            timestamp: new Date().toISOString(),
          });
          newLogs.push({
            id: generateCryptoId('LOG'),
            timestamp: new Date().toISOString(),
            level: 'EXEC',
            source: 'LIMIT_MATCH',
            message: `LIMIT ORDER FILLED: SELL ${order.amount} ${order.symbol} @ ${fillPrice.toFixed(2)}`,
          });
          continue;
        }
      }
    }

    updatedOrders.push(order);
  }

  if (!hasChanges) return schema;

  const resultSchema: StorageSchema = {
    ...schema,
    cashBalance: modifiedCash,
    holdings: modifiedHoldings,
    orders: updatedOrders,
    transactions: [...newTransactions, ...schema.transactions],
    logs: [...newLogs, ...schema.logs],
  };

  return applyAllocations(resultSchema);
}
