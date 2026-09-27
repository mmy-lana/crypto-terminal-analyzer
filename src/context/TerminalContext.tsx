import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { CryptoAsset, StorageSchema, OrderSide } from '../types/terminal';
import { useTerminalStorage } from '../hooks/useTerminalStorage';
import { subscribeToMarketFeed, BASE_ASSETS } from '../services/marketFeed';
import { executeMarketOrder, evaluateOpenOrders } from '../utils/engine';
import { deriveLiveValuation, LivePortfolioValuation } from '../utils/finance';

interface TerminalContextValue {
  schema: StorageSchema;
  assets: Record<string, CryptoAsset>;
  livePortfolio: LivePortfolioValuation;
  selectedAsset: CryptoAsset | null;
  setSelectedSymbol: (symbol: string) => void;
  isSubmitting: boolean;
  executeTrade: (asset: CryptoAsset, side: OrderSide, amount: number) => Promise<{ success: boolean; error?: string }>;
  resetPortfolio: () => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export const TerminalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: schema, updateSchema, resetPortfolio } = useTerminalStorage();
  const [assets, setAssets] = useState<Record<string, CryptoAsset>>(() => ({ ...BASE_ASSETS }));
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const symbolsToWatch = schema.watchlist.length > 0 ? schema.watchlist : ['BTC', 'ETH', 'SOL'];

    const unsubscribe = subscribeToMarketFeed(symbolsToWatch, (latestPrices, updatedAssets) => {
      setAssets((prev) => ({ ...prev, ...updatedAssets }));
      updateSchema((prevSchema) => evaluateOpenOrders(prevSchema, latestPrices));
    });

    return () => {
      unsubscribe();
    };
  }, [schema.watchlist, updateSchema]);

  const executeTrade = useCallback(
    async (asset: CryptoAsset, side: OrderSide, amount: number) => {
      if (isSubmitting) {
        return { success: false, error: 'OPERATION_PENDING' };
      }

      setIsSubmitting(true);
      try {
        let executionResult: { success: boolean; error?: string } = { success: false, error: 'UNKNOWN' };

        updateSchema((prevSchema) => {
          const result = executeMarketOrder(prevSchema, asset, side, amount);
          executionResult = { success: result.success, error: result.error };
          return result.success ? result.updatedSchema : prevSchema;
        });

        return executionResult;
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, updateSchema]
  );

  const selectedAsset = useMemo(
    () => assets[selectedSymbol] || null,
    [assets, selectedSymbol]
  );

  const livePortfolio = useMemo(
    () => deriveLiveValuation(schema, assets),
    [schema, assets]
  );

  const contextValue = useMemo<TerminalContextValue>(
    () => ({
      schema,
      assets,
      livePortfolio,
      selectedAsset,
      setSelectedSymbol,
      isSubmitting,
      executeTrade,
      resetPortfolio,
    }),
    [schema, assets, livePortfolio, selectedAsset, isSubmitting, executeTrade, resetPortfolio]
  );

  return (
    <TerminalContext.Provider value={contextValue}>
      {children}
    </TerminalContext.Provider>
  );
};

export function useTerminal(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}
