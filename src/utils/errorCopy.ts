import { TAKER_FEE_RATE, type ExecutionErrorCode } from './engine';
import { formatCurrency, formatQuantity } from './formatters';

/**
 * The single home for operator-facing copy about a rejected order.
 *
 * The engine returns stable codes because those are what the tests assert on
 * and what the log feed archives, but `INSUFFICIENT_ASSET_BALANCE` means
 * nothing to someone mid-trade. Every entry here therefore names the cause AND
 * the next step, with the concrete figure that makes the order fail — "reduce
 * to 0.42 BTC" beats "reduce the amount".
 *
 * Both the order ticket and the notice bar read from this map, so a rejection
 * cannot read one way in the form and another way in the toast above it.
 */

/** What a rejection needs in hand before it can name a remedy. */
export interface RemedyContext {
  /** Instrument being traded, e.g. `BTC`. */
  symbol: string;
  /** Free cash in the paper account. */
  cash: number;
  /** Size of the position currently held in `symbol`. */
  position: number;
  /** Live mark for `symbol`; zero when no instrument is selected. */
  markPrice: number;
}

/**
 * Codes beyond the engine's own: the context layer raises these when it refuses
 * a submission before the engine is ever reached.
 */
export type TerminalRejectionCode = ExecutionErrorCode | 'OPERATION_PENDING' | 'NO_ASSET' | 'UNKNOWN_SYMBOL';

/** A context that produces correct, if generic, sentences. */
const UNKNOWN_CONTEXT: RemedyContext = { symbol: 'the asset', cash: 0, position: 0, markPrice: 0 };

const ERROR_COPY: Record<TerminalRejectionCode, (context: RemedyContext) => string> = {
  INSUFFICIENT_FUNDS: ({ cash, symbol, markPrice }) => {
    // The largest size cash plus taker commission can actually cover.
    const affordable = markPrice > 0 ? cash / (markPrice * (1 + TAKER_FEE_RATE)) : 0;
    return affordable > 0
      ? `Insufficient cash: ${formatCurrency(cash)} will not cover notional plus commission. Reduce the amount to ${formatQuantity(affordable)} ${symbol} or less.`
      : `Insufficient cash: ${formatCurrency(cash)} cannot buy any size. Sell a position or reset the paper ledger.`;
  },
  INSUFFICIENT_ASSET_BALANCE: ({ position, symbol }) =>
    `Position is smaller than the requested size: you hold ${formatQuantity(position)} ${symbol}. Sell at most ${formatQuantity(position)} ${symbol}.`,
  INVALID_AMOUNT: ({ symbol }) =>
    `Amount must be greater than zero. Enter a size such as ${formatQuantity(0.5)} ${symbol}.`,
  INVALID_PRICE: ({ markPrice }) =>
    markPrice > 0
      ? `Limit price must be greater than zero. Enter a price such as ${formatCurrency(markPrice)}.`
      : 'Limit price must be greater than zero. Enter a price in dollars per unit.',
  ORDER_NOT_FOUND: () =>
    'That order no longer exists — it filled or was cancelled while you worked. Check the ledger, then re-enter it if it did not fill.',
  ORDER_NOT_CANCELABLE: () =>
    'That order is no longer working — it already filled or was cancelled. Check the ledger before ordering again.',
  OPERATION_PENDING: () =>
    'An order is already being processed. Wait for the confirmation, then submit once.',
  INVALID_SYMBOL: ({ symbol }) =>
    `That instrument is not in the terminal universe. ${symbol} cannot be traded — pick one from the watchlist.`,
  UNKNOWN_SYMBOL: ({ symbol }) =>
    `${symbol} is not in the terminal universe. Pick one from the watchlist before ordering.`,
  NO_ASSET: () =>
    'No instrument is selected. Pick a symbol from the watchlist to arm the ticket.',
};

/** Human sentence for a rejection code. Never returns a bare enum name. */
export function describeExecutionError(
  code: TerminalRejectionCode | undefined,
  context?: Partial<RemedyContext>
): string {
  if (code === undefined) {
    return 'The order was rejected for an unknown reason. Check the system log for the full record.';
  }

  const render = ERROR_COPY[code];
  if (render === undefined) {
    // A code this module does not know about must still read as English rather
    // than leak its identifier into the notice bar.
    return `The order was rejected (${code.toLowerCase().replace(/_/g, ' ')}). Check the system log for the full record.`;
  }

  const resolved: RemedyContext = {
    symbol: context?.symbol ?? UNKNOWN_CONTEXT.symbol,
    cash: context?.cash ?? UNKNOWN_CONTEXT.cash,
    position: context?.position ?? UNKNOWN_CONTEXT.position,
    markPrice: context?.markPrice ?? UNKNOWN_CONTEXT.markPrice,
  };

  return render(resolved);
}

export default describeExecutionError;
