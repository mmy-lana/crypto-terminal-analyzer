import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useTerminal } from '../../context/TerminalContext';
import { useOrderBook, ORDER_BOOK_REFRESH_MS } from '../../hooks/useOrderBook';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { formatCurrency, formatQuantity } from '../../utils/formatters';
import { DepthVisualizer } from '../compound/DepthVisualizer';
import { OrderBookWidget } from '../compound/OrderBookWidget';
import { TerminalBadge } from '../primitives/TerminalBadge';

export interface OrderBookContainerProps {
  /** Overrides the instrument; defaults to the globally selected symbol. */
  symbol?: string;
  className?: string;
}

/**
 * L2 depth workspace: feed telemetry, the cumulative-depth curve and the ladder.
 *
 * The feed itself is synthetic and driven by `useOrderBook`, which re-quotes on
 * its own slower cadence than the price tick. Telemetry is shown rather than
 * hidden so the operator can tell a frozen feed from a thin one — a stale book
 * is badged instead of silently displayed.
 */
export const OrderBookContainer: React.FC<OrderBookContainerProps> = ({ symbol, className = '' }) => {
  const { selectedSymbol, assets } = useTerminal();
  const { book, stale, ageMs } = useOrderBook(symbol);
  const isMobile = useIsMobile();

  const markPrice = assets[symbol ?? selectedSymbol]?.currentPrice ?? 0;

  const topBid = book.bids[0];
  const topAsk = book.asks[0];
  const bidDepth = book.bids.length > 0 ? (book.bids[book.bids.length - 1]?.total ?? 0) : 0;
  const askDepth = book.asks.length > 0 ? (book.asks[book.asks.length - 1]?.total ?? 0) : 0;
  const imbalance = bidDepth + askDepth > 0 ? (bidDepth / (bidDepth + askDepth)) * 100 : 50;

  const spreadTone = useMemo(() => {
    if (book.spreadPercent > 0.5) return 'warn' as const;
    if (book.spreadPercent < 0.1) return 'info' as const;
    return 'neutral' as const;
  }, [book.spreadPercent]);

  // A stalled feed is a real event, so the LIVE/LAG *transition* is announced —
  // once, politely, and only after the region is already in the tree. The
  // per-tick telemetry below (age, last, best bid, best ask) is deliberately
  // left out of any live region: it changes every refresh, and announcing each
  // refresh would bury every other message the terminal produces.
  const feedSymbol = symbol ?? selectedSymbol;
  const [feedAnnouncement, setFeedAnnouncement] = useState('');
  const staleRef = useRef(stale);

  useEffect(() => {
    if (staleRef.current === stale) return;
    staleRef.current = stale;
    setFeedAnnouncement(
      stale
        ? `Order book feed for ${feedSymbol} has stalled: quotes are no longer updating.`
        : `Order book feed for ${feedSymbol} is live again.`
    );
  }, [stale, feedSymbol]);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#262c36] bg-[#0d1014] px-2 py-1">
        <TerminalBadge tone={stale ? 'warn' : 'filled'} dot>
          {stale ? 'FEED LAG' : 'FEED LIVE'}
        </TerminalBadge>
        <span role="status" aria-live="polite" className="sr-only">
          {feedAnnouncement}
        </span>
        <TerminalBadge tone={spreadTone}>
          SPRD {book.spreadPercent.toFixed(3)}%
        </TerminalBadge>
        <TerminalBadge tone="muted">{isMobile ? '5 LVL' : `${Math.min(12, book.bids.length)} LVL`}</TerminalBadge>
        <span className="ml-auto text-[9px] tabular-nums text-neutral-600">
          {Math.max(0, Math.round(ageMs))}ms / {ORDER_BOOK_REFRESH_MS}ms
        </span>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-px border-b border-[#262c36] bg-[#262c36] text-center">
        <div className="bg-[#0a0b0d] px-1 py-1">
          <p className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">Last</p>
          <p className="text-[13px] font-bold tabular-nums text-amber-500">{formatCurrency(book.lastPrice)}</p>
        </div>
        <div className="bg-[#0a0b0d] px-1 py-1">
          <p className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">Best bid</p>
          <p className="text-[12px] font-bold tabular-nums text-emerald-500">
            {topBid === undefined ? '--' : formatCurrency(topBid.price)}
          </p>
        </div>
        <div className="bg-[#0a0b0d] px-1 py-1">
          <p className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">Best ask</p>
          <p className="text-[12px] font-bold tabular-nums text-rose-500">
            {topAsk === undefined ? '--' : formatCurrency(topAsk.price)}
          </p>
        </div>
      </div>

      <div className="shrink-0 border-b border-[#262c36] px-1 py-1.5">
        <div className="flex items-center justify-between px-1 pb-0.5">
          <span className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">Cumulative depth</span>
          <span className="text-[9px] tabular-nums text-neutral-600">
            B {imbalance.toFixed(0)}% / A {(100 - imbalance).toFixed(0)}%
          </span>
        </div>
        <DepthVisualizer book={book} height={isMobile ? 80 : 110} midPrice={markPrice > 0 ? markPrice : undefined} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <OrderBookWidget
          book={book}
          depth={12}
          highlightPrice={book.lastPrice}
          className="p-1"
        />
      </div>

      <div className="shrink-0 border-t border-[#262c36] px-2 py-1 text-[9px] tabular-nums text-neutral-600">
        Bid depth {formatQuantity(bidDepth)} · Ask depth {formatQuantity(askDepth)} · Simulated synthetic feed
      </div>
    </div>
  );
};

export default OrderBookContainer;
