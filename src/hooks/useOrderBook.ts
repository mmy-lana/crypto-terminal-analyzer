import { useEffect, useMemo, useState } from 'react';

import { OrderBookState } from '../types/terminal';
import { ORDER_BOOK_DEPTH, generateOrderBook, hashSymbolToSeed } from '../services/marketFeed';
import { useTerminal } from '../context/TerminalContext';

/** Book refresh cadence, independent of the quote tick. */
export const ORDER_BOOK_REFRESH_MS = 1200;

/** A book is flagged stale if its underlying quote is older than this window. */
export const ORDER_BOOK_STALE_MS = 15_000;

export interface OrderBookFeed {
  book: OrderBookState;
  /** True when the last quote for this symbol is older than the stale window. */
  stale: boolean;
  /** Milliseconds since the book was last rebuilt. */
  ageMs: number;
}

/**
 * Simulated L2 book for one instrument.
 *
 * The ladder is rebuilt on its own slower interval against the *current* live
 * price, so depth visibly re-quotes while the symbol stays selected. Every
 * rebuild is a pure function of (symbol, price, refresh index), which means the
 * first paint is synchronous and there is never an empty frame on mount.
 */
export function useOrderBook(symbolOverride?: string, depth: number = ORDER_BOOK_DEPTH): OrderBookFeed {
  const { assets, selectedSymbol } = useTerminal();
  const symbol = symbolOverride && symbolOverride.length > 0 ? symbolOverride : selectedSymbol;

  const price = assets[symbol]?.currentPrice ?? 0;
  const updatedAt = assets[symbol]?.lastUpdated ?? null;

  const [refreshIndex, setRefreshIndex] = useState(0);
  const [builtAt, setBuiltAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  // A symbol switch must not inherit the previous instrument's ladder.
  useEffect(() => {
    setRefreshIndex(0);
    setBuiltAt(Date.now());
  }, [symbol]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRefreshIndex((prev) => prev + 1);
      setBuiltAt(Date.now());
    }, ORDER_BOOK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const book = useMemo(
    () => generateOrderBook(symbol, price, depth, hashSymbolToSeed(symbol) + refreshIndex),
    [symbol, price, depth, refreshIndex]
  );

  // A stale badge has to be able to clear on its own, so while it is showing
  // a coarse heartbeat keeps re-rendering the panel.
  const quoteAgeMs = updatedAt === null ? Number.POSITIVE_INFINITY : now - new Date(updatedAt).getTime();
  const stale = quoteAgeMs > ORDER_BOOK_STALE_MS;

  useEffect(() => {
    if (!stale) {
      setNow(Date.now());
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [stale, updatedAt]);

  return { book, stale, ageMs: now - builtAt };
}

export default useOrderBook;
