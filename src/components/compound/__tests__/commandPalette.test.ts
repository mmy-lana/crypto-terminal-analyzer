// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseCommand } from '../CommandPalette';

/**
 * The command palette's grammar is the fastest path through the terminal, so
 * it is also the easiest place for a typo to silently buy the wrong thing.
 * These cases pin every accept and every rejection the palette can produce.
 */
describe('parseCommand', () => {
  /**
   * `raw` is the verbatim input, so it always differs between two spellings of
   * the same order; every other field must match.
   */
  const withoutRaw = (result: ReturnType<typeof parseCommand>) => {
    const { raw: _raw, ...rest } = result;
    return rest;
  };

  describe('market orders', () => {
    it('parses a bare side, symbol and amount as a market order', () => {
      expect(parseCommand('BUY BTC 0.5')).toEqual({
        kind: 'MARKET',
        side: 'BUY',
        symbol: 'BTC',
        amount: 0.5,
        raw: 'BUY BTC 0.5',
      });
    });

    it('parses the explicit MARKET prefix identically', () => {
      expect(withoutRaw(parseCommand('MARKET BUY SOL 2'))).toEqual(
        withoutRaw(parseCommand('BUY SOL 2'))
      );
      expect(parseCommand('MARKET SELL ETH 1')).toMatchObject({
        kind: 'MARKET',
        side: 'SELL',
        symbol: 'ETH',
        amount: 1,
      });
    });

    it('accepts comma-separated arguments', () => {
      expect(withoutRaw(parseCommand('BUY, BTC, 0.5'))).toEqual(
        withoutRaw(parseCommand('BUY BTC 0.5'))
      );
    });

    it('is case-insensitive and collapses surrounding whitespace', () => {
      expect(withoutRaw(parseCommand('   buy   btc   0.5   '))).toEqual(
        withoutRaw(parseCommand('BUY BTC 0.5'))
      );
    });
  });

  describe('limit orders', () => {
    it('reads price then amount', () => {
      expect(parseCommand('LIMIT BUY BTC 65000 0.5')).toEqual({
        kind: 'LIMIT',
        side: 'BUY',
        symbol: 'BTC',
        price: 65000,
        amount: 0.5,
        raw: 'LIMIT BUY BTC 65000 0.5',
      });
    });

    it('does not swap price and amount for a sell', () => {
      expect(parseCommand('LIMIT SELL ETH 3600 2')).toMatchObject({
        price: 3600,
        amount: 2,
      });
    });

    it('rejects a limit order missing its amount', () => {
      expect(parseCommand('LIMIT BUY BTC 65000')).toMatchObject({
        kind: 'INVALID',
        reason: 'LIMIT needs both a price and an amount',
      });
    });

    it('rejects a limit order with no numeric tail', () => {
      expect(parseCommand('LIMIT BUY BTC')).toMatchObject({
        kind: 'INVALID',
        reason: 'Expected a positive number for price',
      });
    });
  });

  describe('selection and reset', () => {
    it('selects a bare known symbol', () => {
      expect(parseCommand('avax')).toEqual({ kind: 'SELECT', symbol: 'AVAX', raw: 'avax' });
    });

    it('accepts RESET with no arguments', () => {
      expect(parseCommand('reset')).toEqual({ kind: 'RESET', raw: 'reset' });
    });

    it('rejects RESET with arguments', () => {
      expect(parseCommand('RESET BTC')).toMatchObject({
        kind: 'INVALID',
        reason: 'RESET takes no arguments',
      });
    });
  });

  describe('rejections', () => {
    it('rejects empty input with a prompt, not an error dump', () => {
      expect(parseCommand('')).toEqual({ kind: 'INVALID', raw: '', reason: 'Enter a command' });
      expect(parseCommand('    ')).toMatchObject({ kind: 'INVALID', reason: 'Enter a command' });
    });

    it('rejects a non-positive or unparseable amount', () => {
      for (const input of ['BUY BTC 0', 'BUY BTC -1', 'BUY BTC abc']) {
        expect(parseCommand(input)).toMatchObject({
          kind: 'INVALID',
          reason: 'Expected a positive number for amount',
        });
      }
    });

    it('rejects an unknown symbol and lists the listed ones', () => {
      const result = parseCommand('BUY DOGE 1');
      expect(result.kind).toBe('INVALID');
      expect(result.kind === 'INVALID' && result.reason).toMatch(/^Unknown symbol\. Listed: BTC/);
    });

    it('rejects a missing side', () => {
      expect(parseCommand('LIMIT BTC 65000 1')).toMatchObject({
        kind: 'INVALID',
        reason: 'Expected BUY or SELL',
      });
    });

    it('rejects trailing arguments', () => {
      expect(parseCommand('BUY BTC 0.5 now')).toMatchObject({
        kind: 'INVALID',
        reason: 'Too many arguments',
      });
      expect(parseCommand('LIMIT BUY BTC 65000 0.5 fast')).toMatchObject({
        kind: 'INVALID',
        reason: 'Too many arguments',
      });
    });

    it('rejects a bare unknown word with a usable suggestion', () => {
      const result = parseCommand('HELP');
      expect(result.kind).toBe('INVALID');
      expect(result.kind === 'INVALID' && result.reason).toMatch(/Unknown command\. Try BUY, SELL, LIMIT/);
    });

    it('rejects a symbol followed by stray words', () => {
      expect(parseCommand('BTC buy')).toMatchObject({ kind: 'INVALID' });
    });
  });

  it('never returns a non-INVALID result with a non-finite number', () => {
    const inputs = ['BUY BTC', 'BUY BTC 1e999', 'LIMIT BUY BTC 1e999 1', 'SELL BTC Infinity'];
    for (const input of inputs) {
      const result = parseCommand(input);
      if (result.kind === 'MARKET') expect(Number.isFinite(result.amount)).toBe(true);
      if (result.kind === 'LIMIT') {
        expect(Number.isFinite(result.price)).toBe(true);
        expect(Number.isFinite(result.amount)).toBe(true);
      }
    }
  });
});
