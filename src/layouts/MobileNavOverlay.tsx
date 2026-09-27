import React from 'react';

import { TerminalTab } from '../types/terminal';
import { useIsMobile } from '../hooks/useMediaQuery';

export interface MobileNavOverlayProps {
  activeTab: TerminalTab;
  onTabChange: (tab: TerminalTab) => void;
  /** Badged count rendered on the positions tab. */
  positionCount?: number;
  /** Unread-style count rendered on the logs tab. */
  logCount?: number;
  className?: string;
}

/**
 * Docked tab bar for phone viewports.
 *
 * The plan's mobile matrix calls for a fixed bottom bar rather than one long
 * scrolling column, because a 360px column cannot show the watchlist, the
 * ticket and the ledger at once. Docked, the bar reserves its own safe-area
 * inset so the last row of content is never trapped behind the iOS home
 * indicator, and every target is at least 44px tall with no hover affordance.
 */
export const MobileNavOverlay: React.FC<MobileNavOverlayProps> = ({
  activeTab,
  onTabChange,
  positionCount = 0,
  logCount = 0,
  className = '',
}) => {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  const items: { tab: TerminalTab; label: string; count: number }[] = [
    { tab: 'MONITOR', label: 'MONITOR', count: 0 },
    { tab: 'TRADE', label: 'TRADE', count: 0 },
    { tab: 'ANALYTICS', label: 'POSITIONS', count: positionCount },
    { tab: 'LEDGER', label: 'LOGS', count: logCount },
  ];

  return (
    <nav
      // Named apart from the header's own nav: the two render at the same time
      // below the desktop breakpoint, and two landmarks sharing an accessible
      // name make "Terminal sections" ambiguous to anyone navigating by landmark.
      aria-label="Terminal section dock"
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-[#262c36] bg-[#0d1014]/95 pb-safe backdrop-blur-sm ${className}`}
    >
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const isActive = activeTab === item.tab;
          return (
            <li key={item.tab}>
              <button
                type="button"
                onClick={() => onTabChange(item.tab)}
                aria-current={isActive ? 'page' : undefined}
                // 52px is a deliberate overshoot of the 44px floor for a
                // thumb-reached dock; the testid records which control it is.
                data-testid={`tabbar-item-${item.tab}`}
                className={`relative flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 border-t-2 px-1 text-[10px] font-bold tracking-[0.08em] transition-colors ${
                  isActive
                    ? 'border-amber-500 bg-[#181c24] text-amber-500'
                    : 'border-transparent text-neutral-500 active:bg-[#181c24]'
                }`}
              >
                {item.label}
                {item.count > 0 ? (
                  <span className="rounded-sm bg-[#262c36] px-1 text-[9px] tabular-nums text-neutral-300">
                    {item.count}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileNavOverlay;
