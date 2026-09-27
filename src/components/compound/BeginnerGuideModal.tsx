import React, { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface BeginnerGuideModalProps {
  open: boolean;
  onClose: () => void;
}

/** One numbered step of the walkthrough. */
interface GuideStep {
  title: string;
  body: React.ReactNode;
}

const STEPS: GuideStep[] = [
  {
    title: 'Select an instrument',
    body: (
      <>
        Click any asset in <strong className="text-white">[1] MONITOR</strong> — BTC, ETH, SOL and the rest — or
        pick one off the ticker tape to load it into the workstation.
      </>
    ),
  },
  {
    title: 'Execute a paper trade',
    body: (
      <>
        Switch to <strong className="text-white">[2] TRADE</strong>. Choose <strong className="text-white">MARKET</strong>{' '}
        to fill immediately, or <strong className="text-white">LIMIT</strong> to wait for your price with a cheaper
        fee. Type an amount or use the percentage shortcuts, then press{' '}
        <strong className="text-emerald-400">BUY</strong> or <strong className="text-rose-400">SELL</strong>.
      </>
    ),
  },
  {
    title: 'Watch risk and performance',
    body: (
      <>
        Open <strong className="text-white">[3] ANALYTICS</strong> for the Sharpe ratio, max drawdown and return
        correlations. Hover or tap any <span className="text-amber-500">?</span> beside a metric to learn what it
        means.
      </>
    ),
  },
  {
    title: 'Review your history',
    body: (
      <>
        Switch to <strong className="text-white">[4] LEDGER</strong> to audit every execution, check the
        commissions you paid, or export the whole thing as CSV.
      </>
    ),
  },
];

/**
 * First-run walkthrough for operators who do not trade.
 *
 * The focus contract is the same one `CommandPalette` keeps: focus moves into
 * the sheet on open, Tab is trapped inside it while `aria-modal` is promised,
 * Escape and the backdrop both dismiss, and focus returns to the trigger on
 * close. `aria-modal="true"` without that treatment is worse than no dialog at
 * all — it tells assistive technology the rest of the page is inert while focus
 * is still wandering behind it.
 */
export const BeginnerGuideModal: React.FC<BeginnerGuideModalProps> = ({ open, onClose }) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    // After paint, so the heading exists to receive focus.
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      // Focus belongs back to the trigger, whether it was closed or unmounted.
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

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

  /** First wraps forward from last, last wraps back from first. */
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      // Backdrop click closes. The inner sheet stops propagation so a drag that
      // ends on the panel does not dismiss a dialog the operator is reading.
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="beginner-guide-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapTab}
        className="flex max-h-[90vh] w-full max-w-lg flex-col border border-cyan-500/40 bg-[#12151a] shadow-2xl"
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#262c36] bg-[#181c24] px-3">
          <span id="beginner-guide-title" className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">
            Beginner Guide: How to Trade &amp; Analyze
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center font-mono text-xs text-neutral-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <ol className="flex-1 space-y-3 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-neutral-300">
          {STEPS.map((step, index) => (
            <li key={step.title} className="space-y-1">
              <p className="font-bold text-amber-500">
                {index + 1}. {step.title}
              </p>
              <p className="text-neutral-400">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="shrink-0 border-t border-[#262c36] p-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-full bg-[#181c24] text-center font-mono text-xs font-bold uppercase tracking-wider text-cyan-400 hover:bg-[#222733]"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};

export default BeginnerGuideModal;
