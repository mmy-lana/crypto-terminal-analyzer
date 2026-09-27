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
