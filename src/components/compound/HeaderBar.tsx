import React, { useEffect, useState } from 'react';

import { formatCurrency, formatPercent, formatUtcClock } from '../../utils/formatters';
import { TerminalTab } from '../../types/terminal';

export interface HeaderBarProps {
  /** Live account equity in USD. */
  equity: number;
  /** Cash sitting uninvested. */
  cashBalance: number;
  /** Mark-to-market PnL on open positions. */
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  /** Active tab, used to highlight the matching shortcut cue. */
  activeTab?: TerminalTab;
  /** Emits the requested tab when a shortcut chip is pressed. */
  onTabShortcut?: (tab: TerminalTab) => void;
  /** Opens the command palette. */
  onOpenCommand?: () => void;
  /** Restarts the paper account. */
  onReset?: () => void;
}

const SHORTCUT_CUES: { key: string; tab: TerminalTab; label: string; hint: string }[] = [
  { key: '1', tab: 'MONITOR', label: 'MONITOR', hint: 'Market watch' },
  { key: '2', tab: 'TRADE', label: 'TRADE', hint: 'Order ticket' },
  { key: '3', tab: 'ANALYTICS', label: 'ANALYTICS', hint: 'Positions and risk' },
  { key: '4', tab: 'LEDGER', label: 'LEDGER', hint: 'Transaction history' },
];

/**
 * Global system header: UTC clock, connection heartbeat, paper equity and the
 * global shortcut map. The clock ticks locally once a second rather than
 * riding the market feed, so the timestamp stays honest even when quotes
 * pause.
 */
export const HeaderBar: React.FC<HeaderBarProps> = ({
  equity,
  cashBalance,
  unrealizedPnL,
  unrealizedPnLPercent,
  activeTab,
  onTabShortcut,
  onOpenCommand,
  onReset,
}) => {
  const [now, setNow] = useState<string>(() => new Date().toISOString());
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // A pending reset has to be confirmed inside 3s, then disarms itself so a
  // stray later click can never wipe the ledger.
  useEffect(() => {
    if (!resetArmed) return;
    const timer = window.setTimeout(() => setResetArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [resetArmed]);

  const pnlTone = unrealizedPnL > 0 ? 'text-emerald-500' : unrealizedPnL < 0 ? 'text-rose-500' : 'text-neutral-400';

  return (
    <header className="flex shrink-0 flex-col border-b border-[#262c36] bg-[#12151a]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2 py-1.5 sm:px-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* h1, not a span: every panel title is an h2, so without this the
              document outline opens at h2 and has no name for the page. m-0 and
              the explicit size restore the span's box exactly, so the badge
              still measures the same to the pixel. */}
          <h1 className="m-0 shrink-0 bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold tracking-[0.18em] text-black">
            BLOOMBERG // CRYPTO<span className="sr-only"> — paper trading terminal</span>
          </h1>
          <span className="hidden shrink-0 items-center gap-1.5 text-[10px] text-neutral-500 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse-slow rounded-full bg-emerald-500" aria-hidden="true" />
            FEED CONNECTED
          </span>
        </div>

        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-500">UTC</span>
            <time className="font-bold tabular-nums text-neutral-100" dateTime={now}>
              {formatUtcClock(now)}
            </time>
          </span>

          <span className="flex items-baseline gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-500">CASH</span>
            <span className="font-bold tabular-nums text-neutral-300">{formatCurrency(cashBalance)}</span>
          </span>

          <span className="flex items-baseline gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-500">EQUITY</span>
            <span className="font-bold tabular-nums text-neutral-100">{formatCurrency(equity)}</span>
          </span>

          <span className="flex items-baseline gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-500">PnL</span>
            <span className={`font-bold tabular-nums ${pnlTone}`}>
              {formatCurrency(unrealizedPnL)} ({formatPercent(unrealizedPnLPercent)})
            </span>
          </span>
        </div>
      </div>

      {/* py-0: the 44px touch target now supplies this strip's height, so the
          old 4px pad would only make the header taller without making the
          buttons any easier to hit. */}
      <div className="flex items-center gap-1.5 border-t border-[#262c36] px-2 py-0 sm:px-3">
        <nav aria-label="Terminal sections" className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {SHORTCUT_CUES.map((cue) => {
            const isActive = activeTab === cue.tab;
            // The text label is `hidden sm:inline`, so below the sm breakpoint
            // this button is nothing but the [n] glyph. Name it explicitly, or a
            // phone screen reader announces "1" instead of the destination.
            return (
              <button
                key={cue.key}
                type="button"
                onClick={() => onTabShortcut?.(cue.tab)}
                disabled={!onTabShortcut}
                aria-label={`${cue.label} — ${cue.hint}`}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-1.5 border px-2 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${
                  isActive
                    ? 'border-amber-500/70 bg-amber-500/15 text-amber-500'
                    : 'border-[#262c36] text-neutral-500 hover:bg-[#181c24] hover:text-neutral-300'
                } disabled:cursor-default disabled:hover:bg-transparent`}
              >
                <kbd className="rounded-sm bg-[#0a0b0d] px-1 text-[9px] text-amber-500/80">[{cue.key}]</kbd>
                <span className="hidden sm:inline">{cue.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          {onOpenCommand ? (
            <button
              type="button"
              onClick={onOpenCommand}
              aria-label="Command palette"
              className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 border border-[#262c36] px-2 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 transition-colors hover:bg-[#181c24] hover:text-neutral-200"
            >
              <kbd className="rounded-sm bg-[#0a0b0d] px-1 text-[9px] text-amber-500/80">[/]</kbd>
              <span className="hidden sm:inline">COMMAND</span>
            </button>
          ) : null}

          {onReset ? (
            <>
              {/* Arming the wipe is a word swap and a colour change, which report
                  themselves to nobody. The polite region spells out what the
                  second click costs before it is taken. */}
              <p className="sr-only" role="status" aria-live="polite">
                {resetArmed
                  ? 'Reset armed. Activate the confirm wipe button again to erase the paper ledger and every transaction.'
                  : ''}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (resetArmed) {
                    onReset();
                    setResetArmed(false);
                  } else {
                    setResetArmed(true);
                  }
                }}
                aria-label={
                  resetArmed
                    ? 'Confirm wipe — erases the paper ledger and every transaction'
                    : 'Reset paper account — press twice to confirm the wipe'
                }
                className={`min-h-[44px] min-w-[44px] border px-2 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${
                  resetArmed
                    ? 'border-rose-500 bg-rose-500/20 text-rose-500'
                    : 'border-[#262c36] text-neutral-500 hover:bg-[#181c24] hover:text-neutral-300'
                }`}
              >
                {resetArmed ? 'CONFIRM WIPE' : 'RESET'}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
};

export default HeaderBar;
