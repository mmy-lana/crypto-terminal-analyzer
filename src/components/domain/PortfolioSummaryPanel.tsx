import React, { useMemo } from 'react';

import { useTerminal } from '../../context/TerminalContext';
import { reconstructLedger } from '../../utils/finance';
import {
  formatCurrency,
  formatPercent,
  formatRatio,
  formatSignedCurrency,
  NULL_PLACEHOLDER,
  INFINITY_GLYPH,
} from '../../utils/formatters';
import { MetricCell } from '../primitives/MetricCell';
import { SparklineChart } from '../compound/SparklineChart';

export interface PortfolioSummaryPanelProps {
  className?: string;
}

/**
 * Risk and performance console.
 *
 * Live mark-to-market numbers come from `livePortfolio` (which re-prices every
 * holding on each tick), while the path-dependent statistics — Sharpe, drawdown,
 * win rate, profit factor — are reconstructed by replaying the settled
 * transaction ledger. Mixing the two sources would be wrong: the ledger is the
 * only record of realised history.
 */
export const PortfolioSummaryPanel: React.FC<PortfolioSummaryPanelProps> = ({ className = '' }) => {
  const { livePortfolio, riskMetrics, schema } = useTerminal();

  const reconstruction = useMemo(() => reconstructLedger(schema.transactions, schema.initialDeposit), [schema]);

  const isFlat = livePortfolio.totalEquity <= 0;
  const hasHistory = reconstruction.tradeCount > 0;
  const totalPnlIsPositive = riskMetrics.totalPnL >= 0;

  const drawdown = useMemo(() => {
    if (reconstruction.equityCurve.length < 2) return null;
    const curve = reconstruction.equityCurve;
    const maxDrawdownPercent = riskMetrics.maxDrawdownPercent;
    if (maxDrawdownPercent <= 0) return null;
    return { curve, maxDrawdownPercent };
  }, [reconstruction.equityCurve, riskMetrics.maxDrawdownPercent]);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-[#262c36] bg-[#262c36]">
        <MetricCell
          label="Total equity"
          value={isFlat ? NULL_PLACEHOLDER : formatCurrency(livePortfolio.totalEquity)}
          secondary={`Cash ${formatCurrency(schema.cashBalance)}`}
          tone="amber"
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Unrealized P&L"
          value={formatSignedCurrency(livePortfolio.unrealizedPnL)}
          secondary={isFlat ? 'No open positions' : formatPercent(livePortfolio.unrealizedPnLPercent, 2)}
          tone={livePortfolio.unrealizedPnL >= 0 ? 'emerald' : 'rose'}
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Realized P&L"
          value={hasHistory ? formatSignedCurrency(reconstruction.realizedPnL) : NULL_PLACEHOLDER}
          secondary={`${reconstruction.tradeCount} closed round trip${reconstruction.tradeCount === 1 ? '' : 's'}`}
          tone={reconstruction.realizedPnL >= 0 ? 'emerald' : 'rose'}
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Total P&L"
          value={formatSignedCurrency(riskMetrics.totalPnL)}
          secondary={`vs ${formatCurrency(schema.initialDeposit)} deposit`}
          tone={totalPnlIsPositive ? 'emerald' : 'rose'}
          className="bg-[#12151a]"
        />
      </div>

      <div className="shrink-0 border-b border-[#262c36] px-2 py-1.5">
        <div className="flex items-center justify-between">
          {/* Real heading: TerminalPanel titles every panel with an <h2>, so this
              section is an <h3> — the same level AnalyticsInspector uses for its
              own sub-sections. It gives the sparkline below it a navigable
              name; the metrics around it are per-tick values and stay out of
              the tree as live regions. */}
          <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-500">Equity path</h3>
          <span className="text-[9px] tabular-nums text-neutral-600">
            {reconstruction.equityCurve.length} settlement{reconstruction.equityCurve.length === 1 ? '' : 's'}
          </span>
        </div>
        <SparklineChart
          data={reconstruction.equityCurve}
          color={reconstruction.realizedPnL >= 0 ? '#10b981' : '#f43f5e'}
          showGrid
          showLastPoint
          className="mt-1 h-10"
          label="Account equity after each settlement"
        />
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-px bg-[#262c36]">
        <MetricCell
          label="Sharpe"
          value={hasHistory && Number.isFinite(riskMetrics.sharpeRatio) ? formatRatio(riskMetrics.sharpeRatio, 2) : NULL_PLACEHOLDER}
          secondary="Daily, rf 0.01%"
          tone="cyan"
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Max drawdown"
          value={hasHistory ? formatPercent(-riskMetrics.maxDrawdownPercent, 2) : NULL_PLACEHOLDER}
          secondary={drawdown === null ? 'Needs ≥ 2 settlements' : `Peak to trough`}
          tone={riskMetrics.maxDrawdownPercent > 10 ? 'rose' : 'neutral'}
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Win rate"
          value={hasHistory ? formatPercent(riskMetrics.winRatePercent, 1) : NULL_PLACEHOLDER}
          secondary={`${reconstruction.winCount}W / ${reconstruction.lossCount}L`}
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Profit factor"
          value={
            hasHistory
              ? riskMetrics.profitFactor === Number.POSITIVE_INFINITY
                ? INFINITY_GLYPH
                : formatRatio(riskMetrics.profitFactor, 2)
              : NULL_PLACEHOLDER
          }
          secondary="Gross win / gross loss"
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Daily volatility"
          value={hasHistory ? formatPercent(riskMetrics.volatilityDaily, 3) : NULL_PLACEHOLDER}
          secondary="Std dev of returns"
          className="bg-[#12151a]"
        />
        <MetricCell
          label="Fees paid"
          value={hasHistory ? formatCurrency(reconstruction.totalFees, 2) : NULL_PLACEHOLDER}
          secondary={`${riskMetrics.totalTradesCount} execution${riskMetrics.totalTradesCount === 1 ? '' : 's'}`}
          tone="amber"
          className="bg-[#12151a]"
        />
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-px border-t border-[#262c36] bg-[#262c36]">
        <MetricCell
          label="Largest win"
          value={hasHistory ? formatSignedCurrency(riskMetrics.largestWin) : NULL_PLACEHOLDER}
          tone="emerald"
          className="bg-[#0d1014]"
        />
        <MetricCell
          label="Largest loss"
          value={hasHistory ? formatSignedCurrency(riskMetrics.largestLoss) : NULL_PLACEHOLDER}
          tone="rose"
          className="bg-[#0d1014]"
        />
      </div>

      {reconstruction.tradeCount === 0 ? (
        <p className="min-h-0 flex-1 px-2 py-2 text-[10px] leading-snug text-neutral-600">
          Risk statistics are derived by replaying the settlement ledger. Execute and close at least one round trip to
          populate Sharpe, drawdown and win rate.
        </p>
      ) : null}
    </div>
  );
};

export default PortfolioSummaryPanel;
