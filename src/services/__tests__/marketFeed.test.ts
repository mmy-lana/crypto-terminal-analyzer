// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_ASSETS,
  DEFAULT_WATCHLIST,
  MARKET_TICK_INTERVAL_MS,
  ORDER_BOOK_DEPTH,
  SPARKLINE_POINTS,
  SUPPORTED_SYMBOLS,
  createFallbackAsset,
  createSeededRandom,
  generateOrderBook,
  hashSymbolToSeed,
  normalizeSparkline,
  resolvePriceDecimals,
  resolveTickSize,
  roundTo,
  subscribeToMarketFeed,
} from '../marketFeed';

afterEach(() => {
  vi.useRealTimers();
});

describe('seeded randomness', () => {
  it('is deterministic for a given seed', () => {
    const a = createSeededRandom(1234);
    const b = createSeededRandom(1234);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];

    expect(first).toEqual(second);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('produces a different stream for a different seed', () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    expect(a()).not.toBe(b());
  });

  it('treats a zero seed as a usable stream', () => {
    const random = createSeededRandom(0);
    expect(Number.isFinite(random())).toBe(true);
  });

  it('hashes symbols stably', () => {
    expect(hashSymbolToSeed('BTC')).toBe(hashSymbolToSeed('BTC'));
    expect(hashSymbolToSeed('BTC')).not.toBe(hashSymbolToSeed('ETH'));
  });
});

describe('price scale helpers', () => {
  it('rounds without float dust', () => {
    expect(roundTo(1.006, 2)).toBe(1.01);
    expect(roundTo(2.34567, 3)).toBe(2.346);
    expect(roundTo(1.23456789, 2)).toBe(1.23);
    expect(roundTo(Number.NaN, 2)).toBe(0);
  });

  it('scales precision to the magnitude of the quote', () => {
    expect(resolvePriceDecimals(65000)).toBe(2);
    expect(resolvePriceDecimals(5.25)).toBe(4);
    expect(resolvePriceDecimals(0.05)).toBe(6);
    expect(resolvePriceDecimals(0.005)).toBe(8);
  });

  it('keeps the book tick proportional to price', () => {
    expect(resolveTickSize(65000)).toBe(33);
    expect(resolveTickSize(100)).toBeGreaterThan(0);
    expect(resolveTickSize(0.0001)).toBeGreaterThan(0);
  });
});

describe('generateOrderBook', () => {
  it('is reproducible for the same symbol, price and seed', () => {
    const a = generateOrderBook('BTC', 65000, 12, 99);
    const b = generateOrderBook('BTC', 65000, 12, 99);

    expect(a).toEqual(b);
  });

  it('brackets spot with a full ladder on both sides', () => {
    const book = generateOrderBook('BTC', 65000, 12, 7);

    expect(book.symbol).toBe('BTC');
    expect(book.bids).toHaveLength(ORDER_BOOK_DEPTH);
    expect(book.asks).toHaveLength(ORDER_BOOK_DEPTH);
    expect(book.bids[0]?.price).toBeLessThan(65000);
    expect(book.asks[0]?.price).toBeGreaterThan(65000);
    expect(book.bids[0]?.price).toBeGreaterThan(book.bids[1]?.price ?? 0);
    expect(book.asks[1]?.price).toBeGreaterThan(book.asks[0]?.price ?? 0);
  });

  it('accumulates depth monotonically', () => {
    const book = generateOrderBook('ETH', 3450, 12, 3);
    const bids = book.bids;
    const asks = book.asks;

    for (let i = 1; i < bids.length; i++) {
      expect(bids[i]?.total).toBeGreaterThan(bids[i - 1]?.total ?? 0);
      expect(asks[i]?.total).toBeGreaterThan(asks[i - 1]?.total ?? 0);
    }
    expect(bids[0]?.total).toBe(bids[0]?.size);
    expect(asks[0]?.total).toBe(asks[0]?.size);
  });

  it('quotes a spread equal to the gap across the touch', () => {
    const book = generateOrderBook('SOL', 145.2, 5, 11);
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;

    expect(book.spread).toBeCloseTo(bestAsk - bestBid, 8);
    expect(book.spreadPercent).toBeCloseTo(((bestAsk - bestBid) / 145.2) * 100, 4);
  });

  it('always books a positive size at every level', () => {
    const book = generateOrderBook('NEAR', 5.25, 12, 5);
    expect([...book.bids, ...book.asks].every((entry) => entry.size > 0)).toBe(true);
  });

  it('emits an empty book for an unquotable price', () => {
    expect(generateOrderBook('BTC', 0)).toMatchObject({ lastPrice: 0, bids: [], asks: [], spread: 0 });
    expect(generateOrderBook('BTC', -5)).toMatchObject({ bids: [], asks: [] });
  });

  it('clamps an unreasonable depth request', () => {
    expect(generateOrderBook('BTC', 65000, 0).bids.length).toBe(1);
    expect(generateOrderBook('BTC', 65000, 500).bids.length).toBe(50);
  });
});

describe('sparkline normalisation', () => {
  it('pads short history by repeating the oldest sample', () => {
    expect(normalizeSparkline([10, 20, 30], 5)).toEqual([10, 10, 10, 20, 30]);
  });

  it('trims long history to the most recent samples', () => {
    expect(normalizeSparkline([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  it('drops non-finite samples and never returns a short series', () => {
    expect(normalizeSparkline([Number.NaN, 5], 4)).toEqual([5, 5, 5, 5]);
    expect(normalizeSparkline([], 3)).toEqual([0, 0, 0]);
  });
});

describe('subscribeToMarketFeed', () => {
  it('emits immediately and on every interval', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();

    const unsubscribe = subscribeToMarketFeed(['BTC', 'ETH'], onTick, MARKET_TICK_INTERVAL_MS);
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(4);

    unsubscribe();
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(4);
  });

  it('keeps every quote positive and coherent', () => {
    vi.useFakeTimers();
    let lastPrices: Record<string, number> = {};
    let lastAssets = {};

    const unsubscribe = subscribeToMarketFeed(
      ['BTC', 'ETH'],
      (prices, assets) => {
        lastPrices = prices;
        lastAssets = assets;
      },
      100
    );

    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(100);
    }
    unsubscribe();

    expect(Object.keys(lastPrices).sort()).toEqual(['BTC', 'ETH']);
    for (const price of Object.values(lastPrices)) {
      expect(price).toBeGreaterThan(0);
      expect(Number.isFinite(price)).toBe(true);
    }

    const btc = (lastAssets as Record<string, { high24h: number; low24h: number; sparkline: number[] }>)
      .BTC;
    expect(btc?.sparkline).toHaveLength(SPARKLINE_POINTS);
    expect(btc?.high24h).toBeGreaterThan(btc?.low24h ?? 0);
  });

  it('falls back to the default watchlist and synthesises unknown symbols', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const unsubscribe = subscribeToMarketFeed([], onTick, 1000);

    const [prices] = onTick.mock.calls[0] as [Record<string, number>];
    expect(Object.keys(prices).sort()).toEqual([...DEFAULT_WATCHLIST].sort());
    unsubscribe();
  });

  it('quotes an unknown symbol with a generated profile', () => {
    vi.useFakeTimers();
    let assets: Record<string, { name: string; sparkline: number[] }> = {};
    const unsubscribe = subscribeToMarketFeed(
      ['XYZ'],
      (_prices, next) => {
        assets = next;
      },
      1000
    );
    unsubscribe();

    expect(assets.XYZ?.name).toBe('XYZ');
    expect(assets.XYZ?.sparkline).toHaveLength(SPARKLINE_POINTS);
  });

  it('ignores a nonsensical interval', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const unsubscribe = subscribeToMarketFeed(['BTC'], onTick, 0);
    vi.advanceTimersByTime(MARKET_TICK_INTERVAL_MS);
    unsubscribe();

    expect(onTick).toHaveBeenCalledTimes(2);
  });
});

describe('asset universe', () => {
  it('exposes the seeded market with a sparkline history', () => {
    expect(SUPPORTED_SYMBOLS).toEqual(Object.keys(BASE_ASSETS));
    for (const symbol of SUPPORTED_SYMBOLS) {
      const asset = BASE_ASSETS[symbol];
      expect(asset?.symbol).toBe(symbol);
      expect(asset?.currentPrice).toBeGreaterThan(0);
      expect(asset?.sparkline.length).toBeGreaterThan(0);
      expect(asset?.high24h).toBeGreaterThanOrEqual(asset?.low24h ?? 0);
    }
  });

  it('builds a plausible profile for an unlisted symbol', () => {
    const fallback = createFallbackAsset('XYZ', 42);

    expect(fallback).toMatchObject({ id: 'xyz', symbol: 'XYZ', name: 'XYZ', currentPrice: 42 });
    expect(fallback.high24h).toBeGreaterThan(42);
    expect(fallback.low24h).toBeLessThan(42);
  });
});
