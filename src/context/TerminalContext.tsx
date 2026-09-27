import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { CryptoAsset, OrderSide, RiskMetrics, StorageSchema } from '../types/terminal';
import { useTerminalStorage } from '../hooks/useTerminalStorage';
import { BASE_ASSETS, subscribeToMarketFeed } from '../services/marketFeed';
import {
  ExecutionErrorCode,
  cancelOrder,
  evaluateOpenOrders,
  executeMarketOrder,
  placeLimitOrder,
} from '../utils/engine';
import { aggregateRiskMetrics, deriveLiveValuation, LivePortfolioValuation } from '../utils/finance';
import { describeExecutionError } from '../utils/errorCopy';
import { formatCompactId, formatCurrency, formatQuantity } from '../utils/formatters';

/** Result of any order action, mirroring the engine's error vocabulary. */
export interface TerminalActionResult {
  success: boolean;
  error?: ExecutionErrorCode | 'OPERATION_PENDING' | 'NO_ASSET' | 'UNKNOWN_SYMBOL';
}

/** Transient operator-facing outcome banner, driven by the last action. */
export interface TerminalNotice {
  id: string;
  level: 'EXEC' | 'WARN' | 'INFO';
  message: string;
  createdAt: string;
}

export interface TerminalContextValue {
  schema: StorageSchema;
  assets: Record<string, CryptoAsset>;
  livePortfolio: LivePortfolioValuation;
  riskMetrics: RiskMetrics;
  selectedSymbol: string;
  selectedAsset: CryptoAsset | null;
  setSelectedSymbol: (symbol: string) => void;
  /**
   * Side armed on the order ticket.
   *
   * Lives here rather than inside `ExecutionTerminal` so the global `B`/`S`
   * shortcuts can arm it without reaching into the ticket's internals — the
   * plan lists both keys as first-class input.
   */
  orderSide: OrderSide;
  setOrderSide: (side: OrderSide) => void;
  /** Bumped when a shortcut wants the ticket scrolled into view. */
  ticketFocusNonce: number;
  focusTicket: () => void;
  /** True while a submission is in flight; blocks double submits. */
  isSubmitting: boolean;
  executeTrade: (asset: CryptoAsset, side: OrderSide, amount: number) => Promise<TerminalActionResult>;
  submitLimitOrder: (
    asset: CryptoAsset,
    side: OrderSide,
    amount: number,
    price: number
  ) => Promise<TerminalActionResult>;
  cancelOrderById: (orderId: string) => Promise<TerminalActionResult>;
  resetPortfolio: () => void;
  notice: TerminalNotice | null;
  dismissNotice: () => void;
  /**
   * Active persistence failure, or `null` when the ledger is being saved.
   *
   * Deliberately separate from `notice`: that channel is transient and the next
   * action overwrites it, which is exactly wrong for this. A fill announces
   * itself moments after the write that failed, so pushing the reason onto the
   * notice bar alone means the operator reads "FILLED" and never learns the fill
   * is session-only. The shell renders this as a standing alarm instead.
   */
  storageError: string | null;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

const FALLBACK_WATCHLIST = ['BTC', 'ETH', 'SOL'];

/** Outcome of a state transaction plus the value the caller needs back. */
interface Transaction<T> {
  updatedSchema: StorageSchema;
  value: T;
}

export const TerminalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: schema, updateSchema, resetPortfolio, storageError } = useTerminalStorage();

  // Seed synchronously from the base universe so the first paint never shows a
  // null quote (plan §3.5).
  const [assets, setAssets] = useState<Record<string, CryptoAsset>>(() => ({ ...BASE_ASSETS }));
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [notice, setNotice] = useState<TerminalNotice | null>(null);

  // A persistence failure is otherwise invisible: the trade fills, the panels
  // update, the operator refreshes, and the paper ledger is gone. `storageError`
  // is exposed below and the shell renders it as a standing alarm for that
  // reason.
  //
  // It is deliberately NOT pushed onto `notice`. That channel is transient and
  // every state change writes to it, and the writer that matters here loses the
  // race: a failed write is discovered by an effect that runs *before*
  // `executeTrade` announces its own fill, so the "FILLED" notice overwrites the
  // storage reason one commit later. Measured, not assumed — the regression
  // suite in `src/__tests__/storageFailure.test.tsx` caught exactly that. The
  // alarm is `role="alert"`, so it is announced on appearance regardless.


  // The ref, not the state, is the re-entrancy guard: `isSubmitting` only
  // re-renders after the fact, so two clicks in the same task would both pass
  // a state check.
  const submittingRef = useRef(false);

  // Latest committed schema, readable synchronously from an event handler.
  const schemaRef = useRef<StorageSchema>(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  const pushNotice = useCallback((level: TerminalNotice['level'], message: string) => {
    setNotice({
      id: `NOTICE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      createdAt: new Date().toISOString(),
    });
  }, []);

  // The watchlist array is rebuilt on every commit, so its *contents* — not the
  // array identity — are the stable subscription key.
  const watchlistKey = schema.watchlist.length > 0 ? schema.watchlist.join(',') : '';

  useEffect(() => {
    const symbolsToWatch = watchlistKey === '' ? FALLBACK_WATCHLIST : watchlistKey.split(',');

    const unsubscribe = subscribeToMarketFeed(symbolsToWatch, (latestPrices, updatedAssets) => {
      setAssets((prev) => ({ ...prev, ...updatedAssets }));
      // Functional updater: the resting-order queue is evaluated against the
      // freshest schema, never a stale closure.
      updateSchema((prevSchema) => evaluateOpenOrders(prevSchema, latestPrices));
    });

    return () => {
      unsubscribe();
    };
  }, [watchlistKey, updateSchema]);

  /**
   * Applies a transaction to the freshest schema and resolves with its value.
   *
   * The work happens inside the state updater, so a fill that landed from a
   * market tick microseconds earlier is part of the state the transaction sees.
   * Reading `schemaRef` and committing afterwards would instead let the commit
   * overwrite that fill. React may invoke an updater more than once, which is
   * harmless here: the transaction is pure and a promise settles once.
   */
  const runTransaction = useCallback(
    <T,>(transaction: (prev: StorageSchema) => Transaction<T>): Promise<T> =>
      new Promise<T>((resolve) => {
        updateSchema((prev) => {
          const { updatedSchema, value } = transaction(prev);
          schemaRef.current = updatedSchema;
          resolve(value);
          return updatedSchema;
        });
      }),
    [updateSchema]
  );

  const withSubmissionLock = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T | TerminalActionResult> => {
      if (submittingRef.current) {
        return { success: false, error: 'OPERATION_PENDING' };
      }
      submittingRef.current = true;
      setIsSubmitting(true);
      try {
        return await run();
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    []
  );

  const executeTrade = useCallback(
    (asset: CryptoAsset, side: OrderSide, amount: number): Promise<TerminalActionResult> =>
      withSubmissionLock(async () => {
        if (!Number.isFinite(amount) || amount <= 0) {
          const message = 'REJECTED: order amount must be greater than zero.';
          pushNotice('WARN', message);
          return { success: false, error: 'INVALID_AMOUNT' };
        }

        const result = await runTransaction((prev) => {
          const outcome = executeMarketOrder(prev, asset, side, amount);
          return {
            updatedSchema: outcome.success ? outcome.updatedSchema : prev,
            value: {
              success: outcome.success,
              error: outcome.error,
              // Captured inside the updater, where `prev` is the schema this
              // order was actually judged against. Reading `schema` from this
              // closure would report the cash and position of a render that
              // may predate a limit fill landing on the same tick.
              remedyContext: {
                symbol: asset.symbol,
                cash: prev.cashBalance,
                position: prev.holdings[asset.symbol]?.amount ?? 0,
                markPrice: asset.currentPrice,
              },
            },
          };
        });

        if (result.success) {
          pushNotice(
            'EXEC',
            `FILLED ${side} ${formatQuantity(amount)} ${asset.symbol} @ MARKET. Cash and holdings are now marked.`
          );
        } else {
          // The engine's code is for the tests and the log archive; the notice
          // bar is read by a person mid-trade, so it gets the sentence.
          pushNotice(
            'WARN',
            `REJECTED ${side} ${formatQuantity(amount)} ${asset.symbol}. ${describeExecutionError(result.error, result.remedyContext)}`
          );
        }
        return { success: result.success, error: result.error };
      }),
    [runTransaction, withSubmissionLock, pushNotice]
  );

  const submitLimitOrder = useCallback(
    (asset: CryptoAsset, side: OrderSide, amount: number, price: number): Promise<TerminalActionResult> =>
      withSubmissionLock(async () => {
        if (!Number.isFinite(amount) || amount <= 0) {
          pushNotice('WARN', 'REJECTED: order amount must be greater than zero.');
          return { success: false, error: 'INVALID_AMOUNT' };
        }

        const result = await runTransaction((prev) => {
          const outcome = placeLimitOrder(prev, asset, side, amount, price);
          return {
            updatedSchema: outcome.success ? outcome.updatedSchema : prev,
            value: {
              success: outcome.success,
              error: outcome.error,
              // Same rule as the market path: the remedy must quote the state
              // the order was validated against, not the render it was issued
              // from — a resting order may have filled in between.
              remedyContext: {
                symbol: asset.symbol,
                cash: prev.cashBalance,
                position: prev.holdings[asset.symbol]?.amount ?? 0,
                markPrice: asset.currentPrice,
              },
            },
          };
        });

        if (result.success) {
          pushNotice(
            'INFO',
            `WORKING ${side} ${formatQuantity(amount)} ${asset.symbol} @ ${formatCurrency(price)}. Awaiting fill.`
          );
        } else {
          pushNotice(
            'WARN',
            `REJECTED ${side} ${formatQuantity(amount)} ${asset.symbol}. ${describeExecutionError(result.error, result.remedyContext)}`
          );
        }
        return { success: result.success, error: result.error };
      }),
    [runTransaction, withSubmissionLock, pushNotice]
  );

  const cancelOrderById = useCallback(
    (orderId: string): Promise<TerminalActionResult> =>
      withSubmissionLock(async () => {
        const result = await runTransaction((prev) => {
          const outcome = cancelOrder(prev, orderId);
          return {
            updatedSchema: outcome.success ? outcome.updatedSchema : prev,
            value: { success: outcome.success, error: outcome.error },
          };
        });

        if (result.success) {
          pushNotice('INFO', `CANCELLED order ${formatCompactId(orderId)}.`);
        } else {
          pushNotice(
            'WARN',
            `CANCEL FAILED for ${formatCompactId(orderId)}. ${describeExecutionError(result.error)}`
          );
        }
        return result;
      }),
    [runTransaction, withSubmissionLock, pushNotice]
  );

  const selectedAsset = useMemo(() => assets[selectedSymbol] ?? null, [assets, selectedSymbol]);

  const livePortfolio = useMemo(() => deriveLiveValuation(schema, assets), [schema, assets]);

  const riskMetrics = useMemo(
    () => aggregateRiskMetrics(schema, livePortfolio),
    [schema, livePortfolio]
  );

  const handleReset = useCallback(() => {
    resetPortfolio();
    setSelectedSymbol('BTC');
    setNotice({
      id: `NOTICE-RESET-${Date.now()}`,
      level: 'INFO',
      message: 'PAPER LEDGER WIPED. Seeded with the starting allocation.',
      createdAt: new Date().toISOString(),
    });
  }, [resetPortfolio]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  // Ticket side and focus nonce, owned here so the global B/S shortcuts in
  // `App.tsx` can drive the ticket without prop-drilling through the layout.
  const [orderSide, setOrderSide] = useState<OrderSide>('BUY');
  const [ticketFocusNonce, setTicketFocusNonce] = useState<number>(0);
  const focusTicket = useCallback(() => setTicketFocusNonce((n) => n + 1), []);

  const contextValue = useMemo<TerminalContextValue>(
    () => ({
      schema,
      assets,
      livePortfolio,
      riskMetrics,
      selectedSymbol,
      selectedAsset,
      setSelectedSymbol,
      orderSide,
      setOrderSide,
      ticketFocusNonce,
      focusTicket,
      isSubmitting,
      executeTrade,
      submitLimitOrder,
      cancelOrderById,
      resetPortfolio: handleReset,
      notice,
      dismissNotice,
      storageError,
    }),
    [
      schema,
      assets,
      livePortfolio,
      riskMetrics,
      selectedSymbol,
      selectedAsset,
      orderSide,
      ticketFocusNonce,
      focusTicket,
      isSubmitting,
      executeTrade,
      submitLimitOrder,
      cancelOrderById,
      handleReset,
      notice,
      dismissNotice,
      storageError,
    ]
  );

  return <TerminalContext.Provider value={contextValue}>{children}</TerminalContext.Provider>;
};

export function useTerminal(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}

export default TerminalProvider;
