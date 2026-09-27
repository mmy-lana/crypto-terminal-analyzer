import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { ActionButton } from '../primitives/ActionButton';
import { SUPPORTED_SYMBOLS } from '../../services/marketFeed';

export type ParsedCommand =
  | { kind: 'MARKET'; side: 'BUY' | 'SELL'; symbol: string; amount: number; raw: string }
  | { kind: 'LIMIT'; side: 'BUY' | 'SELL'; symbol: string; price: number; amount: number; raw: string }
  | { kind: 'SELECT'; symbol: string; raw: string }
  | { kind: 'RESET'; raw: string }
  | { kind: 'INVALID'; raw: string; reason: string };

const KNOWN_SYMBOLS = new Set(SUPPORTED_SYMBOLS);

/** Everything Tab can reach inside the sheet; the trap wraps at both ends. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const isPositiveNumber = (token: string | undefined): token is string => {
  if (token === undefined) return false;
  const value = Number(token);
  return Number.isFinite(value) && value > 0;
};

/**
 * Parses a terminal quick-command.
 *
 * Grammar (case-insensitive, commas optional):
 *   `BUY BTC 0.5`                 → market buy
 *   `SELL ETH 1`                  → market sell
 *   `MARKET BUY SOL 2`            → market buy, explicit
 *   `LIMIT BUY BTC 65000 0.5`     → resting bid at 65000
 *   `LIMIT SELL ETH 3600 2`       → resting offer at 3600
 *   `BTC`                         → select the instrument
 *   `RESET`                       → wipe the paper ledger
 *
 * Anything else returns `INVALID` with a human-readable reason, which the
 * palette renders inline. The function is pure so the grammar is unit-testable
 * without a DOM.
 */
export function parseCommand(input: string): ParsedCommand {
  const raw = input.trim();
  if (raw === '') {
    return { kind: 'INVALID', raw, reason: 'Enter a command' };
  }

  const tokens = raw
    .toUpperCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return { kind: 'INVALID', raw, reason: 'Enter a command' };
  }

  if (tokens[0] === 'RESET') {
    return tokens.length === 1 ? { kind: 'RESET', raw } : { kind: 'INVALID', raw, reason: 'RESET takes no arguments' };
  }

  const first = tokens[0] ?? '';
  const isOrderVerb = first === 'BUY' || first === 'SELL';

  if (!isOrderVerb && first !== 'LIMIT' && first !== 'MARKET') {
    // Bare symbol selects the instrument.
    if (tokens.length === 1 && KNOWN_SYMBOLS.has(first)) {
      return { kind: 'SELECT', symbol: first, raw };
    }
    return {
      kind: 'INVALID',
      raw,
      reason: `Unknown command. Try BUY, SELL, LIMIT, or a symbol such as ${[...KNOWN_SYMBOLS].slice(0, 3).join(', ')}.`,
    };
  }

  let index = 0;
  let orderType: 'MARKET' | 'LIMIT' = 'MARKET';
  if (first === 'LIMIT' || first === 'MARKET') {
    orderType = first;
    index = 1;
  }

  const sideToken = tokens[index];
  if (sideToken !== 'BUY' && sideToken !== 'SELL') {
    return { kind: 'INVALID', raw, reason: 'Expected BUY or SELL' };
  }
  const side = sideToken;
  index += 1;

  const symbol = tokens[index];
  if (symbol === undefined || !KNOWN_SYMBOLS.has(symbol)) {
    return {
      kind: 'INVALID',
      raw,
      reason: `Unknown symbol. Listed: ${[...KNOWN_SYMBOLS].join(', ')}`,
    };
  }
  index += 1;

  const firstNumber = tokens[index];
  if (!isPositiveNumber(firstNumber)) {
    return { kind: 'INVALID', raw, reason: `Expected a positive number for ${orderType === 'LIMIT' ? 'price' : 'amount'}` };
  }
  const firstValue = Number(firstNumber);
  index += 1;

  if (orderType === 'LIMIT') {
    const secondNumber = tokens[index];
    if (!isPositiveNumber(secondNumber)) {
      return { kind: 'INVALID', raw, reason: 'LIMIT needs both a price and an amount' };
    }
    index += 1;
    if (index < tokens.length) {
      return { kind: 'INVALID', raw, reason: 'Too many arguments' };
    }
    return { kind: 'LIMIT', side, symbol, price: firstValue, amount: Number(secondNumber), raw };
  }

  if (index < tokens.length) {
    return { kind: 'INVALID', raw, reason: 'Too many arguments' };
  }
  return { kind: 'MARKET', side, symbol, amount: firstValue, raw };
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Executes a parsed command. Receives the raw string for logging. */
  onExecute: (command: ParsedCommand) => void;
  /** Pre-fills the field when the palette is opened by a shortcut. */
  initialValue?: string;
  className?: string;
}

/** A one-tap example chip. RESET is labelled with the consequence it carries. */
interface ExampleChip {
  /** What the chip says. */
  label: string;
  /** What it types into the field — never the label, which may carry a warning. */
  command: string;
  /** Styles the chip as the destructive command it is. */
  destructive?: boolean;
}

const EXAMPLES: readonly ExampleChip[] = [
  { label: 'BUY BTC 0.5', command: 'BUY BTC 0.5' },
  { label: 'SELL ETH 2', command: 'SELL ETH 2' },
  { label: 'LIMIT BUY BTC 60000 1', command: 'LIMIT BUY BTC 60000 1' },
  { label: 'SOL', command: 'SOL' },
  { label: 'RESET (wipes ledger)', command: 'RESET', destructive: true },
];

/**
 * Shortcut-driven execution launcher.
 *
 * Focus moves to the field on open, is trapped inside the sheet while it is
 * open, and returns to the trigger on close; Escape and backdrop clicks both
 * dismiss, and the dialog is a full-screen sheet under 768px where plan §5
 * requires the command bar to take the whole screen.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onExecute, initialValue = '', className = '' }) => {
  const [value, setValue] = useState(initialValue);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const feedbackId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setValue(initialValue);
    setSubmitError(null);
    // Focus after paint so the caret lands in the field.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      // Focus belongs back to whatever opened the sheet, whether it was closed
      // or the whole palette was unmounted underneath it.
      restoreFocusRef.current?.focus?.();
    };
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  const preview = useMemo(() => (value.trim() === '' ? null : parseCommand(value)), [value]);

  /**
   * `aria-modal` promises focus stays inside the sheet, and Tab is the only way
   * out of it, so the last control wraps forward and the first wraps back.
   */
  const trapTab = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const root = dialogRef.current;
    if (root === null) return;

    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;

    const active = document.activeElement;
    const inside = active !== null && root.contains(active);
    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const parsed = parseCommand(value);
      if (parsed.kind === 'INVALID') {
        // The button stays enabled on purpose: a disabled control explains
        // nothing, so a refused submit states the reason in the live region
        // instead of being a click that appears to do nothing at all.
        setSubmitError(`Cannot execute — ${parsed.reason}.`);
        inputRef.current?.focus();
        return;
      }
      setSubmitError(null);
      onExecute(parsed);
      onClose();
    },
    [value, onExecute, onClose]
  );

  /** The button names the consequence, not a generic verb, as the input parses. */
  const submitLabel = useMemo(() => {
    if (preview === null) return 'Execute';
    if (preview.kind === 'RESET') return 'Wipe ledger';
    if (preview.kind === 'SELECT') return 'Switch instrument';
    return 'Place order';
  }, [preview]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-0 sm:items-center sm:p-4 ${className}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Terminal command palette"
        onKeyDown={trapTab}
        className="flex h-full w-full max-w-xl flex-col border border-amber-500/40 bg-[#12151a] shadow-2xl sm:h-auto"
      >
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-[#262c36] bg-[#181c24] px-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500">Command Palette</span>
          <span className="text-[10px] text-neutral-500">
            <kbd className="rounded-sm border border-[#262c36] bg-[#0a0b0d] px-1">ESC</kbd> to abort
          </span>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <label htmlFor="command-input" className="sr-only">
            Terminal command
          </label>
          <div className="flex items-center border border-[#262c36] bg-[#0a0b0d] focus-within:border-amber-500">
            <span aria-hidden="true" className="px-2 font-mono text-sm font-bold text-amber-500">
              $
            </span>
            <input
              id="command-input"
              ref={inputRef}
              name="command"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                // The next keystroke supersedes the refusal, so the live region
                // stops repeating a message about text that no longer exists.
                setSubmitError(null);
              }}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="BUY BTC 0.5…"
              aria-describedby={feedbackId}
              aria-invalid={preview !== null && preview.kind === 'INVALID' ? true : undefined}
              className="min-h-[48px] w-full bg-transparent px-1 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-700"
            />
          </div>

          {/* The parse result changes on every keystroke, so it is a live region:
              without one, a rejection is only ever a colour change. */}
          <div id={feedbackId} role="status" aria-live="polite" className="min-h-[34px] text-[10px] leading-snug">
            {submitError !== null ? (
              <span className="text-rose-500">{submitError}</span>
            ) : preview === null ? (
              <span className="text-neutral-600">Awaiting input — try a command below.</span>
            ) : preview.kind === 'INVALID' ? (
              <span className="text-rose-500">{preview.reason}</span>
            ) : (
              <span className="text-emerald-500">
                {preview.kind === 'MARKET'
                  ? `MARKET ${preview.side} ${preview.amount} ${preview.symbol}`
                  : preview.kind === 'LIMIT'
                    ? `LIMIT ${preview.side} ${preview.amount} ${preview.symbol} @ ${preview.price}`
                    : preview.kind === 'SELECT'
                      ? `SELECT ${preview.symbol}`
                      : 'RESET PAPER LEDGER'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">Examples</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.command}
                type="button"
                onClick={() => {
                  setValue(example.command);
                  setSubmitError(null);
                }}
                className={`min-h-[28px] border bg-[#181c24] px-1.5 text-[10px] transition-colors ${
                  example.destructive === true
                    ? 'border-rose-500/50 text-rose-500 hover:border-rose-500 hover:text-rose-400'
                    : 'border-[#262c36] text-neutral-400 hover:border-amber-500/50 hover:text-amber-500'
                }`}
              >
                {example.label}
              </button>
            ))}
          </div>

          <div className="mt-auto flex gap-2">
            <ActionButton variant="terminal" fullWidth onClick={onClose}>
              Abort
            </ActionButton>
            <ActionButton variant="buy" fullWidth type="submit">
              {submitLabel}
            </ActionButton>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CommandPalette;
