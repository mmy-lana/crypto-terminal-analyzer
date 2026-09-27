import React, { useCallback, useEffect, useState } from 'react';

import { OrderSide, TerminalTab } from './types/terminal';
import { TerminalProvider, useTerminal } from './context/TerminalContext';
import { CommandPalette, ParsedCommand } from './components/compound/CommandPalette';
import { ErrorBoundary } from './components/primitives/ErrorBoundary';
import { TerminalLayout } from './layouts/TerminalLayout';
import { useIsMobile } from './hooks/useMediaQuery';

/** Tab shortcuts, matching the cues in the header bar. */
const TAB_KEYS: Record<string, TerminalTab> = {
  '1': 'MONITOR',
  '2': 'TRADE',
  '3': 'ANALYTICS',
  '4': 'LEDGER',
};

/** Side shortcuts: arm the ticket's BUY/SELL toggle without leaving the keyboard. */
const SIDE_KEYS: Record<string, OrderSide> = {
  b: 'BUY',
  s: 'SELL',
};

/** A shortcut must not hijack a key the operator is typing into a field. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Screen composition: global hotkeys and the command palette.
 *
 * Kept apart from the layout so the shell stays a pure function of its props,
 * and this file owns everything global — the keydown listener, the active tab,
 * and the palette route that turns a typed string into a real order. Every
 * palette command goes through the same context actions the ticket uses, so
 * `BUY BTC 0.5` and the buy button are the same execution path.
 */
const TerminalScreen: React.FC = () => {
  const {
    assets,
    setSelectedSymbol,
    executeTrade,
    submitLimitOrder,
    resetPortfolio,
    setOrderSide,
    focusTicket,
  } = useTerminal();

  const isMobileLayout = useIsMobile();
  const [activeTab, setActiveTab] = useState<TerminalTab>('MONITOR');
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteSeed, setPaletteSeed] = useState('');

  const openPalette = useCallback((seed = '') => {
    setPaletteSeed(seed);
    setIsPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => setIsPaletteOpen(false), []);

  const handleCommand = useCallback(
    (command: ParsedCommand): void => {
      switch (command.kind) {
        case 'SELECT': {
          setSelectedSymbol(command.symbol);
          setActiveTab('MONITOR');
          return;
        }
        case 'RESET': {
          // Typing RESET is one keystroke sequence away from a real order, and
          // it destroys the whole paper ledger. The header and the notice bar
          // both arm the wipe before applying it, so the palette — the one path
          // with no visible affordance before the command runs — must not be
          // the shortcut that skips the guard.
          if (window.confirm('Wipe the paper ledger and reseed the starting allocation?')) {
            resetPortfolio();
          }
          return;
        }
        case 'MARKET': {
          const asset = assets[command.symbol];
          if (asset === undefined) return;
          setSelectedSymbol(command.symbol);
          setActiveTab('TRADE');
          void executeTrade(asset, command.side, command.amount);
          return;
        }
        case 'LIMIT': {
          const asset = assets[command.symbol];
          if (asset === undefined) return;
          setSelectedSymbol(command.symbol);
          setActiveTab('TRADE');
          void submitLimitOrder(asset, command.side, command.amount, command.price);
          return;
        }
        default:
          return;
      }
    },
    [assets, setSelectedSymbol, executeTrade, submitLimitOrder, resetPortfolio]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // The palette owns Escape while it is open, and closes on it.
      if (event.key === 'Escape' && isPaletteOpen) {
        setIsPaletteOpen(false);
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === '/' || event.key === 'F1') {
        event.preventDefault();
        openPalette();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const tab = TAB_KEYS[event.key];
      if (tab !== undefined) {
        event.preventDefault();
        setActiveTab(tab);
        return;
      }

      // B/S arm the ticket's side. On a phone the ticket may not be on screen,
      // so the shortcut also reveals it — arming a toggle nobody can see is
      // worse than not binding the key at all.
      const side = SIDE_KEYS[event.key.toLowerCase()];
      if (side !== undefined) {
        event.preventDefault();
        setOrderSide(side);
        focusTicket();
        if (isMobileLayout) {
          setActiveTab('TRADE');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaletteOpen, openPalette, setOrderSide, focusTicket, isMobileLayout]);

  return (
    <>
      <TerminalLayout activeTab={activeTab} onTabChange={setActiveTab} onOpenCommand={() => openPalette()} />
      <CommandPalette
        open={isPaletteOpen}
        onClose={closePalette}
        initialValue={paletteSeed}
        onExecute={handleCommand}
      />
    </>
  );
};
/**
 * Root composition.
 *
 * The boundary sits above the provider so a fault in either the storage hook
 * or the layout still reaches the recovery view instead of blanking the page.
 * `main.tsx` already supplies `StrictMode`, which is what surfaces a leaked
 * feed interval or an orphaned canvas observer during development.
 */
const App: React.FC = () => (
  <ErrorBoundary>
    <TerminalProvider>
      <TerminalScreen />
    </TerminalProvider>
  </ErrorBoundary>
);

export default App;
