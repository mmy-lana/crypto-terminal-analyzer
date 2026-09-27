import React, { useCallback, useMemo } from 'react';

import { LiveHolding } from '../../utils/finance';
import { useTerminal } from '../../context/TerminalContext';
import { formatCurrency, formatPercent, formatQuantity, formatSignedCurrency } from '../../utils/formatters';
import { ActionButton } from '../primitives/ActionButton';
import { SparklineChart } from '../compound/SparklineChart';
import { TabularCell, TabularGrid, TabularTable } from '../primitives/TabularGrid';

export interface HoldingsTableProps {
  /** Renders the 24h sparkline column. Shown from the tablet breakpoint up. */
  showSparkline?: boolean;
  className?: string;
}

// Column widths, in the same order as the cells below. The sparkline column is
// spliced in rather than appended so it sits next to the amount it summarises.
const HOLDINGS_COLUMNS = [
  'minmax(80px, 1.2fr)', // symbol
  'minmax(70px, 1fr)', // amount
  'minmax(64px, 0.8fr)', // entry
  'minmax(70px, 1fr)', // mark
  'minmax(80px, 1fr)', // value
  'minmax(96px, 1.1fr)', // pnl
  'minmax(56px, 0.6fr)', // allocation
  'minmax(64px, 0.7fr)', // action
];
const SPARKLINE_COLUMN = 'minmax(56px, 0.8fr)';

function buildColumns(withSparkline: boolean): string {
  if (!withSparkline) return HOLDINGS_COLUMNS.join(' ');
  return [...HOLDINGS_COLUMNS.slice(0, 2), SPARKLINE_COLUMN, ...HOLDINGS_COLUMNS.slice(2)].join(' ');
}

/**
 * Open position inventory.
 *
 * Reads `livePortfolio.holdings` rather than `schema.holdings`: the schema
 * stores committed cost basis, while the live valuation re-marks every
 * position against the current tick, so a fill or a price move shows up here on
 * the same frame as the rest of the terminal.
 */
export const HoldingsTable: React.FC<HoldingsTableProps> = ({ showSparkline = false, className = '' }) => {
  const { livePortfolio, assets, selectedSymbol, setSelectedSymbol, isSubmitting } = useTerminal();

  const holdings = useMemo(
    () =>
      Object.values(livePortfolio.holdings)
        .filter((holding) => holding.amount > 0)
        .sort((a, b) => b.currentValue - a.currentValue),
    [livePortfolio.holdings]
  );

  const totalInvested = holdings.reduce((acc, holding) => acc + holding.totalCost, 0);
  const isFlat = totalInvested <= 0;

  const handleSelect = useCallback(
    (symbol: string) => {
      setSelectedSymbol(symbol);
    },
    [setSelectedSymbol]
  );

  if (holdings.length === 0) {
    return (
      <div
        className={`flex h-full min-h-[120px] flex-col items-center justify-center gap-1 p-3 text-center ${className}`}
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Flat position</span>
        <span className="max-w-[42ch] text-[11px] leading-snug text-neutral-600">
          No open holdings. Execute a buy from the ticket to open a position — cost basis and allocation appear here
          immediately.
        </span>
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <TabularTable label="Open positions" className="min-h-0 flex-1">
        <TabularGrid columns={buildColumns(showSparkline)}>
          <TabularCell header>Symbol</TabularCell>
          <TabularCell header align="right">
            Amount
          </TabularCell>
          {showSparkline ? <TabularCell header align="right">24h</TabularCell> : null}
          <TabularCell header align="right">
            Entry
          </TabularCell>
          <TabularCell header align="right">
            Mark
          </TabularCell>
          <TabularCell header align="right">
            Value
          </TabularCell>
          <TabularCell header align="right">
            P&amp;L
          </TabularCell>
          <TabularCell header align="right">
            Alloc
          </TabularCell>
          <TabularCell header align="center">
            Action
          </TabularCell>
        </TabularGrid>

        {holdings.map((holding, index) => (
          <HoldingRow
            key={holding.symbol}
            holding={holding}
            index={index}
            isSelected={holding.symbol === selectedSymbol}
            isFlat={isFlat}
            change24h={assets[holding.symbol]?.change24h ?? 0}
            sparkline={assets[holding.symbol]?.sparkline ?? []}
            showSparkline={showSparkline}
            disabled={isSubmitting}
            onSelect={handleSelect}
          />
        ))}
      </TabularTable>

      {/* Sits outside the table: a totals strip is not a row, and a bare div
          child of role="table" is invisible to the table's own semantics. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-t border-[#262c36] bg-[#0d1014] px-2 py-1 text-[10px]">
        <span className="text-neutral-600">
          {holdings.length} position{holdings.length === 1 ? '' : 's'}
        </span>
        <span className="tabular-nums text-neutral-400">
          Invested {formatCurrency(totalInvested)} · Marked {formatCurrency(livePortfolio.totalMarketValue)}
        </span>
      </div>
    </div>
  );
};

interface HoldingRowProps {
  holding: LiveHolding;
  index: number;
  isSelected: boolean;
  isFlat: boolean;
  change24h: number;
  sparkline: number[];
  showSparkline: boolean;
  disabled: boolean;
  onSelect: (symbol: string) => void;
}

const HoldingRow: React.FC<HoldingRowProps> = ({
  holding,
  index,
  isSelected,
  isFlat,
  change24h,
  sparkline,
  showSparkline,
  disabled,
  onSelect,
}) => {
  const striped = index % 2 === 1;
  const isProfit = holding.unrealizedPnL >= 0;
  const isUp = change24h >= 0;

  return (
    <TabularGrid role="row" columns={buildColumns(showSparkline)}>
      <TabularCell striped={striped} active={isSelected} rowHeader>
        <span
          className={`block min-h-[44px] min-w-0 truncate py-1 text-[11px] font-bold leading-[1.6] ${
            isSelected ? 'text-cyan-500' : 'text-neutral-100'
          }`}
          translate="no"
        >
          {holding.symbol}
        </span>
        <span className="hidden truncate text-[9px] leading-[1.6] text-neutral-600 xl:block">{holding.name}</span>
      </TabularCell>

      <TabularCell align="right" striped={striped} active={isSelected}>
        <span className="text-[11px] tabular-nums text-neutral-300">{formatQuantity(holding.amount)}</span>
      </TabularCell>

      {showSparkline ? (
        <TabularCell align="right" striped={striped} active={isSelected}>
          <span
            className="inline-flex items-center gap-1"
            title={`24h change ${formatPercent(change24h, 2)}`}
          >
            <SparklineChart
              data={sparkline}
              color={isUp ? '#10b981' : '#f43f5e'}
              showGrid={false}
              showLastPoint={false}
              viewBoxWidth={60}
              viewBoxHeight={16}
              className="!h-4 w-12"
              label={`${holding.symbol} 24h price trend`}
            />
            <span className={`text-[9px] tabular-nums ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
              {formatPercent(change24h, 1)}
            </span>
          </span>
        </TabularCell>
      ) : null}

      <TabularCell align="right" striped={striped} active={isSelected}>
        <span className="text-[11px] tabular-nums text-neutral-400">{formatCurrency(holding.averageEntryPrice)}</span>
      </TabularCell>

      <TabularCell align="right" striped={striped} active={isSelected}>
        <span className="text-[11px] tabular-nums text-cyan-500">{formatCurrency(holding.liveMarketPrice)}</span>
      </TabularCell>

      <TabularCell align="right" striped={striped} active={isSelected}>
        <span className="text-[11px] tabular-nums text-neutral-200">{formatCurrency(holding.currentValue)}</span>
      </TabularCell>

      <TabularCell align="right" striped={striped} active={isSelected}>
        <span className={`text-[11px] tabular-nums ${isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
          {formatSignedCurrency(holding.unrealizedPnL)}
        </span>
        <span className={`ml-1 text-[9px] tabular-nums ${isProfit ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
          {isFlat ? '--' : formatPercent(holding.unrealizedPnLPercent, 2)}
        </span>
      </TabularCell>

      <TabularCell align="right" striped={striped} active={isSelected}>
        <span className="text-[11px] tabular-nums text-neutral-400">
          {isFlat ? '--' : formatPercent(holding.allocationPercent, 1)}
        </span>
      </TabularCell>

      <TabularCell align="center" striped={striped} active={isSelected}>
        <ActionButton
          variant="ghost"
          className="!min-h-[44px] !min-w-[44px] !px-1 !text-[10px]"
          disabled={disabled || holding.amount <= 0}
          onClick={() => onSelect(holding.symbol)}
          aria-label={`Load ${holding.symbol} into the order ticket`}
        >
          TRADE
        </ActionButton>
      </TabularCell>
    </TabularGrid>
  );
};

export default HoldingsTable;
