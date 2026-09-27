import { CryptoAsset } from '../types/terminal';

export interface TickCallback {
  (prices: Record<string, number>, assets: Record<string, CryptoAsset>): void;
}

export const BASE_ASSETS: Record<string, CryptoAsset> = {
  BTC: {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    currentPrice: 65000.0,
    change24h: 2.45,
    high24h: 66200.0,
    low24h: 63800.0,
    volume24h: 28400500120,
    sparkline: [63800, 64200, 64100, 64900, 64700, 65800, 65000],
    marketCap: 1280000000000,
    lastUpdated: new Date().toISOString(),
  },
  ETH: {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    currentPrice: 3450.0,
    change24h: -1.15,
    high24h: 3520.0,
    low24h: 3410.0,
    volume24h: 14200300400,
    sparkline: [3520, 3500, 3480, 3460, 3420, 3440, 3450],
    marketCap: 415000000000,
    lastUpdated: new Date().toISOString(),
  },
  SOL: {
    id: 'solana',
    symbol: 'SOL',
    name: 'Solana',
    currentPrice: 145.2,
    change24h: 5.62,
    high24h: 148.0,
    low24h: 137.5,
    volume24h: 3800400100,
    sparkline: [138, 139, 142, 140, 144, 147, 145.2],
    marketCap: 67000000000,
    lastUpdated: new Date().toISOString(),
  },
  AVAX: {
    id: 'avalanche',
    symbol: 'AVAX',
    name: 'Avalanche',
    currentPrice: 28.4,
    change24h: 3.12,
    high24h: 29.5,
    low24h: 27.1,
    volume24h: 520400000,
    sparkline: [27.1, 27.5, 27.8, 28.1, 27.9, 28.6, 28.4],
    marketCap: 11200000000,
    lastUpdated: new Date().toISOString(),
  },
  BNB: {
    id: 'binancecoin',
    symbol: 'BNB',
    name: 'BNB',
    currentPrice: 580.0,
    change24h: 0.85,
    high24h: 590.0,
    low24h: 574.0,
    volume24h: 980100200,
    sparkline: [575, 576, 582, 579, 584, 581, 580],
    marketCap: 87000000000,
    lastUpdated: new Date().toISOString(),
  },
  NEAR: {
    id: 'near',
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    currentPrice: 5.25,
    change24h: -2.3,
    high24h: 5.5,
    low24h: 5.12,
    volume24h: 310500000,
    sparkline: [5.45, 5.4, 5.35, 5.2, 5.18, 5.3, 5.25],
    marketCap: 5800000000,
    lastUpdated: new Date().toISOString(),
  },
};

export function subscribeToMarketFeed(
  symbols: string[],
  onTick: TickCallback,
  intervalMs: number = 1000
): () => void {
  const localAssets: Record<string, CryptoAsset> = { ...BASE_ASSETS };

  const emitTick = () => {
    const priceUpdates: Record<string, number> = {};

    symbols.forEach((symbol) => {
      const existing = localAssets[symbol] || {
        id: symbol.toLowerCase(),
        symbol,
        name: symbol,
        currentPrice: 100.0,
        change24h: 0,
        high24h: 105.0,
        low24h: 95.0,
        volume24h: 1000000,
        sparkline: [100, 100, 100, 100],
        marketCap: 10000000,
        lastUpdated: new Date().toISOString(),
      };

      const percentShift = (Math.random() - 0.495) * 0.008;
      const newPrice = Number(Math.max(0.01, existing.currentPrice * (1 + percentShift)).toFixed(2));
      const newSparkline = [...existing.sparkline.slice(1), newPrice];

      localAssets[symbol] = {
        ...existing,
        currentPrice: newPrice,
        sparkline: newSparkline,
        high24h: Math.max(existing.high24h, newPrice),
        low24h: Math.min(existing.low24h, newPrice),
        lastUpdated: new Date().toISOString(),
      };

      priceUpdates[symbol] = newPrice;
    });

    onTick(priceUpdates, { ...localAssets });
  };

  emitTick();

  const intervalId = setInterval(emitTick, intervalMs);

  return () => {
    clearInterval(intervalId);
  };
}
