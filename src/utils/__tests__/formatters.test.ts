// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  INFINITY_GLYPH,
  NULL_PLACEHOLDER,
  formatCompactId,
  formatCompactNumber,
  formatCurrency,
  formatLogStamp,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatRatio,
  formatSignedCurrency,
  formatSignedNumber,
  formatTimestamp,
  formatUtcClock,
  formatUtcDate,
  formatUtcDateTime,
  formatZeroFill,
  groupThousands,
  isDisplayableNumber,
  padCell,
  toDate,
  toFiniteNumber,
} from '../formatters';

describe('numeric guards', () => {
  it('recognises displayable numbers', () => {
    expect(isDisplayableNumber(0)).toBe(true);
    expect(isDisplayableNumber(-1.5)).toBe(true);
    expect(isDisplayableNumber(Number.NaN)).toBe(false);
    expect(isDisplayableNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isDisplayableNumber('1')).toBe(false);
  });

  it('coerces to a finite fallback', () => {
    expect(toFiniteNumber(12.5)).toBe(12.5);
    expect(toFiniteNumber(Number.NaN, 7)).toBe(7);
    expect(toFiniteNumber(undefined, 3)).toBe(3);
  });

  it('groups thousands with a fixed decimal count', () => {
    expect(groupThousands(1234567.891, 2)).toBe('1,234,567.89');
    expect(groupThousands(-1234.5, 0)).toBe('1,235');
  });
});

describe('currency and number rendering', () => {
  it('pins the currency symbol to positive values', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('brackets negative values instead of using a minus glyph', () => {
    expect(formatCurrency(-124.5)).toBe('($124.50)');
    expect(formatNumber(-124.5)).toBe('(124.50)');
  });

  it('degrades non-finite input to a placeholder', () => {
    expect(formatCurrency(Number.NaN)).toBe(NULL_PLACEHOLDER);
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(NULL_PLACEHOLDER);
    expect(formatSignedCurrency(Number.NaN)).toBe(NULL_PLACEHOLDER);
  });

  it('pads the body so a column keeps its decimal alignment', () => {
    expect(formatCurrency(1.5, 2, 10)).toBe('$      1.50');
    expect(formatCurrency(-1.5, 2, 10)).toBe('($      1.50)');
    expect(formatNumber(9.5, 2, 8)).toBe('    9.50');
  });

  it('signs directional values explicitly', () => {
    expect(formatSignedCurrency(12.3)).toBe('+$12.30');
    expect(formatSignedCurrency(-12.3)).toBe('($12.30)');
    expect(formatSignedCurrency(0)).toBe('$0.00');
    expect(formatSignedNumber(4)).toBe('+4.00');
    expect(formatSignedNumber(-4)).toBe('(4.00)');
  });

  it('renders percentages with and without an explicit sign', () => {
    expect(formatPercent(2.451)).toBe('2.45%');
    expect(formatPercent(-1.5)).toBe('-1.50%');
    expect(formatPercent(2.451, 2, { signed: true })).toBe('+2.45%');
    expect(formatPercent(0, 1)).toBe('0.0%');
    expect(formatPercent(2.5, 2, { width: 6 })).toBe('  2.50%');
  });

  it('uses compact magnitudes for volume and market cap', () => {
    expect(formatCompactNumber(1_280_000_000_000)).toBe('1.28T');
    expect(formatCompactNumber(28_400_500_120)).toBe('28.40B');
    expect(formatCompactNumber(310_500_000)).toBe('310.50M');
    expect(formatCompactNumber(1_500)).toBe('1.50K');
    expect(formatCompactNumber(12.5)).toBe('12.50');
    expect(formatCompactNumber(-1_500)).toBe('-1.50K');
  });

  it('keeps crypto quantities precise but readable', () => {
    expect(formatQuantity(1.5)).toBe('1.50');
    expect(formatQuantity(0.123456789)).toBe('0.12345679');
    expect(formatQuantity(0.00000012)).toBe('0.00000012');
    expect(formatQuantity(-2.25)).toBe('-2.25');
    expect(formatQuantity(0, 8, 0)).toBe('0');
  });

  it('renders unbounded ratios as a glyph rather than a broken number', () => {
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe(INFINITY_GLYPH);
    expect(formatRatio(-1.2345)).toBe('(1.23)');
    expect(formatRatio(0)).toBe('0.00');
    expect(formatRatio(Number.NaN)).toBe(NULL_PLACEHOLDER);
  });

  it('zero-fills sequence values', () => {
    expect(formatZeroFill(417, 6)).toBe('000417');
    expect(formatZeroFill(7, 2)).toBe('07');
    expect(formatZeroFill(-3, 4)).toBe('-003');
  });
});

describe('grid helpers', () => {
  it('pads to a fixed width without truncating', () => {
    expect(padCell('7', 4, 'right')).toBe('   7');
    expect(padCell('7', 4, 'left')).toBe('7   ');
    expect(padCell('7', 4, 'center')).toBe(' 7  ');
    expect(padCell('longer', 3)).toBe('longer');
    expect(padCell('7', 0)).toBe('7');
  });

  it('shortens long identifiers for dense tables', () => {
    expect(formatCompactId('ORD-1234-abcd-efgh-ijkl-mnop')).toBe('ORD-1234…mnop');
    expect(formatCompactId('ORD-1')).toBe('ORD-1');
  });
});

describe('timestamp rendering', () => {
  const instant = '2026-03-04T05:06:07.891Z';

  it('parses anything date-like and rejects junk', () => {
    expect(toDate(instant)?.getUTCFullYear()).toBe(2026);
    expect(toDate('not-a-date')).toBeNull();
    expect(toDate(Number.NaN)).toBeNull();
  });

  it('renders UTC in every granularity', () => {
    expect(formatTimestamp(instant)).toBe('05:06:07');
    expect(formatUtcClock(instant)).toBe('05:06:07');
    expect(formatUtcClock(instant, false)).toBe('05:06');
    expect(formatUtcDate(instant)).toBe('2026-03-04');
    expect(formatUtcDateTime(instant)).toBe('2026-03-04 05:06:07Z');
    expect(formatLogStamp(instant)).toBe('03-04 05:06:07');
  });

  it('degrades an unparseable timestamp to a placeholder', () => {
    expect(formatTimestamp('not-a-date')).toBe(NULL_PLACEHOLDER);
    expect(formatUtcDateTime('')).toBe(NULL_PLACEHOLDER);
  });
});
