import React, { ButtonHTMLAttributes } from 'react';

export type ActionButtonVariant = 'buy' | 'sell' | 'neutral' | 'terminal' | 'ghost' | 'danger';

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ActionButtonVariant;
  /** Renders a fixed-width block. */
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  /** Accessible label when the visible text is a glyph. */
  'aria-label'?: string;
}

const VARIANT_STYLES: Record<ActionButtonVariant, string> = {
  buy: 'bg-[#10b981] text-black font-bold hover:bg-[#059669] active:bg-[#047857]',
  sell: 'bg-[#f43f5e] text-white font-bold hover:bg-[#e11d48] active:bg-[#be123c]',
  neutral: 'bg-[#262c36] text-neutral-200 hover:bg-[#323a46] active:bg-[#1c222b]',
  terminal:
    'bg-[#181c24] text-amber-500 border border-amber-500/40 hover:bg-[#222733] hover:border-amber-500/70 active:bg-[#141821]',
  ghost: 'bg-transparent text-neutral-400 border border-[#262c36] hover:bg-[#181c24] hover:text-neutral-200 active:bg-[#141821]',
  danger: 'bg-transparent text-rose-500 border border-rose-500/40 hover:bg-rose-500/10 active:bg-rose-500/20',
};

/**
 * Flat, tactile terminal button.
 *
 * Touch targets are never below 44x44px (plan §3.7), the pressed state is
 * expressed through a darker background rather than `:active` scaling so
 * there is no layout shift on tap, and every variant keeps its own text
 * contrast against its own background.
 */
export const ActionButton: React.FC<ActionButtonProps> = ({
  variant = 'terminal',
  fullWidth = false,
  type = 'button',
  disabled = false,
  className = '',
  children,
  ...props
}) => (
  <button
    type={type}
    disabled={disabled}
    className={`inline-flex min-h-[44px] min-w-[44px] select-none items-center justify-center gap-1.5 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-inherit ${
      VARIANT_STYLES[variant]
    } ${fullWidth ? 'w-full' : ''} ${className}`}
    {...props}
  >
    {children}
  </button>
);

export default ActionButton;
