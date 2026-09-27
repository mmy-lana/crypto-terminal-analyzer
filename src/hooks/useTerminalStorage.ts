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

export function generateCryptoId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

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
