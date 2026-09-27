import React, { useMemo } from 'react';

import { CryptoAsset, TerminalTab } from '../types/terminal';
import { useTerminal } from '../context/TerminalContext';
import { useIsDesktop, useIsMobile } from '../hooks/useMediaQuery';
import { formatCurrency, formatPercent, formatSignedCurrency, formatCompactNumber } from '../utils/formatters';
import { AnalyticsInspector } from '../components/domain/AnalyticsInspector';
import { ExecutionTerminal } from '../components/domain/ExecutionTerminal';
import { HoldingsTable } from '../components/domain/HoldingsTable';
import { OrderBookContainer } from '../components/domain/OrderBookContainer';
import { PortfolioSummaryPanel } from '../components/domain/PortfolioSummaryPanel';
import { TransactionLedger } from '../components/domain/TransactionLedger';
import { HeaderBar } from '../components/compound/HeaderBar';
import { SparklineChart } from '../components/compound/SparklineChart';
import { SystemLogFeed } from '../components/compound/SystemLogFeed';
import { TickerTape } from '../components/compound/TickerTape';
import { TerminalPanel } from '../components/primitives/TerminalPanel';
import { TabularCell, TabularGrid, TabularTable } from '../components/primitives/TabularGrid';
import { MobileNavOverlay } from './MobileNavOverlay';

export interface TerminalLayoutProps {
  activeTab: TerminalTab;
  onTabChange: (tab: TerminalTab) => void;
  onOpenCommand: () => void;
  className?: string;
}

const WATCHLIST_COLUMNS = 'minmax(80px, 1.2fr) minmax(84px, 1fr) minmax(70px, 0.9fr) minmax(60px, 0.7fr)';

/**
 * Market watch panel.
 *
 * Lives here rather than in its own file because the plan's component tree does
 * not list one, and it is only ever rendered as a layout cell. Every row is a
 * 44px button so the whole strip is a tap target on a phone.
 */
const WatchlistPanel: React.FC<{ showVolume: boolean }> = ({ showVolume }) => {
  const { assets, schema, selectedSymbol, setSelectedSymbol } = useTerminal();

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const ordered: CryptoAsset[] = [];
    for (const symbol of schema.watchlist) {
      const asset = assets[symbol];
      if (asset && !seen.has(symbol)) {
        seen.add(symbol);
        ordered.push(asset);
      }
    }
    for (const asset of Object.values(assets)) {
      if (!seen.has(asset.symbol)) ordered.push(asset);
    }
    return ordered;
  }, [assets, schema.watchlist]);

  return (
    <TerminalPanel
      title="MARKET WATCH // SPOT"
      hotkey="[1]"
      tone="cyan"
      statusDots
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-y-auto"
    >
      <TabularTable label="Watchlist" className="min-h-0 flex-1">
        <TabularGrid columns={WATCHLIST_COLUMNS}>
          <TabularCell header>Symbol</TabularCell>
          <TabularCell header align="right">
            Last
          </TabularCell>
          <TabularCell header align="right">
            24h
          </TabularCell>
          {showVolume ? <TabularCell header align="right">Vol</TabularCell> : null}
          <TabularCell header align="right">
            MCap
          </TabularCell>
        </TabularGrid>

        {rows.map((asset, index) => {
          const isSelected = asset.symbol === selectedSymbol;
          const isUp = asset.change24h >= 0;
          return (
            <TabularGrid key={asset.id} role="row" columns={WATCHLIST_COLUMNS}>
              <TabularCell striped={index % 2 === 1} active={isSelected}>
                <button
                  type="button"
                  onClick={() => setSelectedSymbol(asset.symbol)}
                  aria-pressed={isSelected}
                  className="flex min-h-[44px] w-full items-center gap-1.5 text-left hover:bg-[#181c24] active:bg-[#181c24]"
                  aria-label={`Select ${asset.symbol}, last ${formatCurrency(asset.currentPrice)}`}
                >
                  <SparklineChart
                    data={asset.sparkline}
                    color={isUp ? '#10b981' : '#f43f5e'}
                    showLastPoint={false}
                    viewBoxWidth={40}
                    viewBoxHeight={14}
                    className="!h-3.5 w-8 shrink-0"
                    label={`${asset.symbol} recent trend`}
                  />
                  <span
                    className={`truncate text-[11px] font-bold ${isSelected ? 'text-cyan-500' : 'text-neutral-100'}`}
                  >
                    {asset.symbol}
                  </span>
                </button>
              </TabularCell>

            <TabularCell align="right" striped={index % 2 === 1} active={isSelected}>
              <span className="text-[11px] font-bold tabular-nums text-amber-500">
                {formatCurrency(asset.currentPrice)}
              </span>
            </TabularCell>

            <TabularCell align="right" striped={index % 2 === 1} active={isSelected}>
              <span className={`text-[11px] tabular-nums ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
                {formatPercent(asset.change24h, 2)}
              </span>
            </TabularCell>

            {showVolume ? (
              <TabularCell align="right" striped={index % 2 === 1} active={isSelected}>
                <span className="text-[10px] tabular-nums text-neutral-500">
                  {formatCompactNumber(asset.volume24h, 1)}
                </span>
              </TabularCell>
            ) : null}

            <TabularCell align="right" striped={index % 2 === 1} active={isSelected}>
              <span className="text-[10px] tabular-nums text-neutral-500">
                {formatCompactNumber(asset.marketCap, 1)}
              </span>
            </TabularCell>
            </TabularGrid>
          );
        })}
      </TabularTable>
    </TerminalPanel>
  );
};

/**
 * Instrument header strip: the selected asset's full quote card.
 */
const AssetStrip: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { selectedAsset } = useTerminal();

  if (selectedAsset === null) {
    return (
      <div className={`border-b border-[#262c36] bg-[#181c24] px-2 py-2 text-[11px] text-neutral-500 ${className}`}>
        No instrument selected.
      </div>
    );
  }

  const isUp = selectedAsset.change24h >= 0;
  const rows: [string, string][] = [
    ['24H HIGH', formatCurrency(selectedAsset.high24h)],
    ['24H LOW', formatCurrency(selectedAsset.low24h)],
    ['24H VOL', formatCompactNumber(selectedAsset.volume24h, 1)],
    ['MCAP', formatCompactNumber(selectedAsset.marketCap, 1)],
  ];

  return (
    <div className={`border-b border-[#262c36] bg-[#181c24] ${className}`}>
      <div className="flex min-w-0 items-center gap-2 border-b border-[#1b2029] px-2 py-1.5">
        <span className="truncate text-[12px] font-bold text-neutral-100" translate="no">
          {selectedAsset.symbol}
        </span>
        <span className="hidden truncate text-[10px] text-neutral-500 sm:inline">{selectedAsset.name}</span>
        <span className="ml-auto shrink-0 text-[15px] font-bold tabular-nums text-amber-500">
          {formatCurrency(selectedAsset.currentPrice)}
        </span>
        <span
          className={`shrink-0 text-[11px] font-bold tabular-nums ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}
        >
          {formatPercent(selectedAsset.change24h, 2)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-[#262c36] sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-[#181c24] px-2 py-1">
            <dt className="text-[9px] uppercase tracking-[0.12em] text-neutral-600">{label}</dt>
            <dd className="text-[11px] tabular-nums text-neutral-300">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

/**
 * Responsive shell.
 *
 * Three arrangements come out of one component tree (plan §3.7 / §5):
 *   1024px+ — 3-column workstation
 *   768px+  — 2-column split, 60% analysis / 40% execution
 *   <768px  — one column at a time, selected by the docked tab bar
 *
 * Every arrangement above the phone is scoped to `activeTab`, so the header
 * tabs and the `1`-`4` hotkeys genuinely switch workspaces instead of leaving
 * the operator with four tabs and one undifferentiated wall of panels. Each tab
 * gets the panels that serve it: MONITOR watches the market, TRADE holds the
 * ticket beside the book, ANALYTICS the inspector beside the risk panel, and
 * LEDGER the full-width settlement history.
 *
 * The breakpoint comes from `matchMedia` rather than a width measured on every
 * frame, so resizing a window does not re-render the tree on each pixel.
 */
export const TerminalLayout: React.FC<TerminalLayoutProps> = ({
  activeTab,
  onTabChange,
  onOpenCommand,
  className = '',
}) => {
  const {
    livePortfolio,
    riskMetrics,
    schema,
    assets,
    setSelectedSymbol,
    resetPortfolio,
    notice,
    dismissNotice,
    storageError,
  } = useTerminal();
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();

  const openPositionCount = useMemo(
    () => Object.values(livePortfolio.holdings).filter((holding) => holding.amount > 0).length,
    [livePortfolio.holdings]
  );

  const watchlistPanel = <WatchlistPanel showVolume={!isMobile} />;
  const assetStrip = <AssetStrip />;
  const bookPanel = (
    <TerminalPanel
      title="ORDER BOOK // L2 DEPTH"
      tone="default"
      statusDots
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      <OrderBookContainer className="h-full" />
    </TerminalPanel>
  );
  const ticketPanel = (
    <TerminalPanel
      title="EXECUTION TERMINAL"
      tone="amber"
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-y-auto"
    >
      <ExecutionTerminal />
    </TerminalPanel>
  );
  const summaryPanel = (
    <TerminalPanel
      title="PORTFOLIO // RISK"
      tone="emerald"
      statusDots
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-y-auto"
    >
      <PortfolioSummaryPanel />
    </TerminalPanel>
  );
  const holdingsPanel = (
    <TerminalPanel
      title="POSITIONS"
      tone="cyan"
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      <HoldingsTable showSparkline={!isMobile} className="h-full overflow-y-auto" />
    </TerminalPanel>
  );
  const logPanel = (
    <TerminalPanel
      title="SYSTEM LOG"
      tone="default"
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      <SystemLogFeed logs={schema.logs} className="h-full" />
    </TerminalPanel>
  );
  const ledgerPanel = (
    <TerminalPanel
      title="TRANSACTION LEDGER"
      tone="default"
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      <TransactionLedger className="h-full" />
    </TerminalPanel>
  );
  const analyticsPanel = (
    <TerminalPanel
      title="ANALYTICS INSPECTOR"
      tone="cyan"
      statusDots
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      <AnalyticsInspector className="h-full" />
    </TerminalPanel>
  );

  const chrome = (
    <>
      <HeaderBar
        equity={livePortfolio.totalEquity}
        cashBalance={schema.cashBalance}
        unrealizedPnL={livePortfolio.unrealizedPnL}
        unrealizedPnLPercent={livePortfolio.unrealizedPnLPercent}
        activeTab={activeTab}
        onTabShortcut={onTabChange}
        onOpenCommand={onOpenCommand}
        onReset={() => {
          if (window.confirm('Wipe the paper ledger and reseed the starting allocation?')) {
            resetPortfolio();
          }
        }}
      />
      <TickerTape
        assets={assets}
        watchlist={schema.watchlist}
        onSelect={(symbol) => {
          setSelectedSymbol(symbol);
          // On a phone the tape is a navigation affordance as much as a readout.
          onTabChange('TRADE');
        }}
      />
    </>
  );

  return (
    <div
      className={`relative flex min-h-dvh flex-col bg-[#0a0b0d] text-neutral-100 [padding-top:env(safe-area-inset-top,0px)] ${className}`}
    >
      <div className="scanline-overlay" aria-hidden="true" />
      <div className="vignette-overlay" aria-hidden="true" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {chrome}

        {storageError !== null ? (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-rose-500/50 bg-rose-500/15 px-2 py-1.5 text-[10px] text-rose-500"
          >
            <span className="shrink-0 font-bold tracking-[0.12em]">STORAGE</span>
            <span className="min-w-0 flex-1 break-words">{storageError}</span>
          </div>
        ) : null}

        {notice !== null ? (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center gap-2 border-b px-2 py-1.5 text-[10px] ${
              notice.level === 'WARN'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-500'
                : notice.level === 'EXEC'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                  : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-500'
            }`}
          >
            <span className="font-bold tracking-[0.12em]">{notice.level}</span>
            <span className="min-w-0 flex-1 break-words">{notice.message}</span>
            <button
              type="button"
              onClick={dismissNotice}
              aria-label="Dismiss notification"
              className="min-h-[24px] shrink-0 px-1 text-[11px] font-bold opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ) : null}

        <main className="flex min-h-0 flex-1 flex-col">
          {isMobile ? (
            <div className="flex flex-1 flex-col gap-px pb-[calc(52px+env(safe-area-inset-bottom,0px))]">
              {activeTab === 'MONITOR' ? (
                <>
                  {assetStrip}
                  {watchlistPanel}
                  <div className="h-[420px] shrink-0">{bookPanel}</div>
                </>
              ) : null}
              {activeTab === 'TRADE' ? (
                <>
                  {assetStrip}
                  {ticketPanel}
                  {logPanel}
                </>
              ) : null}
              {activeTab === 'ANALYTICS' ? (
                <>
                  {summaryPanel}
                  {holdingsPanel}
                  {analyticsPanel}
                </>
              ) : null}
              {activeTab === 'LEDGER' ? (
                <>
                  {ledgerPanel}
                  {logPanel}
                </>
              ) : null}
            </div>
          ) : isDesktop ? (
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-px overflow-hidden">
              {activeTab === 'MONITOR' ? (
                <>
                  <div className="flex min-h-0 flex-col gap-px">
                    {assetStrip}
                    <div className="flex min-h-0 flex-1 flex-col">{watchlistPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{bookPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{holdingsPanel}</div>
                    <div className="flex min-h-0 flex-1 flex-col">{summaryPanel}</div>
                  </div>
                </>
              ) : activeTab === 'TRADE' ? (
                <>
                  <div className="flex min-h-0 flex-col gap-px">
                    {assetStrip}
                    <div className="flex min-h-0 flex-1 flex-col">{watchlistPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{bookPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-[1.2] flex-col">{ticketPanel}</div>
                    <div className="flex min-h-0 flex-1 flex-col">{logPanel}</div>
                  </div>
                </>
              ) : activeTab === 'ANALYTICS' ? (
                <>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{summaryPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{analyticsPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{holdingsPanel}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="col-span-2 flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{ledgerPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{logPanel}</div>
                    <div className="flex min-h-0 flex-1 flex-col">{summaryPanel}</div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-px overflow-hidden">
              {activeTab === 'MONITOR' ? (
                <>
                  <div className="flex min-h-0 flex-col gap-px">
                    {assetStrip}
                    <div className="flex min-h-0 flex-1 flex-col">{watchlistPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{bookPanel}</div>
                    <div className="flex min-h-0 flex-1 flex-col">{holdingsPanel}</div>
                  </div>
                </>
              ) : activeTab === 'TRADE' ? (
                <>
                  <div className="flex min-h-0 flex-col gap-px">
                    {assetStrip}
                    <div className="flex min-h-0 flex-1 flex-col">{bookPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{ticketPanel}</div>
                    <div className="flex min-h-0 flex-1 flex-col">{logPanel}</div>
                  </div>
                </>
              ) : activeTab === 'ANALYTICS' ? (
                <>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{summaryPanel}</div>
                    <div className="flex min-h-0 flex-1 flex-col">{analyticsPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{holdingsPanel}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{ledgerPanel}</div>
                  </div>
                  <div className="flex min-h-0 flex-col gap-px">
                    <div className="flex min-h-0 flex-1 flex-col">{logPanel}</div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <MobileNavOverlay
        activeTab={activeTab}
        onTabChange={onTabChange}
        positionCount={openPositionCount}
        logCount={schema.logs.length}
      />

      <p className="sr-only" role="status" aria-live="polite">
        Account equity {formatCurrency(riskMetrics.totalEquity)}, cash {formatCurrency(riskMetrics.cashBalance)},
        unrealized {formatSignedCurrency(riskMetrics.unrealizedPnL)}.
      </p>
    </div>
  );
};

export default TerminalLayout;
