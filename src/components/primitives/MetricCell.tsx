import React, { ReactNode } from 'react';

import { formatPercent } from '../../utils/formatters';

export type MetricTone = 'neutral' | 'amber' | 'cyan' | 'emerald' | 'rose' | 'muted';

export interface MetricCellProps {
  /** Micro-label above the value, uppercase and tracked out. */
  label: string;
  /** Pre-formatted primary value. Formatting stays in utils/formatters. */
  value: ReactNode;
  /** Optional secondary line under the value. */
  secondary?: ReactNode;
  /** Signed micro-change, e.g. "+2.45%". Colours itself from its sign. */
  delta?: number;
  /** Pre-coloured micro-change; overrides the sign colouring. */
  deltaLabel?: string;
  tone?: MetricTone;
  /** Stacks label above value (default) or lays them out on one row. */
  layout?: 'stack' | 'row';
  className?: string;
}

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: 'text-neutral-100',
  amber: 'text-amber-500',
  cyan: 'text-cyan-500',
  emerald: 'text-emerald-500',
  rose: 'text-rose-500',
  muted: 'text-neutral-400',
};

const TONE_LABEL: Record<MetricTone, string> = {
  neutral: 'text-neutral-500',
  amber: 'text-amber-500/80',
  cyan: 'text-cyan-500/80',
  emerald: 'text-emerald-500/80',
  rose: 'text-rose-500/80',
  muted: 'text-neutral-600',
};

const MetricCellImpl: React.FC<MetricCellProps> = ({
  label,
  value,
  secondary,
  delta,
  deltaLabel,
  tone = 'neutral',
  layout = 'stack',
  className = '',
}) => {
  // Same formatter family as the rest of the terminal, so a delta here is
  // grouped, sign-prefixed and non-finite-safe exactly like a price column.
  const deltaText = deltaLabel ?? (typeof delta === 'number' ? formatPercent(delta, 2, { signed: true }) : undefined);
  const deltaClass =
    typeof delta === 'number' ? (delta > 0 ? 'text-emerald-500' : delta < 0 ? 'text-rose-500' : 'text-neutral-500') : '';

  return (
    <div
      className={`flex min-w-0 flex-col justify-center gap-0.5 border-l-2 border-[#262c36] pl-2 ${
        layout === 'row' ? 'flex-row items-center justify-between gap-2' : ''
      } ${className}`}
    >
      <span className={`truncate text-[9px] font-bold uppercase leading-tight tracking-[0.14em] ${TONE_LABEL[tone]}`}>
        {label}
      </span>

      <span className={`truncate text-sm font-bold leading-tight tabular-nums ${TONE_TEXT[tone]}`}>{value}</span>

      {secondary || deltaText ? (
        <span className="flex min-w-0 items-baseline gap-1.5 text-[10px] leading-tight">
          {/* `tabular-nums` because the secondary line carries counts — "12
              executions", "3W / 1L" — whose digits must not jitter per tick. */}
          {secondary ? <span className="truncate text-neutral-500 tabular-nums">{secondary}</span> : null}
          {deltaText ? <span className={`shrink-0 font-bold tabular-nums ${deltaClass}`}>{deltaText}</span> : null}
        </span>
      ) : null}
    </div>
  );
};

// Memoised for the same reason as TerminalBadge: these are leaf cells whose
// props are all primitives or pre-formatted strings, so a shallow compare never
// hides a changed value.
export const MetricCell = React.memo(MetricCellImpl);

export default MetricCell;
