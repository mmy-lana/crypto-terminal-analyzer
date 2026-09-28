import React, { ErrorInfo, ReactNode } from 'react';

import { formatUtcDateTime } from '../../utils/formatters';
import { STORAGE_KEY } from '../../hooks/useTerminalStorage';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Notified for every caught error, e.g. to log it. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

/**
 * Opaque handle for a fault, for the operator to quote and support to match
 * against their own logs.
 *
 * It is derived from the error text so the two sides agree, which makes it a
 * correlation handle rather than a secrecy mechanism — the raw text is simply
 * never put in front of whoever is reading the screen. That is the whole
 * point: a stack trace in the DOM reaches anyone with devtools, anyone
 * screen-sharing, and anyone who screenshots the crash into a ticket.
 */
function incidentReference(error: Error): string {
  const stamp = Date.now().toString(36).toUpperCase();
  // FNV-1a, held to a fixed width so the token is a stable shape to quote.
  let hash = 2166136261;
  const seed = `${error.name}:${error.message}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7);
  return `FAULT-${stamp}-${digest}`;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  /** Stable handle for the current fault, quoted in the production crash view. */
  errorRef: string;
  /** Incremented on every retry so React remounts the subtree. */
  attempt: number;
}

/**
 * Terminal-motif crash view.
 *
 * A render-time throw inside the workstation would otherwise blank the whole
 * page and lose the operator's context. This catches it, shows a code dump in
 * the same monospace idiom as the rest of the UI, and offers two recoveries:
 * retry the render, or wipe the persisted schema and restart clean.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, componentStack: '', errorRef: '', attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, errorRef: incidentReference(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? '' });
    this.props.onError?.(error, info);
    // Keep the crash visible in the browser console for field diagnosis.
    console.error('[TERMINAL] Unrecoverable render fault:', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState((prev) => ({ error: null, componentStack: '', errorRef: '', attempt: prev.attempt + 1 }));
  };

  private readonly handleWipeAndReload = (): void => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable (private mode, disabled cookies). The
      // reload below still recovers the in-memory state, so this is not fatal.
    }
    window.location.reload();
  };

  private readonly handleDump = (): void => {
    const { error, componentStack } = this.state;
    if (!error) return;

    // Read the flag at call time rather than caching it at module scope, so the
    // disclosure rule under test is the rule that ships.
    if (!import.meta.env.DEV) {
      // The console is not a private channel. Anything written here is captured
      // by whatever the operator runs, and by any error-reporting shim the
      // embedding page installed. Log a handle they can quote and let field
      // capture decide what to do with it.
      // eslint-disable-next-line no-console
      console.error('[TERMINAL] Render fault', { reference: incidentReference(error) });
      return;
    }

    // eslint-disable-next-line no-console
    console.error('[TERMINAL] CODE DUMP', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      componentStack,
    });
  };

  override render(): ReactNode {
    const { error, attempt } = this.state;

    if (!error) {
      // Keying on the attempt forces a clean remount after a retry.
      return <React.Fragment key={attempt}>{this.props.children}</React.Fragment>;
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.handleReset);
    }

    return (
      <div className="flex min-h-screen flex-col gap-3 bg-[#0a0b0d] p-4 font-mono text-xs text-neutral-300">
        <header className="flex items-center gap-2 border border-rose-500/40 bg-rose-500/10 px-3 py-2">
          <span className="h-2 w-2 shrink-0 animate-pulse-slow rounded-full bg-rose-500" aria-hidden="true" />
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-rose-500">System Crash</h1>
          <span className="ml-auto text-[10px] text-neutral-500">{formatUtcDateTime(new Date().toISOString())}</span>
        </header>

        {/* The alert is scoped to the one sentence an operator can act on. The
            crash view as a whole is not a live region: wrapping the stack dump
            in role="alert" would dictate forty lines of minified frames into
            the speech queue, which delays the recovery buttons. */}
        <p role="alert" className="text-[11px] leading-relaxed text-neutral-400">
          The paper trading kernel halted while rendering a panel. Your persisted ledger was left untouched.
          Retry the render, or dump the fault and restart from a clean ledger.
        </p>

        <section className="flex min-h-0 flex-1 flex-col border border-[#262c36] bg-[#12151a]">
          <div className="flex items-center justify-between border-b border-[#262c36] bg-[#181c24] px-2 py-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-500">Code Dump</span>
            <span className="text-[10px] text-neutral-600">
              {import.meta.env.DEV ? `${error.name}: ${error.message}` : this.state.errorRef}
            </span>
          </div>
          {/* Developer detail, not operator detail: sighted users read it on
              screen and everyone can reach it through "Dump To Console" below,
              so it stays out of the accessibility tree. The fault's name and
              message above it are the part worth announcing.

              In production neither the stack nor the component stack is
              rendered. Both name internal module structure, and on a built
              bundle they are minified frames that still map back to the source
              layout. The operator gets the incident reference instead, which is
              the part they can actually act on. */}
          <pre
            aria-hidden="true"
            data-incident-ref={import.meta.env.DEV ? undefined : this.state.errorRef}
            className="scrollbar-thin min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 text-[10px] leading-relaxed text-rose-500/90"
          >
            {import.meta.env.DEV
              ? `${error.stack ?? `${error.name}: ${error.message}`}${
                  this.state.componentStack ? `
--- COMPONENT STACK ---
${this.state.componentStack}` : ''
                }`
              : `INCIDENT ${this.state.errorRef}

The diagnostic detail for this fault was withheld from this build. Quote the reference above when reporting it; it identifies the fault without disclosing the internals of the trading kernel.`}
          </pre>
        </section>

        <footer className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={this.handleReset}
            className="min-h-[44px] flex-1 border border-amber-500/50 bg-amber-500/10 px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-500 transition-colors hover:bg-amber-500/20 active:bg-amber-500/30"
          >
            Retry Render
          </button>
          <button
            type="button"
            onClick={this.handleDump}
            className="min-h-[44px] flex-1 border border-[#262c36] bg-[#181c24] px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-300 transition-colors hover:bg-[#222733] active:bg-[#0e1116]"
          >
            Dump To Console
          </button>
          <button
            type="button"
            onClick={this.handleWipeAndReload}
            className="min-h-[44px] flex-1 border border-rose-500/50 bg-rose-500/10 px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-rose-500 transition-colors hover:bg-rose-500/20 active:bg-rose-500/30"
          >
            Wipe Ledger &amp; Restart
          </button>
        </footer>
      </div>
    );
  }
}

export default ErrorBoundary;
