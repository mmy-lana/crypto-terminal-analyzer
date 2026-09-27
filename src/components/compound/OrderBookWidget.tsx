import React from 'react';

import { OrderBookState } from '../../types/terminal';
import { formatCurrency, formatPercent, formatQuantity } from '../../utils/formatters';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { TabularCell, TabularGrid, TabularRow, TabularTable } from '../primitives/TabularGrid';

export interface OrderBookWidgetProps {
  book: OrderBookState;
  /** Rows per side on desktop. Mobile is always capped at 5 by the layout. */
  depth?: number;
  /** Marks levels at/through this price as actionable. */
  highlightPrice?: number;
  className?: string;
}

const LADDER_COLUMNS = 'minmax(70px, 1fr) minmax(70px, 1fr) minmax(70px, 1fr)';

/** Which side of the book a ladder renders. */
type LadderSide = 'bid' | 'ask';

interface LadderProps {
  book: OrderBookState;
  depth: number;
  highlightPrice?: number;
  side: LadderSide;
  maxCumulative: number;
}

const Ladder: React.FC<LadderProps> = ({ book, depth, highlightPrice, side, maxCumulative }) => {
  const entries = (side === 'bid' ? book.bids : book.asks).slice(0, depth);
  const isBid = side === 'bid';

  if (entries.length === 0) {
    return (
      <div
        className={`flex h-[34px] items-center justify-center text-[10px] uppercase tracking-[0.12em] text-neutral-600 ${isBid ? '' : 'border-b border-[#262c36]'}`}
      >
        No {side} liquidity
      </div>
    );
  }

  // Every cell of a row paints the same proportional bar, so the three
  // gradients line up into one continuous depth band without needing an
  // absolutely positioned overlay per row.
  const barStyle = (entry: { total: number }, actionable: boolean): React.CSSProperties => {
    const fill = maxCumulative > 0 ? Math.min(100, (entry.total / maxCumulative) * 100) : 0;
    const tint = isBid ? '16, 185, 129' : '244, 63, 94';
    return {
      backgroundImage: `linear-gradient(to ${isBid ? 'left' : 'right'}, rgba(${tint}, ${
        actionable ? 0.32 : 0.18
      }) ${fill}%, transparent ${fill}%)`,
    };
  };

  return (
    <TabularGrid role="rowgroup" columns={LADDER_COLUMNS}>
      {entries.map((entry, index) => {
        const actionable =
          typeof highlightPrice === 'number' &&
          highlightPrice > 0 &&
          (isBid ? highlightPrice <= entry.price : highlightPrice >= entry.price);
        const striped = index % 2 === 1;
        const cellStyle = barStyle(entry, actionable);

        return (
          <TabularRow key={`${side}-${entry.price}-${index}`}>
            <TabularCell align="left" striped={striped} className="!px-2">
              <span
                style={cellStyle}
                className={`font-bold tabular-nums ${
                  actionable ? 'text-white' : isBid ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                {formatCurrency(entry.price)}
              </span>
            </TabularCell>

            <TabularCell align="right" striped={striped} className="!px-2">
              <span style={cellStyle} className="tabular-nums text-neutral-400">
                {formatQuantity(entry.size)}
              </span>
            </TabularCell>

            <TabularCell align="right" striped={striped} className="!px-2">
              <span className="tabular-nums text-neutral-600">{formatQuantity(entry.total)}</span>
            </TabularCell>
          </TabularRow>
        );
      })}
    </TabularGrid>
  );
};

/**
 * Simulated L2 depth ladder.
 *
 * Asks render above, bids below, with the spread pinned between them. Under
 * 768px the ladder drops to five levels per side (plan §5) — the prop is a
 * desktop hint, the mobile ceiling is a hard cap so no caller can overflow a
 * phone viewport.
 */
export const OrderBookWidget: React.FC<OrderBookWidgetProps> = ({
  book,
  depth = 10,
  highlightPrice,
  className = '',
}) => {
  const isMobile = useIsMobile();
  const effectiveDepth = isMobile ? Math.min(5, Math.max(1, depth)) : Math.max(1, depth);

  const maxCumulative = Math.max(
    book.bids[book.bids.length - 1]?.total ?? 0,
    book.asks[book.asks.length - 1]?.total ?? 0
  );

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <TabularTable label="Ask depth ladder" className="min-h-0 flex-1">
        <LadderHeader side="ask" />
        <Ladder book={book} depth={effectiveDepth} highlightPrice={highlightPrice} side="ask" maxCumulative={maxCumulative} />
      </TabularTable>

      <div className="my-1 flex shrink-0 items-center justify-between border-y border-[#262c36] bg-[#181c24] px-2 py-1 text-[11px]">
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-500">Spread</span>
        <span className={`font-bold tabular-nums ${book.spreadPercent > 0.5 ? 'text-amber-500' : 'text-neutral-400'}`}>
          {formatCurrency(book.spread)}
        </span>
        <span className="tabular-nums text-neutral-500">{formatPercent(book.spreadPercent, 3)}</span>
      </div>

      <TabularTable label="Bid depth ladder" className="min-h-0 flex-1">
        <LadderHeader side="bid" />
        <Ladder book={book} depth={effectiveDepth} highlightPrice={highlightPrice} side="bid" maxCumulative={maxCumulative} />
      </TabularTable>
    </div>
  );
};

/**
 * Column captions, repeated for each side so every table row group is complete.
 * The price column is named for the side it heads — the ask ladder used to
 * announce "Bid" above its own prices.
 */
const LadderHeader: React.FC<{ side: LadderSide }> = ({ side }) => (
  <TabularGrid columns={LADDER_COLUMNS}>
    <TabularCell header>{side === 'bid' ? 'Bid' : 'Ask'}</TabularCell>
    <TabularCell header align="right">
      Size
    </TabularCell>
    <TabularCell header align="right">
      Total
    </TabularCell>
  </TabularGrid>
);

export default OrderBookWidget;
