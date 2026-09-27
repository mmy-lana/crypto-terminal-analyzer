/**
 * Real-time market stream service (offline simulation).
 *
 * The terminal runs without a venue connection, so this module *is* the
 * exchange: it owns the asset universe, applies a random-walk tick to every
 * watched symbol, and synthesises a deterministic L2 order book around the
 * current spot price.
 *
 * Two properties matter for the rest of the app:
 *
 *  - the book generator is **seedable**, so a given (symbol, price, seed) always
 *    produces the same ladder. That keeps tests deterministic and stops the
 *    depth widget from jittering on every React re-render.
 *  - `subscribeToMarketFeed` emits **synchronously on subscribe** and returns a
 *    disposer that clears the interval, so no panel ever renders a null-flash
 *    and no subscription can outlive its component.
 *
 * One property is deliberately *not* offered: this cadence is not
 * configurable by media query. The 1s tick is data, not decoration — it is the
 * price the operator is trading on, and stopping it would freeze the terminal on
 * a stale number. `prefers-reduced-motion` therefore belongs to the decorative
 * layer only (the ticker-tape marquee, the scanline, the execution flash),
 * which is switched off in CSS; it must never gate this interval.
 */

import { CryptoAsset, OrderBookEntry, OrderBookState } from '../types/terminal';

/** Callback invoked on every tick with the changed prices and the full asset map. */
export interface TickCallback {
  (prices: Record<string, number>, assets: Record<string, CryptoAsset>): void;
}

/** Default cadence of the simulated tape. */
export const MARKET_TICK_INTERVAL_MS = 1000;

/** Number of samples retained per asset for the inline sparkline. */
export const SPARKLINE_POINTS = 24;

/** Default number of levels per side of the simulated book. */
export const ORDER_BOOK_DEPTH = 12;

/** Synthetic notional resting at the touch, used to size book levels. */
const BOOK_TOUCH_NOTIONAL = 250_000;

/** Symbols streamed when the watchlist is empty. */
export const DEFAULT_WATCHLIST: readonly string[] = ['BTC', 'ETH', 'SOL'];

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

/** Every symbol the simulated exchange knows how to quote. */
export const SUPPORTED_SYMBOLS: readonly string[] = Object.keys(BASE_ASSETS);

/** Symbol metadata for an asset outside {@link BASE_ASSETS}. */
export function createFallbackAsset(symbol: string, price: number = 100.0): CryptoAsset {
  return {
    id: symbol.toLowerCase(),
    symbol,
    name: symbol,
    currentPrice: price,
    change24h: 0,
    high24h: price * 1.05,
    low24h: price * 0.95,
    volume24h: 1_000_000,
    sparkline: [price, price, price, price],
    marketCap: 10_000_000,
    lastUpdated: new Date().toISOString(),
  };
}

/** Rounds to a fixed number of decimals without float dust. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** Math.max(0, Math.trunc(decimals));
  return Math.round(value * factor) / factor;
}

/**
 * Price precision that matches the magnitude of the quote: cents for a
 * five-figure BTC, six decimals for a sub-cent token.
 */
export function resolvePriceDecimals(price: number): number {
  if (price >= 10) return 2;
  if (price >= 1) return 4;
  if (price >= 0.01) return 6;
  return 8;
}

/** Pad or trim a price series to exactly `length` samples. */
export function normalizeSparkline(values: number[], length: number = SPARKLINE_POINTS): number[] {
  const safeLength = Math.max(1, Math.trunc(length));
  const finite = values.filter((value) => Number.isFinite(value));
  const tail = finite.slice(-safeLength);

  if (tail.length === 0) {
    return new Array<number>(safeLength).fill(0);
  }
  if (tail.length >= safeLength) {
    return tail;
  }

  // Back-fill by repeating the oldest observation so the line has no null gap.
  const [oldestSample = 0] = tail;
  return [...new Array<number>(safeLength - tail.length).fill(oldestSample), ...tail];
}

/**
 * Small, fast, fully deterministic PRNG (mulberry32).
 *
 * Used anywhere a synthetic value must be reproducible: order book ladders in
 * tests, deterministic fixture generation in Storybook-style previews.
 */
export function createSeededRandom(seed: number): () => number {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-symbol seed so a book only reshuffles when the symbol changes. */
export function hashSymbolToSeed(symbol: string): number {
  let hash = 2166136261;
  for (let i = 0; i < symbol.length; i++) {
    hash ^= symbol.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Minimum price increment between two book levels. */
export function resolveTickSize(price: number): number {
  const rawStep = price * 0.0005;
  if (price >= 10_000) return Math.max(0.01, roundTo(rawStep, 0));
  if (price >= 1_000) return Math.max(0.01, roundTo(rawStep, 1));
  if (price >= 10) return Math.max(0.0001, roundTo(rawStep, 2));
  if (price >= 1) return Math.max(0.00001, roundTo(rawStep, 4));
  return Math.max(0.0000001, roundTo(rawStep, 6));
}

const EMPTY_BOOK = (symbol: string): OrderBookState => ({
  symbol,
  lastPrice: 0,
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
});

/**
 * Builds a synthetic L2 ladder around `lastPrice`.
 *
 * Bids descend and asks ascend from a half-tick around spot, with per-level
 * sizes drawn from the seeded generator and a mild depth bias away from the
 * touch. Every level carries its running cumulative size so the depth widget
 * can draw proportional background bars without a second pass.
 */
export function generateOrderBook(
  symbol: string,
  lastPrice: number,
  depth: number = ORDER_BOOK_DEPTH,
  seed: number = hashSymbolToSeed(symbol)
): OrderBookState {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    return EMPTY_BOOK(symbol);
  }

  const levelCount = Math.min(Math.max(1, Math.trunc(depth)), 50);
  const random = createSeededRandom(seed);
  const decimals = resolvePriceDecimals(lastPrice);
  const tick = resolveTickSize(lastPrice);
  const halfTick = tick / 2;

  const bestBid = roundTo(lastPrice - halfTick, decimals);
  const bestAsk = roundTo(lastPrice + halfTick, decimals);
  const touchSize = Math.max(BOOK_TOUCH_NOTIONAL / lastPrice, 0.000001);

  const buildSide = (startPrice: number, direction: 1 | -1): OrderBookEntry[] => {
    const entries: OrderBookEntry[] = [];
    let cumulative = 0;

    for (let level = 0; level < levelCount; level++) {
      const price = roundTo(startPrice + direction * tick * level, decimals);
      if (price <= 0) {
        break;
      }
      // Random spread of sizes plus a linear bias: liquidity thins out with depth.
      const noise = 0.35 + random() * 1.65;
      const bias = 1 + level * 0.06;
      const size = roundTo(touchSize * noise * bias, 6);
      if (size <= 0) {
        continue;
      }
      cumulative = roundTo(cumulative + size, 6);
      entries.push({ price, size, total: cumulative });
    }

    return entries;
  };

  const asks = buildSide(bestAsk, 1);
  const bids = buildSide(bestBid, -1);
  const spread = roundTo(bestAsk - bestBid, decimals);

  return {
    symbol,
    lastPrice,
    bids,
    asks,
    spread,
    spreadPercent: Number(((spread / lastPrice) * 100).toFixed(4)),
  };
}

/** Rolling 24h statistics tracked per symbol by the feed. */
interface SymbolSession {
  open24h: number;
}

/**
 * Derives the 24h open from the current price and the quoted 24h change, so the
 * percentage evolves organically as the walk continues instead of staying
 * frozen at its seed value.
 */
function deriveOpen24h(asset: CryptoAsset): number {
  const ratio = 1 + asset.change24h / 100;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return asset.currentPrice;
  }
  return asset.currentPrice / ratio;
}

/**
 * Subscribes to the simulated tape.
 *
 * The first tick is emitted synchronously — a panel mounting against a live
 * market never renders an empty price — and every subsequent tick arrives on
 * `intervalMs`. The returned function must be used as the effect cleanup.
 *
 * `intervalMs` is a data cadence, so it is never scaled from a user preference:
 * a reduced-motion request must not stretch or stop it, because the quotes are
 * the product. Decorative motion is disabled in CSS instead.
 */
export function subscribeToMarketFeed(
  symbols: string[],
  onTick: TickCallback,
  intervalMs: number = MARKET_TICK_INTERVAL_MS
): () => void {
  const localAssets: Record<string, CryptoAsset> = { ...BASE_ASSETS };
  const sessions: Record<string, SymbolSession> = {};
  const watched = Array.from(
    new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => symbol.length > 0))
  );
  const activeSymbols = watched.length > 0 ? watched : [...DEFAULT_WATCHLIST];
  const cadence = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : MARKET_TICK_INTERVAL_MS;

  const sessionFor = (symbol: string, asset: CryptoAsset): SymbolSession => {
    const existing = sessions[symbol];
    if (existing !== undefined) {
      return existing;
    }
    const created: SymbolSession = { open24h: deriveOpen24h(asset) };
    sessions[symbol] = created;
    return created;
  };

  const emitTick = (): void => {
    const timestamp = new Date().toISOString();
    const priceUpdates: Record<string, number> = {};

    for (const symbol of activeSymbols) {
      const existing = localAssets[symbol] ?? createFallbackAsset(symbol);
      const session = sessionFor(symbol, existing);

      // Random walk with a slight upward bias: -0.4% to +0.4% per tick.
      const percentShift = (Math.random() - 0.495) * 0.008;
      const decimals = resolvePriceDecimals(existing.currentPrice);
      const walked = existing.currentPrice * (1 + percentShift);
      const newPrice = roundTo(Math.max(0.00000001, walked), decimals);

      const volumeKick = 1 + Math.random() * 0.0004;
      const change24h =
        session.open24h > 0 ? Number((((newPrice - session.open24h) / session.open24h) * 100).toFixed(2)) : 0;

      localAssets[symbol] = {
        ...existing,
        currentPrice: newPrice,
        change24h,
        high24h: Math.max(existing.high24h, newPrice),
        low24h: Math.min(existing.low24h, newPrice),
        volume24h: roundTo(existing.volume24h * volumeKick, 2),
        sparkline: normalizeSparkline([...existing.sparkline, newPrice], SPARKLINE_POINTS),
        lastUpdated: timestamp,
      };

      priceUpdates[symbol] = newPrice;
    }

    onTick(priceUpdates, { ...localAssets });
  };

  emitTick();

  const intervalId = setInterval(emitTick, cadence);

  return () => {
    clearInterval(intervalId);
  };
}
