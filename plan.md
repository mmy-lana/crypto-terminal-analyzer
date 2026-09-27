# SYSTEM ARCHITECTURE & IMPLEMENTATION PLAN
## Project: `crypto-terminal-analyzer`

---

### 1. DATA SCHEMA & PURE TYPESCRIPT INTERFACES

```typescript
// types/terminal.ts

export type OrderType = 'MARKET' | 'LIMIT';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type LogLevel = 'INFO' | 'WARN' | 'EXEC' | 'SYS';
export type TerminalTab = 'MONITOR' | 'TRADE' | 'ANALYTICS' | 'LEDGER';

export interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
  currentPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  sparkline: number[];
  marketCap: number;
  lastUpdated: string;
}

export interface PositionHolding {
  symbol: string;
  name: string;
  amount: number;
  averageEntryPrice: number;
  totalCost: number;
  currentValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  allocationPercent: number;
  lastUpdated: string;
}

export interface OrderRecord {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: number;
  filledAmount: number;
  totalValue: number;
  status: OrderStatus;
  fee: number;
  createdAt: string;
  executedAt?: string;
}

export interface TransactionRecord {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  executionPrice: number;
  amount: number;
  totalValue: number;
  fee: number;
  timestamp: string;
}

export interface OrderBookEntry {
  price: number;
  size: number;
  total: number;
}

export interface OrderBookState {
  symbol: string;
  lastPrice: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  spreadPercent: number;
}

export interface RiskMetrics {
  totalEquity: number;
  cashBalance: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalPnL: number;
  totalPnLPercent: number;
  winRatePercent: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  volatilityDaily: number;
  largestWin: number;
  largestLoss: number;
  totalTradesCount: number;
}

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface StorageSchema {
  version: number;
  cashBalance: number;
  initialDeposit: number;
  holdings: Record<string, PositionHolding>;
  orders: OrderRecord[];
  transactions: TransactionRecord[];
  watchlist: string[];
  logs: SystemLogEntry[];
  lastCheckpoint: string;
}
```

---

### 2. COMPONENT ARCHITECTURE

#### 2.1 Design Tokens & Bloomberg Palette Specifications
*   **Background Base:** `#0a0b0d` (Pitch Obsidian)
*   **Panel Surface:** `#12151a` (High-Density Charcoal)
*   **Panel Elevated:** `#181c24` (Header / Active Tab)
*   **Borders & Dividers:** `#262c36` (Hairline contrast)
*   **Terminal Amber:** `#d97706` / `#f59e0b` (Labels, system alerts, accent)
*   **Terminal Cyan:** `#06b6d4` (Asset symbols, execution tags)
*   **Monospace Metrics:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
*   **Numerical Alignment:** Tabular figures (`font-mono tabular-nums tracking-tight`)
*   **Gain/Loss Dynamics:** `#10b981` (Profit green) / `#f43f5e` (Loss scarlet)

#### 2.2 Component Hierarchy Tree

```
src/
├── components/
│   ├── primitives/
│   │   ├── TerminalPanel.tsx        # Container with scanline header, borders & command titles
│   │   ├── MetricCell.tsx           # High-density numerical display with micro-labels
│   │   ├── TerminalBadge.tsx        # High-contrast tag (BUY/SELL/EXEC/PENDING)
│   │   ├── TerminalInput.tsx        # Rigid input with prefix unit, step controls & hotkey focus
│   │   ├── ActionButton.tsx         # Flat, tactile terminal button (Amber/Cyan/Emerald/Rose)
│   │   └── TabularGrid.tsx          # Virtualized table container with zero scrollbars
│   ├── compound/
│   │   ├── HeaderBar.tsx            # Global time (UTC), connection heartbeat, equity summary
│   │   ├── TickerTape.tsx           # Continuous marquee or dense horizontal price bar
│   │   ├── OrderBookWidget.tsx      # Depth ladders (bids/asks), spread calculation, size bars
│   │   ├── SparklineChart.tsx       # Zero-dependency SVG path generator with min/max scale
│   │   ├── DepthVisualizer.tsx      # Canvas-based order depth cumulative curve
│   │   ├── CommandPalette.tsx       # Shortcut-driven execution launcher (e.g., BUY BTC 0.5)
│   │   └── SystemLogFeed.tsx        # Terminal console output stream with auto-scroll lock
│   └── domain/
│       ├── PortfolioSummaryPanel.tsx# Risk, Drawdown, Sharpe, Realized vs Unrealized
│       ├── HoldingsTable.tsx        # Position metrics, entry vs market, PnL allocation
│       ├── ExecutionTerminal.tsx    # Order ticket, slippage presets, margin simulator
│       ├── OrderBookContainer.tsx   # Live synthetic feed simulator + order matching visualizer
│       ├── AnalyticsInspector.tsx   # Asset correlation, allocation donut, drawdown curves
│       └── TransactionLedger.tsx    # Chronological trade history with export functionality
├── layouts/
│   ├── TerminalLayout.tsx           # Mobile-responsive grid orchestration with breakpoint state
│   └── MobileNavOverlay.tsx         # Quick-dock navigation bar for viewport <= 768px
```

---

### 3. CORE FEATURE LOGIC & ALGORITHMS

#### 3.1 Financial Calculation Engine (`src/utils/finance.ts`)

```typescript
import { StorageSchema, CryptoAsset, PositionHolding } from '../types/terminal';

// Note: Real-time mark-to-market calculations live here. Committed transaction-state
// calculations reside in engine.ts (recalculateHolding). Keep calculation formulas aligned.

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
```

#### 3.2 Mock Trade Matching & Execution Engine (`src/utils/engine.ts`)

```typescript
import { CryptoAsset, OrderRecord, PositionHolding, StorageSchema, TransactionRecord, SystemLogEntry } from '../types/terminal';

const TAKER_FEE_RATE = 0.001; // 0.1%
const MAKER_FEE_RATE = 0.0005; // 0.05%
const SLIPPAGE_FACTOR = 0.0005; // 0.05% synthetic slippage for market orders

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

// Note: recalculateHolding commits ledger truth during trade/limit fills.
// For continuous live mark-to-market updates on ticks, see deriveLiveValuation in finance.ts.
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
```

#### 3.3 Offline Storage & Reactive Persistence Hook (`src/hooks/useTerminalStorage.ts`)

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { StorageSchema } from '../types/terminal';

const STORAGE_KEY = 'TERMINAL_CRYPTO_ANALYTICS_V1';

const INITIAL_STATE: StorageSchema = {
  version: 1,
  cashBalance: 100000.0,
  initialDeposit: 100000.0,
  holdings: {
    BTC: {
      symbol: 'BTC',
      name: 'Bitcoin',
      amount: 1.25,
      averageEntryPrice: 61200.0,
      totalCost: 76500.0,
      currentValue: 81250.0,
      unrealizedPnL: 4750.0,
      unrealizedPnLPercent: 6.21,
      allocationPercent: 0,
      lastUpdated: new Date().toISOString(),
    },
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      amount: 8.5,
      averageEntryPrice: 3200.0,
      totalCost: 27200.0,
      currentValue: 28900.0,
      unrealizedPnL: 1700.0,
      unrealizedPnLPercent: 6.25,
      allocationPercent: 0,
      lastUpdated: new Date().toISOString(),
    },
  },
  orders: [],
  transactions: [],
  watchlist: ['BTC', 'ETH', 'SOL', 'AVAX', 'BNB', 'NEAR'],
  logs: [
    {
      id: 'INIT-1',
      timestamp: new Date().toISOString(),
      level: 'SYS',
      source: 'KERNEL',
      message: 'CORE SYSTEMS INITIALIZED. PAPER TRADING ENGINE ONLINE.',
    },
  ],
  lastCheckpoint: new Date().toISOString(),
};

export function useTerminalStorage() {
  const [data, setData] = useState<StorageSchema>(() => {
    try {
      const serialized = localStorage.getItem(STORAGE_KEY);
      if (!serialized) return INITIAL_STATE;
      const parsed = JSON.parse(serialized);
      if (parsed.version === INITIAL_STATE.version) {
        return parsed;
      }
      return {
        ...INITIAL_STATE,
        logs: [
          {
            id: `LOG-RESET-${Date.now()}`,
            timestamp: new Date().toISOString(),
            level: 'SYS',
            source: 'STORAGE_MIGRATION',
            message: `SCHEMA VERSION MISMATCH (${parsed.version} -> ${INITIAL_STATE.version}). PORTFOLIO RESET TO DEFAULT.`,
          },
          ...INITIAL_STATE.logs,
        ],
      };
    } catch {
      return INITIAL_STATE;
    }
  });

  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Storage write failure:', e);
    }
  }, [data]);

  // Mandatory functional setter with no-op short circuit to prevent localStorage write-storms
  const updateSchema = useCallback((updater: (prev: StorageSchema) => StorageSchema) => {
    setData((current) => {
      const next = updater(current);
      if (next === current) return current;
      return { ...next, lastCheckpoint: new Date().toISOString() };
    });
  }, []);

  const resetPortfolio = useCallback(() => {
    setData(INITIAL_STATE);
  }, []);

  return { data, updateSchema, resetPortfolio };
}

export function generateCryptoId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
```

#### 3.4 Real-time Market Stream Service (`src/services/marketFeed.ts`)

```typescript
import { CryptoAsset } from '../types/terminal';

export interface TickCallback {
  (prices: Record<string, number>, assets: Record<string, CryptoAsset>): void;
}

export const BASE_ASSETS: Record<string, CryptoAsset> = {
  BTC: {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    currentPrice: 65000.0,
    change24h: 2.45,
    high24h: 66200.0,
    low24h: 63800.0,
    volume24h: 28400500120,
    sparkline: [63800, 64200, 64100, 64900, 64700, 65800, 65000],
    marketCap: 1280000000000,
    lastUpdated: new Date().toISOString(),
  },
  ETH: {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    currentPrice: 3450.0,
    change24h: -1.15,
    high24h: 3520.0,
    low24h: 3410.0,
    volume24h: 14200300400,
    sparkline: [3520, 3500, 3480, 3460, 3420, 3440, 3450],
    marketCap: 415000000000,
    lastUpdated: new Date().toISOString(),
  },
  SOL: {
    id: 'solana',
    symbol: 'SOL',
    name: 'Solana',
    currentPrice: 145.2,
    change24h: 5.62,
    high24h: 148.0,
    low24h: 137.5,
    volume24h: 3800400100,
    sparkline: [138, 139, 142, 140, 144, 147, 145.2],
    marketCap: 67000000000,
    lastUpdated: new Date().toISOString(),
  },
  AVAX: {
    id: 'avalanche',
    symbol: 'AVAX',
    name: 'Avalanche',
    currentPrice: 28.4,
    change24h: 3.12,
    high24h: 29.5,
    low24h: 27.1,
    volume24h: 520400000,
    sparkline: [27.1, 27.5, 27.8, 28.1, 27.9, 28.6, 28.4],
    marketCap: 11200000000,
    lastUpdated: new Date().toISOString(),
  },
  BNB: {
    id: 'binancecoin',
    symbol: 'BNB',
    name: 'BNB',
    currentPrice: 580.0,
    change24h: 0.85,
    high24h: 590.0,
    low24h: 574.0,
    volume24h: 980100200,
    sparkline: [575, 576, 582, 579, 584, 581, 580],
    marketCap: 87000000000,
    lastUpdated: new Date().toISOString(),
  },
  NEAR: {
    id: 'near',
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    currentPrice: 5.25,
    change24h: -2.3,
    high24h: 5.5,
    low24h: 5.12,
    volume24h: 310500000,
    sparkline: [5.45, 5.4, 5.35, 5.2, 5.18, 5.3, 5.25],
    marketCap: 5800000000,
    lastUpdated: new Date().toISOString(),
  },
};

export function subscribeToMarketFeed(
  symbols: string[],
  onTick: TickCallback,
  intervalMs: number = 1000
): () => void {
  const localAssets: Record<string, CryptoAsset> = { ...BASE_ASSETS };

  const emitTick = () => {
    const priceUpdates: Record<string, number> = {};

    symbols.forEach((symbol) => {
      const existing = localAssets[symbol] || {
        id: symbol.toLowerCase(),
        symbol,
        name: symbol,
        currentPrice: 100.0,
        change24h: 0,
        high24h: 105.0,
        low24h: 95.0,
        volume24h: 1000000,
        sparkline: [100, 100, 100, 100],
        marketCap: 10000000,
        lastUpdated: new Date().toISOString(),
      };

      const percentShift = (Math.random() - 0.495) * 0.008; // -0.4% to +0.4%
      const newPrice = Number(Math.max(0.01, existing.currentPrice * (1 + percentShift)).toFixed(2));
      const newSparkline = [...existing.sparkline.slice(1), newPrice];

      localAssets[symbol] = {
        ...existing,
        currentPrice: newPrice,
        sparkline: newSparkline,
        high24h: Math.max(existing.high24h, newPrice),
        low24h: Math.min(existing.low24h, newPrice),
        lastUpdated: new Date().toISOString(),
      };

      priceUpdates[symbol] = newPrice;
    });

    onTick(priceUpdates, { ...localAssets });
  };

  // Immediate synchronous execution to eliminate initial mount null-flash
  emitTick();

  const intervalId = setInterval(emitTick, intervalMs);

  return () => {
    clearInterval(intervalId);
  };
}
```

#### 3.5 React Root Context & Closure-Safe Tick Loop (`src/context/TerminalContext.tsx`)

```typescript
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { CryptoAsset, StorageSchema, OrderSide } from '../types/terminal';
import { useTerminalStorage } from '../hooks/useTerminalStorage';
import { subscribeToMarketFeed } from '../services/marketFeed';
import { executeMarketOrder, evaluateOpenOrders } from '../utils/engine';

import { BASE_ASSETS } from '../services/marketFeed';
import { deriveLiveValuation, LivePortfolioValuation } from '../utils/finance';

interface TerminalContextValue {
  schema: StorageSchema;
  assets: Record<string, CryptoAsset>;
  livePortfolio: LivePortfolioValuation;
  selectedAsset: CryptoAsset | null;
  setSelectedSymbol: (symbol: string) => void;
  isSubmitting: boolean;
  executeTrade: (asset: CryptoAsset, side: OrderSide, amount: number) => Promise<{ success: boolean; error?: string }>;
  resetPortfolio: () => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export const TerminalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: schema, updateSchema, resetPortfolio } = useTerminalStorage();
  // Synchronously seed initial assets to eliminate first-tick null flashes
  const [assets, setAssets] = useState<Record<string, CryptoAsset>>(() => ({ ...BASE_ASSETS }));
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const symbolsToWatch = schema.watchlist.length > 0 ? schema.watchlist : ['BTC', 'ETH', 'SOL'];

    const unsubscribe = subscribeToMarketFeed(symbolsToWatch, (latestPrices, updatedAssets) => {
      setAssets((prev) => ({ ...prev, ...updatedAssets }));

      // Functional updater: strictly prevents stale closure race conditions
      updateSchema((prevSchema) => evaluateOpenOrders(prevSchema, latestPrices));
    });

    return () => {
      unsubscribe();
    };
  }, [schema.watchlist, updateSchema]);

  const executeTrade = useCallback(
    async (asset: CryptoAsset, side: OrderSide, amount: number) => {
      if (isSubmitting) {
        return { success: false, error: 'OPERATION_PENDING' };
      }

      setIsSubmitting(true);
      try {
        let executionResult: { success: boolean; error?: string } = { success: false, error: 'UNKNOWN' };

        // Atomic functional execution
        updateSchema((prevSchema) => {
          const result = executeMarketOrder(prevSchema, asset, side, amount);
          executionResult = { success: result.success, error: result.error };
          return result.success ? result.updatedSchema : prevSchema;
        });

        return executionResult;
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, updateSchema]
  );

  const selectedAsset = useMemo(
    () => assets[selectedSymbol] || null,
    [assets, selectedSymbol]
  );

  const livePortfolio = useMemo(
    () => deriveLiveValuation(schema, assets),
    [schema, assets]
  );

  const contextValue = useMemo<TerminalContextValue>(
    () => ({
      schema,
      assets,
      livePortfolio,
      selectedAsset,
      setSelectedSymbol,
      isSubmitting,
      executeTrade,
      resetPortfolio,
    }),
    [schema, assets, livePortfolio, selectedAsset, isSubmitting, executeTrade, resetPortfolio]
  );

  return (
    <TerminalContext.Provider value={contextValue}>
      {children}
    </TerminalContext.Provider>
  );
};

export function useTerminal(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}
```

#### 3.6 Canvas Lifecycle & High-DPI Scaling Utility (`src/utils/canvas.ts`)

```typescript
export function setupHiDPICanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  onRender: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
): () => void {
  let animationFrameId: number | null = null;

  const resizeAndRender = () => {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (width === 0 || height === 0) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    onRender(ctx, width, height);
    ctx.restore();
  };

  const observer = new ResizeObserver(() => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = requestAnimationFrame(resizeAndRender);
  });

  observer.observe(container);
  resizeAndRender();

  return () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
    observer.disconnect();
  };
}
```

#### 3.7 Hardened UI Primitives (`src/components/primitives/*`)

```typescript
// src/components/primitives/ActionButton.tsx
import React, { ButtonHTMLAttributes } from 'react';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'buy' | 'sell' | 'neutral' | 'terminal';
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  variant = 'terminal',
  className = '',
  disabled,
  children,
  ...props
}) => {
  const variantStyles = {
    buy: 'bg-[#10b981] hover:bg-[#059669] text-black font-bold active:brightness-90',
    sell: 'bg-[#f43f5e] hover:bg-[#e11d48] text-white font-bold active:brightness-90',
    neutral: 'bg-[#262c36] hover:bg-[#323a46] text-gray-200 active:brightness-90',
    terminal: 'bg-[#181c24] hover:bg-[#222733] text-amber-500 border border-amber-500/40 active:brightness-90',
  };

  return (
    <button
      disabled={disabled}
      className={`min-h-[44px] min-w-[44px] px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40 select-none ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

// src/components/primitives/TerminalInput.tsx
import React, { ChangeEvent } from 'react';

interface TerminalInputProps {
  label: string;
  value: number | string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onIncrement?: () => void;
  onDecrement?: () => void;
  min?: number;
  step?: number;
  disabled?: boolean;
}

export const TerminalInput: React.FC<TerminalInputProps> = ({
  label,
  value,
  onChange,
  onIncrement,
  onDecrement,
  min = 0,
  step = 0.01,
  disabled = false,
}) => (
  <div className="flex flex-col gap-1 font-mono">
    <span className="text-[10px] uppercase text-neutral-400 tracking-wider">{label}</span>
    <div className="flex border border-[#262c36] bg-[#0a0b0d] focus-within:border-amber-500">
      <input
        type="number"
        value={value}
        onChange={onChange}
        min={min}
        step={step}
        disabled={disabled}
        className="w-full bg-transparent px-3 py-2 font-mono text-sm text-neutral-100 outline-none tabular-nums"
      />
      <div className="flex divide-x divide-[#262c36] border-l border-[#262c36]">
        <button
          type="button"
          onClick={onDecrement}
          disabled={disabled}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-neutral-400 hover:bg-[#181c24] hover:text-white disabled:opacity-40"
        >
          -
        </button>
        <button
          type="button"
          onClick={onIncrement}
          disabled={disabled}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-neutral-400 hover:bg-[#181c24] hover:text-white disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  </div>
);

// src/components/primitives/TabularGrid.tsx
import React, { ReactNode } from 'react';

interface TabularGridProps {
  children: ReactNode;
  columns?: string; // CSS Grid template e.g., "minmax(80px, 1fr) minmax(70px, 1fr) minmax(70px, 1fr)"
  className?: string;
}

export const TabularGrid: React.FC<TabularGridProps> = ({
  children,
  columns,
  className = '',
}) => (
  <div className="w-full overflow-x-auto select-none scrollbar-none">
    <div
      style={columns ? { gridTemplateColumns: columns } : undefined}
      className={`min-w-[340px] font-mono text-xs tabular-nums ${columns ? 'grid' : ''} ${className}`}
    >
      {children}
    </div>
  </div>
);

export const TabularCell: React.FC<{
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
}> = ({ children, align = 'left', className = '' }) => {
  const alignClass = {
    left: 'text-left justify-start',
    center: 'text-center justify-center',
    right: 'text-right justify-end',
  }[align];

  return (
    <div className={`flex min-h-[36px] min-w-[70px] items-center px-2 ${alignClass} ${className}`}>
      {children}
    </div>
  );
};
```

---

### 4. FIVE-PHASE SEQUENTIAL QUEUE

#### Phase 1: Types, Storage/API Client Config, and Base Utilities
*   **Deliverables:**
    *   `package.json`: Target React latest, TypeScript latest, Vite latest, Tailwind CSS latest with `@tailwindcss/postcss`.
    *   `src/types/terminal.ts`: Complete TypeScript models for assets, positions, orders, book depth, logs, risk indices (excluding unhandled stop-limits).
    *   `src/utils/canvas.ts`: High-DPI canvas initialization and resizing utility (`setupHiDPICanvas(canvas, width, height)`) with `ResizeObserver` lifecycle management and context leak prevention.
    *   `src/utils/formatters.ts`: Bloomberg terminal number formatters (strict padding, tabular alignment, negative bracket notation `(124.50)`, currency symbol pinning, zero-fill).
    *   `src/utils/finance.ts`: Pure mathematical formulas for Sharpe, Max Drawdown, Daily Volatility, Realized/Unrealized Gain aggregations with zero-division guards.
    *   `src/utils/engine.ts`: Execution engine handling market fills, limit order queue, synthetic spread/slippage, taker/maker fee models, `createEmptyHolding`, and `recalculateHolding`.
    *   `src/services/marketFeed.ts`: Mock real-time streaming market provider with random-walk tick mutations, synthetic order book generation, and interval tickers.
    *   `src/hooks/useTerminalStorage.ts`: LocalStorage persistence hook with React StrictMode double-mount protection, version migration logging, and functional updates only.
*   **Verification Gates:** Unit tests for matching engine logic (buying above cash limits, selling nonexistent tokens, limit fill triggering, division by zero protection).

#### Phase 2: Design Foundation & Atomic UI Primitives
*   **Deliverables:**
    *   `src/index.css`: Tailwind v4 configuration via `@theme` (`--color-terminal-black: #0a0b0d`, `--color-terminal-charcoal: #12151a`, `--color-terminal-amber: #f59e0b`, `--color-terminal-emerald: #10b981`, `--color-terminal-rose: #f43f5e`, `--color-terminal-cyan: #06b6d4`, `--color-terminal-border: #262c36`), zero system fonts, hidden scrollbars, scanline overlay CSS rule.
    *   `src/components/primitives/TerminalPanel.tsx`: Structured layout container with rigid header bar, window status dots, hotkey corner indicator, and crisp hairline borders.
    *   `src/components/primitives/MetricCell.tsx`: High-density block showing metric title (amber/muted), formatted primary value, secondary delta, and micro-percentage change.
    *   `src/components/primitives/TerminalBadge.tsx`: Strict monospace status badge (`BUY`, `SELL`, `FILLED`, `LIMIT`).
    *   `src/components/primitives/ActionButton.tsx`: High-contrast keyboard-friendly button with `min-h-[44px] min-w-[44px]` touch target sizing, active state suppression, and tactile press styles.
    *   `src/components/primitives/TerminalInput.tsx`: Stepper numeric input with explicit `min-h-[44px] min-w-[44px]` stepper increment/decrement targets, shortcut keys, and precision constraints.
    *   `src/components/primitives/TabularGrid.tsx`: Virtualized table container with `overflow-x-auto` wrapper and explicit column min-widths (`min-w-[70px]`).
*   **Verification Gates:** Layout sanity check under 360px, 390px, 430px, 768px, and 1280px without element clipping or unwanted horizontal overflow.

#### Phase 3: Compound Molecules & Feature Components
*   **Deliverables:**
    *   `src/components/compound/HeaderBar.tsx`: System header showing current UTC timestamp, paper account balance, connection status ping, and global shortcut cues (`[1] MONITOR`, `[2] TRADE`, `[3] ANALYTICS`).
    *   `src/components/compound/TickerTape.tsx`: Scrolling or compact bar rendering active asset tickers, 24h delta, and volume indicators.
    *   `src/components/compound/OrderBookWidget.tsx`: Live simulated L2 order book ladder rendered with `TabularGrid` (`columns="minmax(70px, 1fr) minmax(70px, 1fr) minmax(70px, 1fr)"`) and `TabularCell` primitives, displaying top 10 bids/asks (desktop) or top 5 (mobile), depth bar widths, and spread calculations.
    *   `src/components/compound/SparklineChart.tsx`: Responsive SVG sparkline with relative `viewBox` coordinates and `w-full h-auto` scaling.
    *   `src/components/compound/DepthVisualizer.tsx`: Canvas order depth visualizer hooked to `ResizeObserver` teardown with automatic DPR scaling and DPR-normalized strokes.
    *   `src/components/compound/CommandPalette.tsx`: Terminal quick-command input modal triggering on pressing `/`, `F1`, or via an accessible floating mobile action button (FAB).
    *   `src/components/compound/SystemLogFeed.tsx`: Scrolling system execution terminal showing timestamped match logs, system events, and cancellation alerts.
*   **Verification Gates:** Render stress test with 50 synthetic updates per second on the order book and canvas visualizer without memory leaks or frame drops.

#### Phase 4: Domain Logic, Reactive State, and Specialized APIs
*   **Deliverables:**
    *   `src/context/TerminalContext.tsx`: Root reactive context routing all mutations exclusively through `updateSchema(prev => ...)` functional updates to eliminate tick/order closure race conditions.
    *   `src/hooks/useOrderBook.ts`: Generator hook creating deterministic synthetic bid/ask ladders with randomized micro-fluctuations around current spot prices.
    *   `src/components/domain/ExecutionTerminal.tsx`: Complete trade execution interface supporting Market and Limit tabs, percentage slider presets (25%, 50%, 75%, 100%), estimated fee breakdown, slippage warning markers, and an `isSubmitting` lock preventing double-tap execution.
    *   `src/components/domain/HoldingsTable.tsx`: Tabular inventory of active crypto assets rendered with `TabularGrid` and `TabularCell` primitives, consuming `livePortfolio.holdings` (real-time mark price, live PnL, live allocation) instead of stale `schema.holdings`, with direct `EXIT` action buttons.
    *   `src/components/domain/PortfolioSummaryPanel.tsx`: Core metrics console consuming `livePortfolio` (live equity, total unrealized mark PnL) combined with `schema.transactions` for Sharpe ratio, drawdown, and historical win/loss ratios.
    *   `src/components/domain/TransactionLedger.tsx`: Audit table rendered with `TabularGrid` (`columns="minmax(80px, 1fr) minmax(70px, 1fr) minmax(80px, 1fr) minmax(70px, 1fr) minmax(60px, 1fr) minmax(90px, 1fr)"`) and `TabularCell` listing all past executions, matched orders, fees paid, and timestamps with CSV export capability.
*   **Verification Gates:** End-to-end execution of a trade with instant update verification across Holdings, Risk Metrics, System Log, and Cash balance.

#### Phase 5: Complete Page/Screen Assembly & Responsive Shell
*   **Deliverables:**
    *   `src/layouts/TerminalLayout.tsx`: Grid layout coordinating panel arrangements:
        *   *Desktop (1024px+):* 3-column financial workstation (Column 1: Market Watch & Logs; Column 2: Order Book & Execution Terminal; Column 3: Portfolio Summary & Holdings).
        *   *Tablet (768px - 1023px):* 2-column balanced configuration.
        *   *Mobile (360px - 767px):* Bottom docked tab bar (`[MONITOR]`, `[TRADE]`, `[POSITIONS]`, `[LOGS]`), non-hover touch controls, minimum 44px tap targets, horizontally scrollable data tables.
    *   `src/App.tsx`: Top-level composition binding providers, hotkey listeners (`keydown` events for `1-4`, `B`, `S`, `/`, `Escape`), and error boundary fallback.
    *   `src/components/primitives/ErrorBoundary.tsx`: Fail-safe recovery view in terminal motif (`SYSTEM CRASH: CODE DUMP & LOCAL STORAGE RECOVERY`).
*   **Verification Gates:** Mobile audit at 360px width (Samsung Galaxy S8/SE layout), 390px (iPhone 12/13/14), and 430px (iPhone 14 Pro Max) verifying zero text clipping, accessible targets, and full mock trade execution cycle without hover requirements.

---

### 5. MOBILE & HIGH-DENSITY RESPONSIVENESS MATRIX

| Breakpoint | Layout Strategy | Critical UI Adjustments |
| :--- | :--- | :--- |
| **360px - 430px (Mobile)** | Single panel with fixed bottom tab bar | Hide volume/market cap columns in table; Order book renders top 5 bids/asks only; Command bar expands as full-screen modal; No hover-only buttons. |
| **768px (Tablet)** | 2-column split (60% Analysis / 40% Trade) | Condensed order book depth; holdings displayed with sparklines; hotkey hints visible in headers. |
| **1024px+ (Desktop)** | 3-column Bloomberg Workstation | Full depth ladder (12 bids/12 asks); simultaneous real-time log feed, execution terminal, and metrics panel. |