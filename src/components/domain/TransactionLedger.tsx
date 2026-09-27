import React, { useCallback, useMemo, useState } from 'react';

import { OrderSide } from '../../types/terminal';
import { useTerminal } from '../../context/TerminalContext';
import { orderTransactionsByTime } from '../../utils/finance';
import { formatCurrency, formatQuantity, formatUtcDateTime } from '../../utils/formatters';
import { ActionButton } from '../primitives/ActionButton';
import { SideBadge } from '../primitives/TerminalBadge';
import { TabularCell, TabularGrid, TabularRowGroup, TabularTable } from '../primitives/TabularGrid';

export interface TransactionLedgerProps {
  className?: string;
}

type SideFilter = 'ALL' | OrderSide;
type Order_ = 'newest' | 'oldest';

const LEDGER_COLUMNS =
  'minmax(80px, 1fr) minmax(70px, 1fr) minmax(80px, 1fr) minmax(70px, 1fr) minmax(60px, 1fr) minmax(90px, 1fr)';

const SIDE_FILTERS: SideFilter[] = ['ALL', 'BUY', 'SELL'];

/** CSV fields match the visible columns so an export is a faithful copy. */
const CSV_HEADER = ['Timestamp', 'Order', 'Side', 'Symbol', 'Amount', 'Price', 'Notional', 'Fee'] as const;

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Settled execution history.
 *
 * Every fill the engine commits lands here, which makes this the audit trail
 * for the risk statistics in the summary panel. Export writes a real CSV
 * download rather than opening a dead button.
 */
export const TransactionLedger: React.FC<TransactionLedgerProps> = ({ className = '' }) => {
  const { schema } = useTerminal();
  const [sideFilter, setSideFilter] = useState<SideFilter>('ALL');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<Order_>('newest');
  const [exportState, setExportState] = useState<'idle' | 'done' | 'failed'>('idle');

  const symbols = useMemo(() => {
    const unique = new Set(schema.transactions.map((tx) => tx.symbol));
    return ['ALL', ...[...unique].sort()];
  }, [schema.transactions]);

  const rows = useMemo(() => {
    const filtered = schema.transactions.filter(
      (tx) => (sideFilter === 'ALL' || tx.side === sideFilter) && (symbolFilter === 'ALL' || tx.symbol === symbolFilter)
    );
    return orderTransactionsByTime(filtered, sortOrder);
  }, [schema.transactions, sideFilter, symbolFilter, sortOrder]);

  const totalFees = useMemo(
    () => rows.reduce((acc, tx) => acc + tx.fee, 0),
    [rows]
  );
  const netNotional = useMemo(
    () => rows.reduce((acc, tx) => acc + (tx.side === 'BUY' ? -tx.totalValue : tx.totalValue), 0),
    [rows]
  );

  const handleExport = useCallback(() => {
    if (rows.length === 0) {
      setExportState('failed');
      return;
    }

    const lines = [
      CSV_HEADER.join(','),
      ...rows.map((tx) =>
        [
          tx.timestamp,
          tx.orderId,
          tx.side,
          tx.symbol,
          String(tx.amount),
          String(tx.executionPrice),
          String(tx.totalValue),
          String(tx.fee),
        ]
          .map((field) => escapeCsvField(field))
          .join(',')
      ),
    ];

    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `terminal-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setExportState('done');
  }, [rows]);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#262c36] px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {SIDE_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setSideFilter(filter)}
              aria-pressed={sideFilter === filter}
              className={`min-h-[32px] border px-2 text-[10px] font-bold tracking-[0.1em] transition-colors ${
                sideFilter === filter
                  ? 'border-amber-500/60 bg-[#181c24] text-amber-500'
                  : 'border-[#262c36] text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        <label className="flex min-h-[32px] items-center gap-1 border border-[#262c36] bg-[#0a0b0d] px-1 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500/40">
          <span className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">Sym</span>
          <select
            name="ledger-symbol-filter"
            value={symbolFilter}
            onChange={(event) => setSymbolFilter(event.target.value)}
            // The visible "Sym" caption is repeated inside the name so the
            // label the operator reads is the label they hear.
            aria-label="Sym — filter ledger by symbol"
            autoComplete="off"
            className="min-h-[30px] bg-transparent font-mono text-[11px] text-neutral-200 outline-none"
          >
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol} className="bg-[#12151a]">
                {symbol}
              </option>
            ))}
          </select>
        </label>

        <ActionButton
          variant="ghost"
          className="!min-h-[32px] !px-2 !text-[10px]"
          onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
          // The name quotes the visible text verbatim and then says what the
          // press will do — a name that contradicts the label is a trap.
          aria-label={
            sortOrder === 'newest'
              ? 'Sort ledger: ▼ Newest, activate for oldest first'
              : 'Sort ledger: ▲ Oldest, activate for newest first'
          }
        >
          {sortOrder === 'newest' ? '▼ Newest' : '▲ Oldest'}
        </ActionButton>

        <ActionButton
          variant="terminal"
          className="!min-h-[32px] !px-2 !text-[10px]"
          onClick={handleExport}
          // Never disabled: an empty ledger is a state to report, not a reason
          // to remove the control, which would make the status line dead UI.
        >
          EXPORT CSV
        </ActionButton>

        <span className="ml-auto text-[9px] tabular-nums text-neutral-600" role="status" aria-live="polite">
          {exportState === 'done' ? 'CSV downloaded' : exportState === 'failed' ? 'Nothing to export' : ''}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center gap-1 p-3 text-center">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Ledger empty</span>
          <span className="max-w-[44ch] text-[11px] leading-snug text-neutral-600">
            {schema.transactions.length === 0
              ? 'No executions yet. Every filled order is recorded here with its fee and timestamp.'
              : 'No rows match the current filters.'}
          </span>
        </div>
      ) : (
        <TabularTable label="Settled executions" className="min-h-0 flex-1">
          <TabularGrid columns={LEDGER_COLUMNS}>
            <TabularCell header>Time</TabularCell>
            <TabularCell header align="center">
              Side
            </TabularCell>
            <TabularCell header>Symbol</TabularCell>
            <TabularCell header align="right">
              Amount
            </TabularCell>
            <TabularCell header align="right">
              Price
            </TabularCell>
            <TabularCell header align="right">
              Notional
            </TabularCell>
            <TabularCell header align="right">
              Fee
            </TabularCell>
          </TabularGrid>

          {/* The table owns the horizontal scroller, so the header and the body
              never drift apart; this group only scrolls vertically. Its own
              floor matches the grid's, which keeps the group from becoming a
              second horizontal scroller underneath the table. */}
          <TabularRowGroup className="scrollbar-thin min-h-0 min-w-[360px] flex-1 overflow-y-auto">
            {rows.map((tx, index) => (
              <TabularGrid key={tx.id} columns={LEDGER_COLUMNS}>
                <TabularCell striped={index % 2 === 1}>
                  <span className="text-[10px] tabular-nums text-neutral-500">{formatUtcDateTime(tx.timestamp)}</span>
                </TabularCell>
                <TabularCell align="center" striped={index % 2 === 1}>
                  <SideBadge side={tx.side} />
                </TabularCell>
                <TabularCell striped={index % 2 === 1}>
                  {/* Identifiers, not prose: a translator must not "translate" them. */}
                  <span translate="no" className="text-[11px] font-bold text-neutral-200">
                    {tx.symbol}
                  </span>
                  <span translate="no" className="ml-1 hidden text-[9px] text-neutral-600 lg:inline">
                    {tx.orderId}
                  </span>
                </TabularCell>
                <TabularCell align="right" striped={index % 2 === 1}>
                  <span className="text-[11px] tabular-nums text-neutral-300">{formatQuantity(tx.amount)}</span>
                </TabularCell>
                <TabularCell align="right" striped={index % 2 === 1}>
                  <span className="text-[11px] tabular-nums text-cyan-500">{formatCurrency(tx.executionPrice)}</span>
                </TabularCell>
                <TabularCell align="right" striped={index % 2 === 1}>
                  <span className="text-[11px] tabular-nums text-neutral-200">{formatCurrency(tx.totalValue)}</span>
                </TabularCell>
                <TabularCell align="right" striped={index % 2 === 1}>
                  <span className="text-[10px] tabular-nums text-amber-500/80">{formatCurrency(tx.fee, 2)}</span>
                </TabularCell>
              </TabularGrid>
            ))}
          </TabularRowGroup>
        </TabularTable>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-t border-[#262c36] bg-[#0d1014] px-2 py-1 text-[10px]">
        <span className="tabular-nums text-neutral-600">
          {rows.length} of {schema.transactions.length} executions
        </span>
        <span className="tabular-nums text-neutral-400">
          Net {formatCurrency(netNotional)} · Fees {formatCurrency(totalFees, 2)}
        </span>
      </div>
    </div>
  );
};

export default TransactionLedger;
