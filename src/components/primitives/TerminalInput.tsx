import React, { ChangeEvent, ClipboardEventHandler, KeyboardEvent, Ref, useCallback, useId } from 'react';

export interface TerminalInputProps {
  label: string;
  value: number | string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  /** Fired before the browser applies a paste, so a parent can refuse it. */
  onPaste?: ClipboardEventHandler<HTMLInputElement>;
  /** Called with the next value when a stepper button is pressed. */
  onIncrement?: () => void;
  onDecrement?: () => void;
  max?: number;
  disabled?: boolean;
  /** Static unit rendered inside the field, e.g. "BTC" or "USD". */
  unit?: string;
  /** Hint rendered under the label, e.g. "0.25 BTC = $16,250". */
  hint?: string;
  /** Error text; renders the field in the loss colour. */
  error?: string;
  id?: string;
  /** Form name; defaults to a slug of the label, e.g. "Limit price" → "limit-price". */
  name?: string;
  /** Escape hatch so a parent can put the caret back in the field. */
  ref?: Ref<HTMLInputElement>;
  inputMode?: 'decimal' | 'numeric' | 'text';
  className?: string;
}

const STEP_KEYS: Record<string, 'increment' | 'decrement'> = {
  ArrowUp: 'increment',
  ArrowRight: 'increment',
  ArrowDown: 'decrement',
  ArrowLeft: 'decrement',
};

/**
 * Rigid numeric field with stepper targets.
 *
 * The input is `type="text"`, not `type="number"`, and that is deliberate. A
 * number input runs the value through the HTML sanitization algorithm before
 * the change handler is ever called, which silently discards any character the
 * locale uses for the decimal point. A German operator typing `0,5` does not
 * reach this component with a comma: the field delivers an empty string, and no
 * amount of validation downstream can recover a character the browser already
 * threw away. `inputMode="decimal"` still puts a numeric keypad under the
 * operator's thumb on a phone, and the steppers were always ours.
 *
 * Validation is the caller's job — this component forwards whatever text it is
 * given and reports it verbatim, so the ticket can decide what a number is and
 * say so when the text is not one.
 *
 * Both stepper buttons are full 44x44px touch targets, and ArrowUp/ArrowDown
 * mirror the steppers so
 * a keyboard operator never has to reach for the mouse. The hint and the
 * error are wired to the input as descriptions rather than left as loose text,
 * so focusing the field reads both back — and the error branch keeps its own
 * focus treatment, because a red border alone is not a focus indicator.
 */
export const TerminalInput: React.FC<TerminalInputProps> = ({
  label,
  value,
  onChange,
  onPaste,
  onIncrement,
  onDecrement,
  disabled = false,
  unit,
  hint,
  error,
  id,
  name,
  ref,
  inputMode = 'decimal',
  className = '',
}) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  // A control without a name is not postable or restorable; slug the label so
  // the primitive is useful without every caller inventing a name.
  const fieldName = name ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // The hint id joins in only while a hint exists, so the description never
  // points at an element that is not rendered.
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const action = STEP_KEYS[event.key];
      if (!action) return;
      // Only hijack the arrows when the steppers can actually act.
      if (action === 'increment' && !onIncrement) return;
      if (action === 'decrement' && !onDecrement) return;
      event.preventDefault();
      if (action === 'increment') onIncrement?.();
      else onDecrement?.();
    },
    [onIncrement, onDecrement]
  );

  return (
    <div className={`flex min-w-0 flex-col gap-1 font-mono ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="truncate text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="truncate text-[9px] text-neutral-500">
            {hint}
          </span>
        ) : null}
      </div>

      <div
        className={`flex items-stretch border bg-[#0a0b0d] ${
          // The invalid branch needs its own focus state: a red border alone
          // leaves a focused invalid field with no visible focus at all.
          error
            ? 'border-rose-500 focus-within:border-rose-400 focus-within:ring-1 focus-within:ring-rose-500/40'
            : 'border-[#262c36] focus-within:border-amber-500'
        }`}
      >
        <input
          id={inputId}
          name={fieldName}
          ref={ref}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={onChange}
          onPaste={onPaste}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-sm text-neutral-100 outline-none tabular-nums disabled:opacity-50"
        />

        {unit ? (
          <span aria-hidden="true" className="flex items-center px-1 text-[10px] font-bold text-neutral-500">
            {unit}
          </span>
        ) : null}

        {onDecrement || onIncrement ? (
          <div className="flex divide-x divide-[#262c36] border-l border-[#262c36]">
            <button
              type="button"
              onClick={onDecrement}
              disabled={disabled || !onDecrement}
              aria-label={`Decrease ${label}`}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-base text-neutral-400 transition-colors hover:bg-[#181c24] hover:text-white active:bg-[#0a0b0d] disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              onClick={onIncrement}
              disabled={disabled || !onIncrement}
              aria-label={`Increase ${label}`}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-base text-neutral-400 transition-colors hover:bg-[#181c24] hover:text-white active:bg-[#0a0b0d] disabled:opacity-40"
            >
              +
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        // The message is announced, not just coloured: the number input itself
        // stays empty, so nothing else would tell a screen reader why.
        <span id={errorId} role="alert" className="text-[10px] font-bold text-rose-500">
          {error}
        </span>
      ) : null}
    </div>
  );
};

export default TerminalInput;
