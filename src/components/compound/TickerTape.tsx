import React, { useMemo } from 'react';

import { CryptoAsset } from '../../types/terminal';
import { formatCompactNumber, formatCurrency, formatPercent } from '../../utils/formatters';

export interface TickerTapeProps {
  assets: Record<string, CryptoAsset>;
  /** Symbols in watchlist order; anything missing is appended. */
  watchlist: string[];
  selectedSymbol?: string;
  onSelect?: (symbol: string) => void;
}

/**
 * Scrolling tape of live quotes.
 *
 * The track is rendered twice and translated by -50%, so the loop point lands
 * exactly on the seam and the marquee reads as continuous. Hover and
 * focus-within pause it, and `prefers-reduced-motion` disables the animation
 * entirely in CSS — the tape then degrades to a horizontally scrollable list.
 *
 * Each quote is a real tap target that selects that instrument, so the strip
 * carries the 44px minimum below `sm` and settles back to the dense 32px row
 * from `sm` up. The row and its container are sized together, so the taller
 * phone strip never clips under the reduced-motion scroll fallback either.
 *
 * Accessibility: the strip repaints every second, so it is deliberately *not* a
 * live region — announcing each repaint would flood the speech queue and the
 * operator would hear nothing but numbers. `role="marquee"` is a live-region
 * role whose implicit `aria-live="off"` made that silence look like an
 * oversight, so the role is replaced with a plain labelled group and
 * `aria-live="off"` is stated explicitly. The quotes stay reachable on demand
 * (each one is a real button) and a static one-line summary in front of the
 * strip gives orientation before the first tab stop. The strip is not
 * `aria-hidden`: it holds focusable buttons, and hiding them would strand
 * keyboard focus outside the accessibility tree.
 */
export const TickerTape: React.FC<TickerTapeProps> = ({ assets, watchlist, selectedSymbol, onSelect }) => {
  const ordered = useMemo(() => {
    const seen = new Set<string>();
    const list: CryptoAsset[] = [];
    for (const symbol of watchlist) {
      const asset = assets[symbol];
      if (asset && !seen.has(symbol)) {
        seen.add(symbol);
        list.push(asset);
      }
    }
    for (const asset of Object.values(assets)) {
      if (!seen.has(asset.symbol)) {
        seen.add(asset.symbol);
        list.push(asset);
      }
    }
    return list;
  }, [assets, watchlist]);

  // Static one-liner for a strip that never stops moving — orientation for
  // anyone who would rather not walk six tab stops through live quotes.
  const summary = useMemo(
    () =>
      `Ticker tape: ${ordered.length} instrument${ordered.length === 1 ? '' : 's'} streaming, quotes refresh every second — ${ordered
        .map((asset) => asset.symbol)
        .join(', ')}.`,
    [ordered]
  );

  if (ordered.length === 0) {
    return (
      <div className="flex h-11 shrink-0 items-center border-b border-[#262c36] bg-[#0a0b0d] px-3 text-[10px] uppercase tracking-[0.14em] text-neutral-600 sm:h-8">
        No instruments streaming
      </div>
    );
  }

  const renderRun = (keyPrefix: string) =>
    ordered.map((asset) => {
      const up = asset.change24h >= 0;
      const isSelected = selectedSymbol === asset.symbol;

      return (
        <button
          key={`${keyPrefix}-${asset.symbol}`}
          type="button"
          onClick={() => onSelect?.(asset.symbol)}
          tabIndex={keyPrefix === 'a' ? 0 : -1}
          aria-hidden={keyPrefix === 'b' || undefined}
          // 44px tall on a phone, where a tap selects the instrument; the strip
          // is only dense from `sm` up, where the 32px row is deliberate.
          className={`flex h-8 min-h-[44px] shrink-0 items-center gap-2 border-r border-[#262c36] px-3 text-[11px] transition-colors sm:min-h-0 ${
            isSelected ? 'bg-amber-500/10' : 'hover:bg-[#181c24]'
          }`}
        >
          <span className={`font-bold tracking-[0.08em] ${isSelected ? 'text-amber-500' : 'text-cyan-500'}`}>
            {asset.symbol}
          </span>
          <span className="tabular-nums text-neutral-200">{formatCurrency(asset.currentPrice)}</span>
          <span className={`tabular-nums ${up ? 'text-emerald-500' : 'text-rose-500'}`}>
            {formatPercent(asset.change24h, 2, { signed: true })}
          </span>
          <span className="hidden text-[10px] text-neutral-600 sm:inline">
            VOL {formatCompactNumber(asset.volume24h)}
          </span>
        </button>
      );
    });

  return (
    <>
      {/* Concise stand-in for the moving strip: orientation without a single
          live-region announcement. */}
      <span className="sr-only">{summary}</span>
      <div
        className="ticker-viewport h-11 shrink-0 border-b border-[#262c36] bg-[#0a0b0d] sm:h-8"
        role="group"
        aria-live="off"
        aria-label="Live ticker tape"
      >
        <div className="ticker-track h-11 sm:h-8">
          {renderRun('a')}
          {renderRun('b')}
        </div>
      </div>
    </>
  );
};

export default TickerTape;
