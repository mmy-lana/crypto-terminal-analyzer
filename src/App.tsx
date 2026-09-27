import React, { useState } from 'react';
import { TerminalProvider, useTerminal } from './context/TerminalContext';
import { formatCurrency, formatPercent } from './utils/formatters';

const TerminalScreen: React.FC = () => {
  const { assets, livePortfolio, selectedAsset, setSelectedSymbol, executeTrade, isSubmitting } = useTerminal();
  const [tradeAmount, setTradeAmount] = useState<string>('0.1');

  const handleQuickBuy = async () => {
    if (!selectedAsset) return;
    const amount = parseFloat(tradeAmount);
    if (isNaN(amount) || amount <= 0) return;
    await executeTrade(selectedAsset, 'BUY', amount);
  };

  const handleQuickSell = async () => {
    if (!selectedAsset) return;
    const amount = parseFloat(tradeAmount);
    if (isNaN(amount) || amount <= 0) return;
    await executeTrade(selectedAsset, 'SELL', amount);
  };

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-neutral-200 flex flex-col font-mono text-xs select-none">
      <header className="border-b border-[#262c36] bg-[#12151a] px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="bg-amber-500 text-black px-1.5 py-0.5 font-bold tracking-wider text-[11px]">
            BLOOMBERG // CRYPTO
          </span>
          <span className="text-neutral-400">PAPER TERMINAL ONLINE</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <div>
            <span className="text-neutral-500 mr-1">EQUITY:</span>
            <span className="font-bold text-neutral-100 tabular-nums">
              {formatCurrency(livePortfolio.totalEquity)}
            </span>
          </div>
          <div>
            <span className="text-neutral-500 mr-1">UNREALIZED PnL:</span>
            <span className={`font-bold tabular-nums ${livePortfolio.unrealizedPnL >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
              {formatCurrency(livePortfolio.unrealizedPnL)} ({formatPercent(livePortfolio.unrealizedPnLPercent)})
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <section className="border border-[#262c36] bg-[#12151a] p-3 flex flex-col gap-2">
          <div className="text-amber-500 font-bold border-b border-[#262c36] pb-1 text-[11px] tracking-wider">
            WATCHLIST MONITOR
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto">
            {Object.values(assets).map((asset) => (
              <button
                key={asset.symbol}
                type="button"
                onClick={() => setSelectedSymbol(asset.symbol)}
                className={`flex items-center justify-between px-2 py-1.5 text-left border transition-colors min-h-[38px] ${
                  selectedAsset?.symbol === asset.symbol
                    ? 'border-amber-500/80 bg-amber-500/10 text-neutral-100'
                    : 'border-[#262c36] hover:bg-[#181c24] text-neutral-300'
                }`}
              >
                <div>
                  <span className="font-bold text-cyan-400 mr-2">{asset.symbol}</span>
                  <span className="text-neutral-500 text-[10px]">{asset.name}</span>
                </div>
                <div className="text-right tabular-nums">
                  <div>{formatCurrency(asset.currentPrice)}</div>
                  <div className={`text-[10px] ${asset.change24h >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
                    {formatPercent(asset.change24h)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="border border-[#262c36] bg-[#12151a] p-3 flex flex-col gap-3">
          <div className="text-amber-500 font-bold border-b border-[#262c36] pb-1 text-[11px] tracking-wider">
            EXECUTION TICKET // {selectedAsset?.symbol ?? '--'}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-neutral-400">LAST SPOT:</span>
              <span className="text-lg font-bold text-neutral-100 tabular-nums">
                {selectedAsset ? formatCurrency(selectedAsset.currentPrice) : '$0.00'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="quick-trade-amount" className="text-[10px] text-neutral-400">AMOUNT ({selectedAsset?.symbol})</label>
              <input
                id="quick-trade-amount"
                type="number"
                step="0.01"
                min="0.0001"
                value={tradeAmount}
                onChange={(e) => setTradeAmount(e.target.value)}
                className="bg-[#0a0b0d] border border-[#262c36] px-3 py-2 text-neutral-100 outline-none focus:border-amber-500 tabular-nums min-h-[44px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={handleQuickBuy}
                disabled={isSubmitting || !selectedAsset}
                className="min-h-[44px] bg-[#10b981] hover:bg-[#059669] text-black font-bold uppercase tracking-wider disabled:opacity-40"
              >
                BUY / LONG
              </button>
              <button
                type="button"
                onClick={handleQuickSell}
                disabled={isSubmitting || !selectedAsset}
                className="min-h-[44px] bg-[#f43f5e] hover:bg-[#e11d48] text-white font-bold uppercase tracking-wider disabled:opacity-40"
              >
                SELL / SHORT
              </button>
            </div>
          </div>
        </section>

        <section className="border border-[#262c36] bg-[#12151a] p-3 flex flex-col gap-2">
          <div className="text-amber-500 font-bold border-b border-[#262c36] pb-1 text-[11px] tracking-wider">
            ACTIVE HOLDINGS
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto">
            {Object.values(livePortfolio.holdings).length === 0 ? (
              <div className="text-neutral-500 py-4 text-center">NO OPEN POSITIONS</div>
            ) : (
              Object.values(livePortfolio.holdings).map((holding) => (
                <div key={holding.symbol} className="border border-[#262c36] p-2 flex justify-between items-center tabular-nums">
                  <div>
                    <span className="font-bold text-cyan-400 mr-2">{holding.symbol}</span>
                    <span className="text-neutral-400">{holding.amount} units</span>
                  </div>
                  <div className="text-right">
                    <div>{formatCurrency(holding.currentValue)}</div>
                    <div className={`text-[10px] ${holding.unrealizedPnL >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
                      {formatCurrency(holding.unrealizedPnL)} ({formatPercent(holding.unrealizedPnLPercent)})
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default function App() {
  return (
    <TerminalProvider>
      <TerminalScreen />
    </TerminalProvider>
  );
}
