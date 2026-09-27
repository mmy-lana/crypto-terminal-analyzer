/**
 * Offline persistence for the paper trading account.
 *
 * The terminal is a single-user local instrument: the authoritative ledger
 * lives in `localStorage` and the whole app reads it through this one hook.
 *
 * Three hazards are handled explicitly:
 *
 *  1. **React StrictMode double-mount.** The hydration effect re-runs twice in
 *     development. The payload read during hydration is therefore recorded as
 *     already-persisted, so the second pass never writes back what it just
 *     read — no redundant serialisation, no quota pressure.
 *  2. **Schema drift.** A stored payload from an older or newer version is never
 *     partially trusted; the account is re-seeded and the migration is written
 *     into the system log so the operator can see it happen.
 *  3. **Corruption and quota exhaustion.** Unparseable or structurally invalid
 *     payloads are recovered with a log entry, and a failed write surfaces a
 *     typed error to the shell instead of throwing inside React.
 *
 * All mutations go through `updateSchema(prev => next)`, a functional update.
 * Passing a pre-computed object would drop writes whenever two market ticks and
 * an order submission land in the same frame.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogLevel,
  OrderRecord,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionHolding,
  StorageSchema,
  SystemLogEntry,
  TransactionRecord,
} from '../types/terminal';

/** `localStorage` key holding the paper account ledger. */
export const STORAGE_KEY = 'TERMINAL_CRYPTO_ANALYTICS_V1';

/** Bumped whenever the persisted shape changes; older payloads are migrated by reset. */
export const SCHEMA_VERSION = 1;

/** Ledger caps — an unbounded log would eventually blow the 5 MB origin quota. */
export const MAX_LOG_ENTRIES = 400;
export const MAX_ORDER_ENTRIES = 250;
export const MAX_TRANSACTION_ENTRIES = 500;

const LOG_LEVELS: readonly LogLevel[] = ['INFO', 'WARN', 'EXEC', 'SYS'];
const ORDER_SIDES: readonly OrderSide[] = ['BUY', 'SELL'];
const ORDER_TYPES: readonly OrderType[] = ['MARKET', 'LIMIT'];
const ORDER_STATUSES: readonly OrderStatus[] = ['PENDING', 'FILLED', 'CANCELLED', 'REJECTED'];

/** Everything the terminal shell needs from the persistence layer. */
export interface TerminalStorage {
  data: StorageSchema;
  updateSchema: (updater: (prev: StorageSchema) => StorageSchema) => void;
  resetPortfolio: () => void;
  storageError: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Collision-resistant id with a readable prefix, e.g. `ORD-0f1c…`. */
export function generateCryptoId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function createLog(level: LogLevel, source: string, message: string): SystemLogEntry {
  return {
    id: generateCryptoId('LOG'),
    timestamp: nowIso(),
    level,
    source,
    message,
  };
}

/**
 * A freshly seeded paper account: $100,000 of dry powder with a starter book
 * of BTC and ETH, so the risk console has something to render on first boot.
 * A factory (not a constant) guarantees fresh timestamps after a reset.
 */
export function createInitialState(): StorageSchema {
  const timestamp = nowIso();

  return {
    version: SCHEMA_VERSION,
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
        lastUpdated: timestamp,
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
        lastUpdated: timestamp,
      },
    },
    orders: [],
    transactions: [],
    watchlist: ['BTC', 'ETH', 'SOL', 'AVAX', 'BNB', 'NEAR'],
    logs: [createLog('SYS', 'KERNEL', 'CORE SYSTEMS INITIALIZED. PAPER TRADING ENGINE ONLINE.')],
    lastCheckpoint: timestamp,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isHolding(value: unknown): value is PositionHolding {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.symbol) &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.amount) &&
    isFiniteNumber(value.averageEntryPrice) &&
    isFiniteNumber(value.totalCost) &&
    isFiniteNumber(value.currentValue) &&
    isFiniteNumber(value.unrealizedPnL) &&
    isFiniteNumber(value.unrealizedPnLPercent) &&
    isFiniteNumber(value.allocationPercent) &&
    isNonEmptyString(value.lastUpdated)
  );
}

function isOrderRecord(value: unknown): value is OrderRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.clientOrderId) &&
    isNonEmptyString(value.symbol) &&
    typeof value.side === 'string' &&
    ORDER_SIDES.includes(value.side as OrderSide) &&
    typeof value.type === 'string' &&
    ORDER_TYPES.includes(value.type as OrderType) &&
    isFiniteNumber(value.price) &&
    isFiniteNumber(value.amount) &&
    isFiniteNumber(value.filledAmount) &&
    isFiniteNumber(value.totalValue) &&
    typeof value.status === 'string' &&
    ORDER_STATUSES.includes(value.status as OrderStatus) &&
    isFiniteNumber(value.fee) &&
    isNonEmptyString(value.createdAt) &&
    isOptionalString(value.executedAt)
  );
}

function isTransactionRecord(value: unknown): value is TransactionRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.symbol) &&
    typeof value.side === 'string' &&
    ORDER_SIDES.includes(value.side as OrderSide) &&
    isFiniteNumber(value.executionPrice) &&
    isFiniteNumber(value.amount) &&
    isFiniteNumber(value.totalValue) &&
    isFiniteNumber(value.fee) &&
    isNonEmptyString(value.timestamp)
  );
}

function isLogEntry(value: unknown): value is SystemLogEntry {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.timestamp) &&
    typeof value.level === 'string' &&
    LOG_LEVELS.includes(value.level as LogLevel) &&
    isNonEmptyString(value.source) &&
    typeof value.message === 'string'
  );
}

/** Structural validation of a payload decoded from `localStorage`. */
export function isStorageSchema(value: unknown): value is StorageSchema {
  if (!isRecord(value)) return false;

  const holdings = value.holdings;
  if (!isRecord(holdings) || !Object.values(holdings).every(isHolding)) return false;

  if (!Array.isArray(value.orders) || !value.orders.every(isOrderRecord)) return false;
  if (!Array.isArray(value.transactions) || !value.transactions.every(isTransactionRecord)) return false;
  if (!Array.isArray(value.logs) || !value.logs.every(isLogEntry)) return false;
  if (!Array.isArray(value.watchlist) || !value.watchlist.every(isNonEmptyString)) return false;

  return (
    isFiniteNumber(value.version) &&
    isFiniteNumber(value.cashBalance) &&
    isFiniteNumber(value.initialDeposit) &&
    isNonEmptyString(value.lastCheckpoint)
  );
}

/** Trims the append-only collections to their caps, keeping the newest entries. */
export function trimState(state: StorageSchema): StorageSchema {
  return {
    ...state,
    orders: state.orders.slice(0, MAX_ORDER_ENTRIES),
    transactions: state.transactions.slice(0, MAX_TRANSACTION_ENTRIES),
    logs: state.logs.slice(0, MAX_LOG_ENTRIES),
  };
}

/** Reseeded account carrying one explanatory system-log entry. */
function recoveredState(message: string): StorageSchema {
  const fresh = createInitialState();
  return {
    ...fresh,
    logs: [createLog('WARN', 'STORAGE_RECOVERY', message), ...fresh.logs],
  };
}

/** Reads and validates the persisted ledger, falling back to a seeded account. */
export function readPersistedState(): StorageSchema {
  if (typeof localStorage === 'undefined') {
    return createInitialState();
  }

  let serialized: string | null;
  try {
    serialized = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.error('Storage read failure:', error);
    return recoveredState('LOCAL STORAGE IS UNREADABLE. SESSION STARTED WITH A DEFAULT PORTFOLIO.');
  }

  if (serialized === null || serialized.length === 0) {
    return createInitialState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return recoveredState('PERSISTED PAYLOAD IS CORRUPT AND WAS DISCARDED. PORTFOLIO RESET TO DEFAULT.');
  }

  if (!isStorageSchema(parsed)) {
    return recoveredState('PERSISTED PAYLOAD FAILED INTEGRITY CHECKS AND WAS DISCARDED. PORTFOLIO RESET TO DEFAULT.');
  }

  if (parsed.version !== SCHEMA_VERSION) {
    const migrated = createInitialState();
    return {
      ...migrated,
      logs: [
        createLog(
          'SYS',
          'STORAGE_MIGRATION',
          `SCHEMA VERSION MISMATCH (${parsed.version} -> ${SCHEMA_VERSION}). PORTFOLIO RESET TO DEFAULT.`
        ),
        ...migrated.logs,
      ],
    };
  }

  return trimState(parsed);
}

function describeStorageError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'LOCAL STORAGE QUOTA EXCEEDED. RECENT LEDGER CHANGES ARE SESSION-ONLY.';
  }
  return 'LOCAL STORAGE WRITE BLOCKED. RECENT LEDGER CHANGES ARE SESSION-ONLY.';
}

/** Reactive access to the paper account ledger. */
export function useTerminalStorage(): TerminalStorage {
  const [data, setData] = useState<StorageSchema>(readPersistedState);
  const [storageError, setStorageError] = useState<string | null>(null);
  const lastPersistedRef = useRef<string | null>(null);

  useEffect(() => {
    // Mount-only: the hydrated payload is already in storage, so record it as
    // persisted. This also neutralises the StrictMode double-mount write.
    lastPersistedRef.current = JSON.stringify(data);
  }, []);

  useEffect(() => {
    const serialized = JSON.stringify(data);
    if (serialized === lastPersistedRef.current) {
      return;
    }
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, serialized);
      lastPersistedRef.current = serialized;
    } catch (error) {
      console.error('Storage write failure:', error);
      setStorageError(describeStorageError(error));
    }
  }, [data]);

  const updateSchema = useCallback((updater: (prev: StorageSchema) => StorageSchema) => {
    setData((current) => {
      const next = updater(current);
      if (next === current) {
        return current;
      }
      return { ...next, lastCheckpoint: nowIso() };
    });
  }, []);

  const resetPortfolio = useCallback(() => {
    setStorageError(null);
    setData(createInitialState());
  }, []);

  return { data, updateSchema, resetPortfolio, storageError };
}
