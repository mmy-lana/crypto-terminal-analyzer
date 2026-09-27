import React, { useMemo } from 'react';

import { useTerminal } from '../../context/TerminalContext';
import {
  calculateDrawdownSeries,
  calculatePearsonCorrelation,
  calculateReturnSeries,
  reconstructLedger,
} from '../../utils/finance';
import { formatCurrency, formatPercent, NULL_PLACEHOLDER } from '../../utils/formatters';
import { MetricCell } from '../primitives/MetricCell';
import { SparklineChart } from '../compound/SparklineChart';
import { TabularCell, TabularGrid, TabularTable } from '../primitives/TabularGrid';

export interface AnalyticsInspectorProps {
  className?: string;
}

const DONUT_SEGMENTS = [
  { color: '#d97706', label: 'Cash' },
  { color: '#06b6d4', label: 'BTC' },
  { color: '#10b981', label: 'ETH' },
  { color: '#f59e0b', label: 'SOL' },
  { color: '#8b5cf6', label: 'Other' },
] as const;

const CORRELATION_COLUMNS = 'minmax(60px, 1fr) repeat(3, minmax(52px, 1fr))';
const RADIUS = 34;
const STROKE_WIDTH = 11;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface AllocationSlice {
  label: string;
  percent: number;
  value: number;
  color: string;
}

function correlationTone(value: number): string {
  if (value >= 0.7) return 'text-emerald-500';
  if (value >= 0.3) return 'text-cyan-500';
  if (value > -0.3) return 'text-neutral-400';
  if (value > -0.7) return 'text-amber-500';
  return 'text-rose-500';
}

/**
 * Fixed-width signed correlation at two decimals.
 *
 * Always carries an explicit sign so the column aligns on the sign glyph
 * rather than on a ragged mix of `0.91` and `-0.88`, and always two decimals
 * so the matrix columns stay in register.
 */
function formatCorrelation(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
}

/**
 * Portfolio analytics: allocation, correlation and drawdown.
 *
 * Every figure is derived from data already in the terminal — live holdings
 * for allocation, the tick's sparkline series for correlation, and the
 * replayed settlement ledger for the drawdown curve. Nothing here invents
 * numbers, and each section degrades to an explicit empty state rather than
 * rendering a zero that would read like a real measurement.
 */
export const AnalyticsInspector: React.FC<AnalyticsInspectorProps> = ({ className = '' }) => {
  const { livePortfolio, riskMetrics, schema, assets, selectedSymbol } = useTerminal();

  const allocation = useMemo<AllocationSlice[]>(() => {
    const slices: AllocationSlice[] = [
      { label: 'Cash', percent: 0, value: Math.max(0, schema.cashBalance), color: DONUT_SEGMENTS[0].color },
    ];

    const holdings = Object.values(livePortfolio.holdings)
      .filter((holding) => holding.amount > 0)
      .sort((a, b) => b.currentValue - a.currentValue);

    holdings.forEach((holding, index) => {
      slices.push({
        label: holding.symbol,
        percent: holding.allocationPercent,
        value: holding.currentValue,
        color: DONUT_SEGMENTS[index < 3 ? index + 1 : 4]?.color ?? '#8b5cf6',
      });
    });

    // Anything past the three named series is pooled so the ring always sums
    // to 100% instead of silently dropping the tail.
    if (holdings.length > 3) {
      const tail = holdings.slice(3);
      const tailValue = tail.reduce((acc, holding) => acc + holding.currentValue, 0);
      const tailPercent = tail.reduce((acc, holding) => acc + holding.allocationPercent, 0);
      slices.push({ label: 'Other', percent: tailPercent, value: tailValue, color: DONUT_SEGMENTS[4].color });
    }

    return slices.filter((slice) => slice.value > 0);
  }, [livePortfolio.holdings, schema.cashBalance]);

  const equityCurve = useMemo(
    () => reconstructLedger(schema.transactions, schema.initialDeposit).equityCurve,
    [schema.transactions, schema.initialDeposit]
  );
  const drawdownSeries = useMemo(() => calculateDrawdownSeries(equityCurve), [equityCurve]);

  const correlationSymbols = useMemo(() => {
    const pool = schema.watchlist.length > 0 ? schema.watchlist : Object.keys(assets);
    return pool.filter((symbol) => (assets[symbol]?.sparkline.length ?? 0) > 1).slice(0, 3);
  }, [schema.watchlist, assets]);

  const returnSeries = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const symbol of correlationSymbols) {
      const sparkline = assets[symbol]?.sparkline ?? [];
      map[symbol] = calculateReturnSeries(sparkline);
    }
    return map;
  }, [correlationSymbols, assets]);

  const hasAllocation = allocation.length > 0 && livePortfolio.totalEquity > 0;
  const hasHistory = equityCurve.length > 1;

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-[#262c36] bg-[#262c36]">
        <MetricCell
          label="Account equity"
          value={formatCurrency(livePortfolio.totalEquity)}
          secondary={`${schema.transactions.length} executions`}
          tone="amber"
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Concentration"
          value={
            allocation.length > 1
              ? formatPercent(Math.max(...allocation.map((slice) => slice.percent)), 1)
              : NULL_PLACEHOLDER
          }
          secondary="Largest single weight"
          tone="cyan"
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Peak drawdown"
          value={hasHistory ? formatPercent(-riskMetrics.maxDrawdownPercent, 2) : NULL_PLACEHOLDER}
          secondary={hasHistory ? `Recovered ${formatPercent(riskMetrics.totalPnLPercent, 2)} net` : 'Needs history'}
          tone={riskMetrics.maxDrawdownPercent > 10 ? 'rose' : 'neutral'}
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Cash weight"
          value={hasAllocation ? formatPercent(allocation[0]?.percent ?? 0, 1) : NULL_PLACEHOLDER}
          secondary="Deployable margin"
          className="bg-[#12151a]"
        />
      </div>

      <section className="shrink-0 border-b border-[#262c36] px-2 py-2">
        <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-500">Allocation</h3>

        {!hasAllocation ? (
          <p className="py-2 text-[10px] leading-snug text-neutral-600">
            No capital to allocate yet. The ring appears once cash or an open position exists.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <svg
              viewBox="0 0 100 100"
              className="h-[92px] w-[92px] shrink-0 -rotate-90"
              role="img"
              aria-label="Capital allocation by asset"
            >
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke="#181c24"
                strokeWidth={STROKE_WIDTH}
              />
              {(() => {
                let offset = 0;
                return allocation.map((slice) => {
                  const fraction = Math.max(0, Math.min(1, slice.percent / 100));
                  const dash = fraction * CIRCUMFERENCE;
                  const element = (
                    <circle
                      key={slice.label}
                      cx="50"
                      cy="50"
                      r={RADIUS}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={STROKE_WIDTH}
                      strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                      strokeDashoffset={-offset}
                    />
                  );
                  offset += dash;
                  return element;
                });
              })()}
            </svg>

            <ul className="min-w-0 flex-1 space-y-1">
              {allocation.map((slice) => (
                <li key={slice.label} className="flex items-center gap-1.5 text-[10px]">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-neutral-300">{slice.label}</span>
                  <span className="shrink-0 tabular-nums text-neutral-500">{formatCurrency(slice.value, 0)}</span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-neutral-200">
                    {formatPercent(slice.percent, 1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto border-b border-[#262c36]">
        <h3 className="px-2 pt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-500">
          Return correlation · {selectedSymbol} selected
        </h3>

        {correlationSymbols.length < 2 ? (
          <p className="px-2 py-2 text-[10px] leading-snug text-neutral-600">
            Correlation needs at least two instruments with price history.
          </p>
        ) : (
          <div className="p-2">
            <TabularTable label="Return correlation matrix">
              <TabularGrid role="row" columns={CORRELATION_COLUMNS}>
                <TabularCell header>
                  <span className="sr-only">Instrument</span>
                </TabularCell>
                {correlationSymbols.map((symbol) => (
                  <TabularCell key={`h-${symbol}`} header align="right">
                    {symbol}
                  </TabularCell>
                ))}
              </TabularGrid>

              {correlationSymbols.map((rowSymbol) => (
                <TabularGrid key={`row-${rowSymbol}`} role="row" columns={CORRELATION_COLUMNS}>
                  <TabularCell rowHeader>
                    <span className="text-[10px] text-neutral-300" translate="no">
                      {rowSymbol}
                    </span>
                  </TabularCell>
                  {correlationSymbols.map((columnSymbol) => {
                    const value =
                      rowSymbol === columnSymbol
                        ? 1
                        : calculatePearsonCorrelation(
                            returnSeries[rowSymbol] ?? [],
                            returnSeries[columnSymbol] ?? []
                          );
                    return (
                      <TabularCell key={`${rowSymbol}-${columnSymbol}`} align="right">
                        <span
                          className={`text-[10px] tabular-nums ${correlationTone(value)} ${
                            rowSymbol === columnSymbol ? 'opacity-40' : ''
                          }`}
                          title={`ρ(${rowSymbol}, ${columnSymbol}) = ${value.toFixed(3)}`}
                        >
                          {rowSymbol === columnSymbol ? '1.00' : formatCorrelation(value)}
                        </span>
                      </TabularCell>
                    );
                  })}
                </TabularGrid>
              ))}
            </TabularTable>
            <p className="mt-1 text-[9px] leading-snug text-neutral-600">
              Pearson ρ over the sampled 24h return series. Values near ±1 mean the two move together.
            </p>
          </div>
        )}
      </section>

      <section className="shrink-0 px-2 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-500">Drawdown</h3>
          <span className="text-[9px] tabular-nums text-neutral-600">
            {hasHistory ? `${drawdownSeries.length} points` : 'Awaiting settlements'}
          </span>
        </div>
        {hasHistory ? (
          <>
            <SparklineChart
              data={drawdownSeries}
              color="#f43f5e"
              showGrid={false}
              showLastPoint={false}
              viewBoxWidth={100}
              viewBoxHeight={24}
              className="mt-1 h-6"
              label="Drawdown from peak equity"
            />
            <p className="mt-1 text-[9px] tabular-nums text-neutral-600">
              Worst {formatPercent(-riskMetrics.maxDrawdownPercent, 2)} below the running peak equity.
            </p>
          </>
        ) : (
          <p className="py-1.5 text-[10px] leading-snug text-neutral-600">
            Execute a fill to start the equity curve. Drawdown is measured from the settlement history.
          </p>
        )}
      </section>
    </div>
  );
};

export default AnalyticsInspector;
