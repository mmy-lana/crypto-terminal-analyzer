import React from 'react';

import { OrderSide, OrderStatus, OrderType } from '../../types/terminal';

export type TerminalBadgeTone = 'buy' | 'sell' | 'neutral' | 'pending' | 'info' | 'warn' | 'muted' | 'filled' | 'cancelled' | 'rejected';

export interface TerminalBadgeProps {
  children: React.ReactNode;
  tone?: TerminalBadgeTone;
  /** Renders a leading status dot. */
  dot?: boolean;
  /** Fades the badge for secondary/disabled rows. */
  muted?: boolean;
  className?: string;
  title?: string;
}

const TONE_STYLES: Record<TerminalBadgeTone, string> = {
  buy: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-500',
  sell: 'border-rose-500/50 bg-rose-500/10 text-rose-500',
  neutral: 'border-neutral-600 bg-[#181c24] text-neutral-300',
  pending: 'border-amber-500/50 bg-amber-500/10 text-amber-500',
  info: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-500',
  warn: 'border-amber-500/50 bg-amber-500/10 text-amber-500',
  muted: 'border-[#262c36] bg-[#0a0b0d] text-neutral-500',
  filled: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-500',
  cancelled: 'border-[#262c36] bg-[#0a0b0d] text-neutral-500 line-through',
  rejected: 'border-rose-500/50 bg-rose-500/10 text-rose-500',
};

const DOT_STYLES: Record<TerminalBadgeTone, string> = {
  buy: 'bg-emerald-500',
  sell: 'bg-rose-500',
  neutral: 'bg-neutral-500',
  pending: 'bg-amber-500',
  info: 'bg-cyan-500',
  warn: 'bg-amber-500',
  muted: 'bg-neutral-600',
  filled: 'bg-emerald-500',
  cancelled: 'bg-neutral-600',
  rejected: 'bg-rose-500',
};

/**
 * Badge shell.
 *
 * The cap plus the inner truncation span matter: `whitespace-nowrap` alone lets
 * a long value — the feed-age badge, a long order status — push its row wider
 * than the panel, and `text-overflow` does not reach the anonymous flex item
 * that an `inline-flex` wraps bare text in, so the text needs its own box.
 */
const TerminalBadgeImpl: React.FC<TerminalBadgeProps> = ({
  children,
  tone = 'neutral',
  dot = false,
  muted = false,
  className = '',
  title,
}) => (
  <span
    title={title}
    className={`inline-flex max-w-[120px] shrink-0 items-center gap-1 truncate border px-1.5 py-px text-[9px] font-bold uppercase leading-[14px] tracking-[0.1em] ${
      TONE_STYLES[tone]
    } ${muted ? 'opacity-50' : ''} ${className}`}
  >
    {dot ? (
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_STYLES[tone]}`} />
    ) : null}
    <span className="min-w-0 truncate">{children}</span>
  </span>
);

// Memoised because badges sit in the hottest rows in the terminal — a 200-line
// log and every ledger row — and none of them read context, so a shallow prop
// compare is a sound bail-out for the 1s tick.
export const TerminalBadge = React.memo(TerminalBadgeImpl);

const SIDE_TONES: Record<OrderSide, TerminalBadgeTone> = { BUY: 'buy', SELL: 'sell' };
const TYPE_TONES: Record<OrderType, TerminalBadgeTone> = { MARKET: 'info', LIMIT: 'pending' };
const STATUS_TONES: Record<OrderStatus, TerminalBadgeTone> = {
  FILLED: 'filled',
  PENDING: 'pending',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
};

const SideBadgeImpl: React.FC<{ side: OrderSide; className?: string }> = ({ side, className }) => (
  <TerminalBadge tone={SIDE_TONES[side]} dot className={className}>
    {side}
  </TerminalBadge>
);

const OrderTypeBadgeImpl: React.FC<{ type: OrderType; className?: string }> = ({ type, className }) => (
  <TerminalBadge tone={TYPE_TONES[type]} className={className}>
    {type}
  </TerminalBadge>
);

const OrderStatusBadgeImpl: React.FC<{ status: OrderStatus; className?: string }> = ({ status, className }) => (
  <TerminalBadge tone={STATUS_TONES[status]} dot className={className}>
    {status}
  </TerminalBadge>
);

// The three wrappers are memoised for the same reason as the shell: a ledger or
// open-order row passes only a string enum, so the row bails out before the
// badge is compared at all.
export const SideBadge = React.memo(SideBadgeImpl);
/** Order type badge — MARKET vs LIMIT. */
export const OrderTypeBadge = React.memo(OrderTypeBadgeImpl);
/** Order status badge, including the struck-through cancelled state. */
export const OrderStatusBadge = React.memo(OrderStatusBadgeImpl);

export default TerminalBadge;
