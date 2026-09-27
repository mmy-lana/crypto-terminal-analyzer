import React, { ReactNode } from 'react';

export type TerminalPanelTone = 'default' | 'amber' | 'cyan' | 'emerald' | 'rose';

export interface TerminalPanelProps {
  /** Command-bar title, e.g. "ORDER BOOK // L2 DEPTH". */
  title: string;
  /** Optional right-aligned header content (badges, shortcuts, counters). */
  headerMeta?: ReactNode;
  /** Hotkey hint rendered in the top-right corner bracket, e.g. "[B]". */
  hotkey?: string;
  /** Header accent colour. */
  tone?: TerminalPanelTone;
  /** Removes the body padding for grids that own their own spacing. */
  flush?: boolean;
  /** Renders the three status dots in the header. */
  statusDots?: boolean;
  /** Extra class on the outer frame. */
  className?: string;
  /** Constrains the body height; the body scrolls internally. */
  bodyClassName?: string;
  children: ReactNode;
}

const TONE_STYLES: Record<TerminalPanelTone, { title: string; dot: string }> = {
  default: { title: 'text-amber-500', dot: 'bg-neutral-600' },
  amber: { title: 'text-amber-500', dot: 'bg-amber-500' },
  cyan: { title: 'text-cyan-500', dot: 'bg-cyan-500' },
  emerald: { title: 'text-emerald-500', dot: 'bg-emerald-500' },
  rose: { title: 'text-rose-500', dot: 'bg-rose-500' },
};

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  title,
  headerMeta,
  hotkey,
  tone = 'default',
  flush = false,
  statusDots = true,
  className = '',
  bodyClassName = '',
  children,
}) => {
  const toneStyle = TONE_STYLES[tone];

  return (
    <section className={`flex min-w-0 flex-col border border-[#262c36] bg-[#12151a] ${className}`}>
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[#262c36] bg-[#181c24] px-2">
        <div className="flex min-w-0 items-center gap-2">
          {statusDots ? (
            <span aria-hidden="true" className="hidden shrink-0 items-center gap-1 sm:flex">
              <span className={`h-2 w-2 rounded-full ${toneStyle.dot}`} />
              <span className="h-2 w-2 rounded-full bg-[#3a2f14]" />
              <span className="h-2 w-2 rounded-full bg-[#262c36]" />
            </span>
          ) : null}
          {/* Balanced rather than truncated: a caller title like
              "MARKET WATCH // SPOT" clips mid-word under `truncate`, while
              `text-balance` keeps the two lines even inside the h-8 header. */}
          <h2 className={`text-balance text-[10px] font-bold uppercase leading-tight tracking-[0.12em] ${toneStyle.title}`}>
            {title}
          </h2>
        </div>

        {/* `min-w-0` all the way down the right-hand group: without it a long
            status badge sets the header's min-content width and pushes the
            panel wider than its column. The hotkey stays `shrink-0`. */}
        <div className="flex min-w-0 items-center gap-2">
          {headerMeta ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-neutral-400">{headerMeta}</div>
          ) : null}
          {hotkey ? (
            <kbd
              className="shrink-0 rounded-sm border border-[#262c36] bg-[#0a0b0d] px-1 py-px font-mono text-[9px] font-bold text-neutral-400"
              aria-hidden="true"
            >
              {hotkey}
            </kbd>
          ) : null}
        </div>
      </header>

      <div className={`min-h-0 flex-1 ${flush ? '' : 'p-2'} ${bodyClassName}`}>{children}</div>
    </section>
  );
};

export default TerminalPanel;
