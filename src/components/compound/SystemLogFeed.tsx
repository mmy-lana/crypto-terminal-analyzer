import React, { useEffect, useMemo, useRef, useState } from 'react';

import { formatUtcClock } from '../../utils/formatters';
import { LogLevel, SystemLogEntry } from '../../types/terminal';

export interface SystemLogFeedProps {
  logs: SystemLogEntry[];
  /** Lines kept in the DOM. Older lines are dropped, not just hidden. */
  limit?: number;
  className?: string;
}

const LEVEL_STYLES: Record<LogLevel, { text: string; tag: string }> = {
  EXEC: { text: 'text-emerald-500', tag: 'text-cyan-500' },
  INFO: { text: 'text-neutral-300', tag: 'text-neutral-500' },
  WARN: { text: 'text-amber-500', tag: 'text-amber-500' },
  SYS: { text: 'text-cyan-500', tag: 'text-cyan-500' },
};

/**
 * Scrolling execution console.
 *
 * Auto-scroll follows the tail only while the operator is already at the
 * bottom; scrolling up to read a fill immediately pins the view and the feed
 * stops yanking it away. A new entry near the tail flashes once so an
 * execution is noticeable even in a fast burst.
 */
export const SystemLogFeed: React.FC<SystemLogFeedProps> = ({ logs, limit = 200, className = '' }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [flashId, setFlashId] = useState<string | null>(null);

  const visible = useMemo(() => logs.slice(0, Math.max(1, limit)), [logs, limit]);
  const newestId = visible[0]?.id ?? null;

  const handleScroll = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    pinnedRef.current = distanceFromBottom <= 24;
  };

  const scrollToTail = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  };

  useEffect(() => {
    if (pinnedRef.current) {
      scrollToTail();
    }
    if (newestId) {
      setFlashId(newestId);
    }
  }, [newestId, logs.length]);

  // Clear the flash so an identical id arriving later still animates.
  useEffect(() => {
    if (!flashId) return;
    const timer = window.setTimeout(() => setFlashId(null), 700);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  // The empty state lives *inside* the log region, never in place of it: a live
  // region that mounts already full of lines announces none of them, and one
  // that is swapped out while empty is destroyed the moment it is needed.
  // Rendering the container unconditionally keeps it in the accessibility tree
  // before the first line arrives.
  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="System execution log"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
      >
        {logs.length === 0 ? (
          <p className="flex h-full min-h-[80px] items-center justify-center px-2 text-center text-[10px] uppercase tracking-[0.14em] text-neutral-600">
            No system events recorded
          </p>
        ) : (
          <ul className="divide-y divide-[#1b2029]">
            {visible.map((entry) => {
              const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.INFO;
              const isFlashing = entry.id === flashId;

              return (
                <li
                  key={entry.id}
                  className={`flex items-start gap-2 px-2 py-1 text-[10px] leading-snug ${
                    isFlashing ? 'animate-exec-flash' : ''
                  }`}
                >
                  <time className="shrink-0 tabular-nums text-neutral-600" dateTime={entry.timestamp}>
                    {formatUtcClock(entry.timestamp)}
                  </time>
                  <span className={`w-[52px] shrink-0 font-bold tracking-[0.06em] ${style.tag}`}>{entry.level}</span>
                  <span className="hidden w-[84px] shrink-0 truncate text-neutral-600 sm:inline">{entry.source}</span>
                  <span className={`min-w-0 flex-1 break-words ${style.text}`}>{entry.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[#262c36] px-2 py-1 text-[9px] uppercase tracking-[0.12em]">
        <span className="text-neutral-600">
          {visible.length} / {logs.length} events
        </span>
        <button
          type="button"
          onClick={() => {
            pinnedRef.current = true;
            scrollToTail();
          }}
          className="min-h-[24px] px-1 text-cyan-500 transition-colors hover:text-cyan-400"
        >
          ↓ Tail
        </button>
      </div>
    </div>
  );
};

export default SystemLogFeed;
