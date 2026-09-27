import React, { useEffect, useId, useRef, useState } from 'react';

export interface InfoTipProps {
  term: string;
  explanation: string;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

/**
 * Accessible, touch- and keyboard-friendly trigger for non-trader guidance.
 *
 * Deliberately a tap/click toggle rather than a hover tooltip: a hover-only
 * affordance is unusable on touch and unreachable by keyboard, and this
 * terminal is a phone-first product. The trigger keeps a 44px box per plan §5
 * even though the glyph inside is a 14px dot, so it can sit inline in dense
 * metric rows without shrinking the target.
 *
 * The panel is wired as `aria-describedby` rather than a live region, so a
 * screen reader announces the explanation as part of the trigger instead of
 * interrupting whatever the operator was reading.
 */
export const InfoTip: React.FC<InfoTipProps> = ({
  term,
  explanation,
  className = '',
  align = 'left',
}) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        tooltipRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const alignmentStyles = {
    left: 'left-0',
    right: 'right-0',
    center: 'left-1/2 -translate-x-1/2',
  }[align];

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        aria-label={`Explain ${term}`}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-1 text-neutral-500 hover:text-amber-500 focus-visible:text-amber-400"
      >
        <span
          aria-hidden="true"
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none"
        >
          ?
        </span>
      </button>

      {open ? (
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-1 w-56 border border-amber-500/50 bg-[#181c24] p-2 text-left font-mono text-[10px] leading-relaxed text-neutral-200 shadow-2xl ${alignmentStyles}`}
        >
          <div className="mb-1 font-bold uppercase tracking-wider text-amber-500">{term}</div>
          <div className="text-neutral-300">{explanation}</div>
        </div>
      ) : null}
    </span>
  );
};

export default InfoTip;
