// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { describeExecutionError } from '../errorCopy';
import type { TerminalRejectionCode } from '../errorCopy';

/**
 * The engine's codes are the test and log contract; this module is the human
 * contract. These tests pin the two properties an operator depends on: a
 * rejection is never reported as a bare code, and every rejection says what to
 * do next rather than only what went wrong.
 */
const ALL_CODES: TerminalRejectionCode[] = [
  'INVALID_SYMBOL',
  'INVALID_AMOUNT',
  'INVALID_PRICE',
  'INSUFFICIENT_FUNDS',
  'INSUFFICIENT_ASSET_BALANCE',
  'ORDER_NOT_FOUND',
  'ORDER_NOT_CANCELABLE',
  'OPERATION_PENDING',
];

/** A realistic ticket: $100k cash, a 0.42 BTC position, a live mark. */
const CONTEXT = { symbol: 'BTC', cash: 100_000, position: 0.42, markPrice: 65_000 };

describe('describeExecutionError', () => {
  it('never leaks a raw enum code to the operator', () => {
    for (const code of ALL_CODES) {
      const message = describeExecutionError(code);
      expect(message).not.toContain(code);
      expect(message.length).toBeGreaterThan(20);
    }
  });

  it('covers every code the engine can return', () => {
    for (const code of ALL_CODES) {
      expect(describeExecutionError(code)).toMatch(/[.!]$/);
    }
  });

  it('explains a missing code rather than rendering "undefined"', () => {
    const message = describeExecutionError(undefined);
    expect(message).not.toContain('undefined');
    expect(message).toMatch(/unknown reason/i);
  });

  it('names the concrete position that caps a sell', () => {
    const message = describeExecutionError('INSUFFICIENT_ASSET_BALANCE', CONTEXT);
    expect(message).toContain('0.42 BTC');
  });

  it('derives the affordable size from cash, mark and taker commission', () => {
    const message = describeExecutionError('INSUFFICIENT_FUNDS', CONTEXT);
    // 100000 / (65000 * 1.0004) ≈ 1.5383
    expect(message).toMatch(/Reduce the amount to 1\.5\d* BTC or less/);
  });

  it('still reads correctly with no context at all', () => {
    const message = describeExecutionError('INSUFFICIENT_ASSET_BALANCE');
    expect(message).toMatch(/Position is smaller than the requested size/);
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('NaN');
  });

  it('degrades gracefully if a new code ships without copy', () => {
    // The engine can grow a rejection code before this module grows its
    // sentence; the notice bar must still read as English.
    const message = describeExecutionError(
      'MARGIN_CALL' as unknown as TerminalRejectionCode
    );
    expect(message).toContain('margin call');
    expect(message).not.toContain('MARGIN_CALL');
    expect(message).toMatch(/system log/i);
  });

  it('states a next action for every code, not just a cause', () => {
    // "Not enough cash" alone leaves the operator guessing; each message must
    // tell them what to change.
    // Every code must name a remedy, given a realistic context.
    expect(describeExecutionError('INSUFFICIENT_FUNDS', CONTEXT)).toMatch(/reduce|reset/i);
    expect(describeExecutionError('INSUFFICIENT_ASSET_BALANCE', CONTEXT)).toMatch(/sell at most/i);
    expect(describeExecutionError('INVALID_PRICE', CONTEXT)).toMatch(/enter a price/i);
    expect(describeExecutionError('INVALID_AMOUNT', CONTEXT)).toMatch(/enter a size/i);
    expect(describeExecutionError('INVALID_SYMBOL', CONTEXT)).toMatch(/watchlist/i);
    expect(describeExecutionError('NO_ASSET')).toMatch(/watchlist/i);
    expect(describeExecutionError('UNKNOWN_SYMBOL', CONTEXT)).toMatch(/watchlist/i);
    expect(describeExecutionError('ORDER_NOT_FOUND')).toMatch(/ledger/i);
    expect(describeExecutionError('ORDER_NOT_CANCELABLE')).toMatch(/ledger/i);
    expect(describeExecutionError('OPERATION_PENDING')).toMatch(/wait/i);
  });
});
