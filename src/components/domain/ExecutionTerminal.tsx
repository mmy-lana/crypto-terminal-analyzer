import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrderType, OrderRecord } from '../../types/terminal';
import { useTerminal } from '../../context/TerminalContext';
import {
  MAKER_FEE_RATE,
  SLIPPAGE_FACTOR,
  TAKER_FEE_RATE,
  availableCash,
  estimateOrder,
  getOpenOrders,
} from '../../utils/engine';
import { describeExecutionError, type RemedyContext } from '../../utils/errorCopy';
import { formatCurrency, formatPercent, formatQuantity } from '../../utils/formatters';
import { ActionButton } from '../primitives/ActionButton';
import { InfoTip } from '../primitives/InfoTip';
import { OrderStatusBadge, OrderTypeBadge, SideBadge, TerminalBadge } from '../primitives/TerminalBadge';
import { TerminalInput } from '../primitives/TerminalInput';

export interface ExecutionTerminalProps {
  className?: string;
}

const ALLOCATION_PRESETS = [25, 50, 75, 100] as const;

/** Which control a message belongs beside, or the ticket as a whole. */
type TicketField = 'amount' | 'price' | 'order';

interface TicketError {
  field: TicketField;
  message: string;
}

/** Field a rejection renders beside, so the message sits next to its control. */
const ERROR_FIELD: Record<string, TicketField> = {
  INSUFFICIENT_FUNDS: 'amount',
  INSUFFICIENT_ASSET_BALANCE: 'amount',
  INVALID_AMOUNT: 'amount',
  INVALID_PRICE: 'price',
};

/** The shape a number field accepts, spelled out where a refusal happens. */
const AMOUNT_FORMAT_COPY = 'Amount takes digits and at most one decimal point, e.g. 0.5.';
const PRICE_FORMAT_COPY = 'Limit price takes digits and at most one decimal point, e.g. 65000.';

/**
 * Order ticket.
 *
 * Previews every consequence of the order before it is sent — execution price
 * with slippage, commission, and the signed cash impact — so the operator can
 * see the effect of a market order on their balance before committing. The
 * percentage presets size against what is actually available: cash for a buy,
 * the live position for a sell.
 */
export const ExecutionTerminal: React.FC<ExecutionTerminalProps> = ({ className = '' }) => {
  const {
    selectedAsset,
    livePortfolio,
    schema,
    executeTrade,
    submitLimitOrder,
    cancelOrderById,
    isSubmitting,
    orderSide,
    setOrderSide: setSide,
    ticketFocusNonce,
  } = useTerminal();

  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [amountText, setAmountText] = useState<string>('');
  const [priceText, setPriceText] = useState<string>('');
  const [error, setError] = useState<TicketError | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);

  // `orderSide` is context-owned so the global B/S shortcuts can arm it.
  const side = orderSide;

  const markPrice = selectedAsset?.currentPrice ?? 0;
  const symbol = selectedAsset?.symbol ?? '';

  // The live mark moves on every tick, so it is read through a ref: subscribing
  // the re-seed effect to it would overwrite a half-typed price once a second.
  const markPriceRef = useRef<number>(markPrice);
  useEffect(() => {
    markPriceRef.current = markPrice;
  }, [markPrice]);

  // A B/S shortcut arms the side from anywhere in the terminal, so the ticket
  // has to actually take focus — otherwise the operator arms a toggle they
  // cannot see and then has to hunt for the field with the mouse.
  useEffect(() => {
    if (ticketFocusNonce === 0) {
      return;
    }
    amountInputRef.current?.focus();
  }, [ticketFocusNonce]);

  // Switching instruments — or entering LIMIT — invalidates a hand-typed price;
  // fall back to the new mark rather than leaving a stale quote in the field.
  useEffect(() => {
    if (orderType !== 'LIMIT') return;
    const mark = markPriceRef.current;
    if (mark <= 0) return;
    setPriceText(mark.toFixed(2));
  }, [symbol, orderType]);

  const amount = Number(amountText);
  const limitPrice = Number(priceText);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const hasPrice = Number.isFinite(limitPrice) && limitPrice > 0;
  const canSubmit =
    !isSubmitting && selectedAsset !== null && hasAmount && (orderType === 'MARKET' || hasPrice);

  const estimate = useMemo(() => {
    if (!hasAmount || markPrice <= 0) return null;
    const previewPrice = orderType === 'LIMIT' && hasPrice ? limitPrice : markPrice;
    return estimateOrder(previewPrice, amount, orderType, side);
  }, [amount, hasAmount, markPrice, orderType, hasPrice, limitPrice, side]);

  // BUY presets draw on unencumbered cash: cash already reserved by a working
  // buy limit is not spendable, and offering it here would build a ticket the
  // engine will reject.
  const availableForSide = side === 'BUY' ? availableCash(schema) : (livePortfolio.holdings[symbol]?.amount ?? 0);
  const availableLabel = side === 'BUY' ? 'cash' : 'position';

  const slippageWarning = useMemo(() => {
    if (estimate === null || orderType !== 'MARKET') return null;
    const notional = estimate.executionPrice * amount;
    if (notional <= 0) return null;
    const impact = (SLIPPAGE_FACTOR * 100).toFixed(3);
    return `Market orders cross the book: ~${impact}% adverse fill plus ${(TAKER_FEE_RATE * 100).toFixed(3)}% taker commission.`;
  }, [estimate, orderType, amount]);

  const focusField = useCallback((field: TicketField) => {
    if (field === 'amount') amountInputRef.current?.focus();
    else if (field === 'price') priceInputRef.current?.focus();
  }, []);

  const handleAmountChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    // Accept only a plain decimal while typing; the engine validates the rest.
    // A refused keystroke says so — dropping it in silence looks like a dead field.
    if (next !== '' && !/^\d*\.?\d*$/.test(next)) {
      setError({ field: 'amount', message: AMOUNT_FORMAT_COPY });
      return;
    }
    setAmountText(next);
    setError(null);
  }, []);

  const handlePriceChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (next !== '' && !/^\d*\.?\d*$/.test(next)) {
      setError({ field: 'price', message: PRICE_FORMAT_COPY });
      return;
    }
    setPriceText(next);
    setError(null);
  }, []);

  const handleAmountPaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').trim();
    if (pasted !== '' && /^\d*\.?\d*$/.test(pasted)) return;
    // A number input swallows a non-numeric paste on its own, so the refusal has
    // to be raised here or the operator watches a paste do nothing at all.
    event.preventDefault();
    setError({ field: 'amount', message: AMOUNT_FORMAT_COPY });
  }, []);

  const handlePricePaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').trim();
    if (pasted !== '' && /^\d*\.?\d*$/.test(pasted)) return;
    event.preventDefault();
    setError({ field: 'price', message: PRICE_FORMAT_COPY });
  }, []);

  const applyPreset = useCallback(
    (percent: number) => {
      if (availableForSide <= 0) return;

      let next: number;
      if (side === 'SELL' && percent === 100) {
        // A full exit has to be the held amount, exactly. Rounding to eight
        // decimals rounds in both directions: 0.0723456789 becomes 0.07234568,
        // which is more than the position holds, and the engine compares the
        // order size against the position with a strict `<`, so the surplus
        // turns a guaranteed liquidation into INSUFFICIENT_ASSET_BALANCE.
        //
        // Clamping to the available amount instead would sell slightly less,
        // and the leftover would be a real position: at the new dust floor
        // anything above 1e-11 survives, so "100%" would strand 1e-9 of BTC
        // with no way for the operator to see the end of it.
        next = availableForSide;
      } else {
        const share = (availableForSide * (percent / 100)) * (side === 'BUY' ? 0.999 : 1);
        // Trim float dust so "50%" of 0.1 does not read as 0.049999999, and
        // keep any partial sell strictly inside the position it is drawing on.
        const rounded = Number(share.toFixed(8));
        next = side === 'SELL' ? Math.min(rounded, availableForSide) : rounded;
      }

      setAmountText(String(next));
      setError(null);
    },
    [availableForSide, side]
  );

  const remedyContext = useMemo<RemedyContext>(
    () => ({
      symbol,
      cash: schema.cashBalance,
      position: livePortfolio.holdings[symbol]?.amount ?? 0,
      markPrice,
    }),
    [symbol, schema.cashBalance, livePortfolio.holdings, markPrice]
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (selectedAsset === null) {
        setError({ field: 'order', message: 'No instrument is selected. Pick a symbol from the watchlist to arm the ticket.' });
        return;
      }
      if (!canSubmit) {
        // Name the field the operator has to fix and put the caret in it, rather
        // than one sentence about "the ticket" pinned to the bottom of the form.
        if (!hasAmount) {
          setError({
            field: 'amount',
            message: `Amount must be greater than zero. Enter a size such as ${formatQuantity(0.5)} ${symbol}.`,
          });
          focusField('amount');
          return;
        }
        if (orderType === 'LIMIT' && !hasPrice) {
          setError({
            field: 'price',
            message:
              markPrice > 0
                ? `Limit price must be greater than zero. Enter a price such as ${formatCurrency(markPrice)}.`
                : 'Limit price must be greater than zero. Enter a price in dollars per unit.',
          });
          focusField('price');
          return;
        }
        setError({
          field: 'order',
          message: 'The previous order is still routing. Wait for its confirmation, then submit again.',
        });
        return;
      }

      const result =
        orderType === 'MARKET'
          ? await executeTrade(selectedAsset, side, amount)
          : await submitLimitOrder(selectedAsset, side, amount, limitPrice);

      if (result.success) {
        setAmountText('');
        setError(null);
      } else {
        const code = result.error;
        const field = (code === undefined ? undefined : ERROR_FIELD[code]) ?? 'order';
        setError({
          field,
          message: describeExecutionError(code, remedyContext),
        });
        if (field !== 'order') focusField(field);
      }
    },
    [
      selectedAsset,
      canSubmit,
      hasAmount,
      hasPrice,
      orderType,
      executeTrade,
      submitLimitOrder,
      side,
      amount,
      limitPrice,
      symbol,
      markPrice,
      remedyContext,
      focusField,
    ]
  );

  const handleCancel = useCallback(
    async (order: OrderRecord) => {
      const result = await cancelOrderById(order.id);
      if (!result.success) {
        setError({
          field: 'order',
          message: describeExecutionError(result.error, remedyContext),
        });
      } else {
        setError(null);
      }
    },
    [cancelOrderById, remedyContext]
  );

  const openOrders = useMemo(() => getOpenOrders(schema), [schema]);

  if (selectedAsset === null) {
    return (
      <div className={`flex h-full min-h-[160px] flex-col items-center justify-center gap-1 p-3 text-center ${className}`}>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-500">No instrument</span>
        <span className="text-[11px] text-neutral-500">Select a symbol from the watchlist to arm the ticket.</span>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex min-h-0 flex-col ${className}`}
      aria-label="Order ticket"
      noValidate
    >
      {/* The type toggle is the single most consequential control in the
          terminal — market costs a taker fee and pays slippage, limit earns the
          cheaper maker fee but may never fill — so it carries its own
          explanation rather than sending the operator to a glossary. */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#262c36] bg-[#0d1014] pr-1">
        <div className="flex flex-1">
          {(['MARKET', 'LIMIT'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setOrderType(type);
                setError(null);
              }}
              aria-pressed={orderType === type}
              className={`min-h-[44px] flex-1 text-[11px] font-bold tracking-[0.1em] transition-colors ${
                orderType === type
                  ? 'border-b-2 border-amber-500 bg-[#181c24] text-amber-500'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
        <InfoTip
          term={orderType === 'MARKET' ? 'Market order' : 'Limit order'}
          explanation={
            orderType === 'MARKET'
              ? 'Fills immediately at the best available price. Pays 0.05% slippage plus a 0.10% taker fee.'
              : 'Waits in the book until the market reaches your price. No slippage and a cheaper 0.05% maker fee, but it may never fill.'
          }
          align="right"
        />
      </div>

      <div className="flex shrink-0 gap-1 p-2">
        {(['BUY', 'SELL'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setSide(option);
              setError(null);
            }}
            aria-pressed={side === option}
            className={`min-h-[44px] flex-1 border text-[12px] font-bold tracking-[0.12em] transition-colors ${
              side === option
                ? option === 'BUY'
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                  : 'border-rose-500 bg-rose-500/15 text-rose-500'
                : 'border-[#262c36] bg-[#181c24] text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 px-2">
        <TerminalInput
          ref={amountInputRef}
          name="order-amount"
          label="Amount"
          value={amountText}
          onChange={handleAmountChange}
          onPaste={handleAmountPaste}
          error={error?.field === 'amount' ? error.message : undefined}
          unit={symbol}
          inputMode="decimal"
          disabled={isSubmitting}
          step={0.01}
          min={0}
          onIncrement={() => applyPreset(25)}
          onDecrement={() => setAmountText('')}
          hint={
            hasAmount
              ? `${formatQuantity(amount)} ${symbol}`
              : `Available ${formatQuantity(availableForSide)} ${availableLabel}`
          }
        />

        {orderType === 'LIMIT' ? (
          <TerminalInput
            ref={priceInputRef}
            name="order-limit-price"
            label="Limit price"
            value={priceText}
            onChange={handlePriceChange}
            onPaste={handlePricePaste}
            error={error?.field === 'price' ? error.message : undefined}
            unit="USD"
            inputMode="decimal"
            disabled={isSubmitting}
            step={0.01}
            min={0}
            onIncrement={() => setPriceText(String(Number((limitPrice + 1 || 1).toFixed(2))))}
            onDecrement={() => setPriceText(String(Number(Math.max(0.01, limitPrice - 1 || 0.01).toFixed(2))))}
            hint={`Mark ${formatCurrency(markPrice)}`}
          />
        ) : (
          <div className="flex flex-col justify-end pb-1">
            <span className="text-[9px] uppercase tracking-[0.14em] text-neutral-600">Execution</span>
            <span className="text-[13px] font-bold tabular-nums text-cyan-500">
              {estimate === null ? '--' : formatCurrency(estimate.executionPrice)}
            </span>
            <span className="text-[10px] tabular-nums text-neutral-600">with slippage</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <span className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">Size</span>
        {ALLOCATION_PRESETS.map((percent) => (
          <button
            key={percent}
            type="button"
            onClick={() => applyPreset(percent)}
            disabled={availableForSide <= 0 || isSubmitting}
            className="min-h-[32px] flex-1 border border-[#262c36] bg-[#181c24] text-[10px] tabular-nums text-neutral-400 transition-colors hover:border-amber-500/50 hover:text-amber-500 disabled:opacity-40"
          >
            {percent}%
          </button>
        ))}
      </div>

      <div className="mt-2 shrink-0 border-y border-[#262c36] bg-[#0d1014] px-2 py-1.5">
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
          <div className="flex items-center justify-between gap-1">
            <dt className="text-neutral-600">Notional</dt>
            <dd className="tabular-nums text-neutral-200">{estimate === null ? '--' : formatCurrency(estimate.totalValue)}</dd>
          </div>
          <div className="flex items-center justify-between gap-1">
            <dt className="text-neutral-600">
              Fee {orderType === 'MARKET' ? `(${(TAKER_FEE_RATE * 100).toFixed(2)}%)` : `(${(MAKER_FEE_RATE * 100).toFixed(2)}%)`}
            </dt>
            <dd className="tabular-nums text-amber-500">{estimate === null ? '--' : formatCurrency(estimate.fee)}</dd>
          </div>
          <div className="col-span-2 flex items-center justify-between gap-1 border-t border-[#1b2029] pt-1">
            <dt className="text-neutral-600">Cash after fill</dt>
            <dd className={`tabular-nums ${estimate !== null && estimate.cashDelta < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
              {formatCurrency(schema.cashBalance + (estimate?.cashDelta ?? 0))}
            </dd>
          </div>
        </dl>
      </div>

      {slippageWarning !== null ? (
        <p className="shrink-0 px-2 pt-1.5 text-[10px] leading-snug text-amber-500/90">
          <span aria-hidden="true">▲ </span>
          {slippageWarning}
        </p>
      ) : null}

      {/* Field errors render inline, above; this catches the ones that belong to
          the ticket as a whole — a cancel failure, an order already in flight. */}
      {error !== null && error.field === 'order' ? (
        <p role="alert" className="shrink-0 px-2 pt-1.5 text-[10px] leading-snug text-rose-500">
          {error.message}
        </p>
      ) : null}

      <div className="shrink-0 p-2">
        <ActionButton
          type="submit"
          variant={side === 'BUY' ? 'buy' : 'sell'}
          fullWidth
          disabled={!canSubmit}
          aria-busy={isSubmitting}
        >
          {isSubmitting
            ? 'ROUTING…'
            : `${side}${hasAmount ? ` ${formatQuantity(amount)}` : ''} ${symbol} @ ${
                orderType === 'MARKET' ? 'MARKET' : hasPrice ? formatCurrency(limitPrice) : '—'
              }`}
        </ActionButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-[#262c36]">
        <div className="flex h-7 shrink-0 items-center justify-between px-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-500">Working orders</span>
          <TerminalBadge tone={openOrders.length > 0 ? 'pending' : 'muted'}>{openOrders.length}</TerminalBadge>
        </div>

        {openOrders.length === 0 ? (
          <p className="px-2 py-2 text-[10px] text-neutral-600">No resting orders. Limit orders appear here until filled.</p>
        ) : (
          <ul className="scrollbar-thin min-h-0 flex-1 divide-y divide-[#1b2029] overflow-y-auto">
            {openOrders.map((order) => (
              <li key={order.id} className="flex items-center gap-2 px-2 py-1.5 text-[10px]">
                <SideBadge side={order.side} />
                <OrderTypeBadge type={order.type} />
                <span className="min-w-0 flex-1 truncate tabular-nums text-neutral-300">
                  {formatQuantity(order.amount)} {order.symbol}
                </span>
                <span className="shrink-0 tabular-nums text-neutral-500">@ {formatCurrency(order.price)}</span>
                <OrderStatusBadge status={order.status} />
                <button
                  type="button"
                  onClick={() => void handleCancel(order)}
                  disabled={isSubmitting}
                  aria-label={`Cancel ${order.side} order for ${order.amount} ${order.symbol}`}
                  className="min-h-[32px] shrink-0 border border-rose-500/40 px-1.5 text-[10px] font-bold text-rose-500 transition-colors hover:bg-rose-500/15 disabled:opacity-40"
                >
                  X
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="shrink-0 border-t border-[#262c36] px-2 py-1 text-[9px] text-neutral-600">
        Day P&amp;L {formatPercent(selectedAsset.change24h, 2)} · 24h vol {formatCurrency(selectedAsset.volume24h, 0)}
      </p>
    </form>
  );
};

export default ExecutionTerminal;
