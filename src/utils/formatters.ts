/**
 * Bloomberg-style display formatters for the terminal surface.
 *
 * Financial terminals never render a raw `NaN` into a price column and never
 * lose the sign of a negative number. Every rule below exists for that reason:
 *
 *  - negatives are bracketed, `(124.50)`, so the minus glyph can never be
 *    mistaken for a hairline divider,
 *  - the currency symbol is pinned to the left edge of the field and the
 *    numeric body is padded to a caller-supplied column width, keeping the
 *    decimal points of a column perfectly aligned,
 *  - non-finite input degrades to `--` instead of poisoning downstream math,
 *  - sequence-like values support zero-fill (`000417`).
 *
 * Everything is locale-stable (`en-US`) because the terminal grid math assumes
 * `.` as the decimal separator and `,` as the group separator. Grouping and
 * calendar parts both go through `Intl`, so locale data is parsed once at
 * module load rather than on every cell of every tick.
 */

/** Rendered in place of any value that is not a finite number. */
export const NULL_PLACEHOLDER = '--';

/** Rendered in place of an unbounded ratio (profit factor with zero losing trades). */
export const INFINITY_GLYPH = '∞';

/** Alignment modes supported by {@link padCell}. */
export type CellAlignment = 'left' | 'right' | 'center';

/** Optional presentation flags for {@link formatPercent}. */
export interface PercentFormatOptions {
  /** Prefix positive values with an explicit `+`. */
  signed?: boolean;
  /** Minimum field width; the body is right-aligned with leading spaces. */
  width?: number;
}

/** Coerces any numeric-ish input to a finite number, or returns `fallback`. */
export function toFiniteNumber(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

/** Type guard used before arithmetic in display paths. */
export function isDisplayableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * `Intl.NumberFormat` is expensive to construct — it parses locale data every
 * time — and a 500-row ledger asks for grouping two or three times per cell
 * every second. One formatter per distinct decimal count is enough, and the
 * decimal count is a small closed set, so this is effectively a constant.
 */
const numberFormatCache = new Map<number, Intl.NumberFormat>();

function groupedFormatter(decimals: number): Intl.NumberFormat {
  const cached = numberFormatCache.get(decimals);
  if (cached !== undefined) {
    return cached;
  }
  const created = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
  numberFormatCache.set(decimals, created);
  return created;
}

/**
 * Groups the absolute part of `value` with thousands separators and a fixed
 * number of decimals, e.g. `1,234,567.80`.
 */
export function groupThousands(value: number, decimals: number): string {
  const safeDecimals = Math.max(0, Math.trunc(decimals));
  return groupedFormatter(safeDecimals).format(Math.abs(value));
}

/** Pads `text` to `width` using the requested alignment. Never truncates. */
export function padCell(text: string, width: number, alignment: CellAlignment = 'right'): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  if (text.length >= safeWidth) {
    return text;
  }
  if (alignment === 'left') {
    return text.padEnd(safeWidth, ' ');
  }
  if (alignment === 'center') {
    const totalPadding = safeWidth - text.length;
    const leftPadding = Math.floor(totalPadding / 2);
    return ' '.repeat(leftPadding) + text + ' '.repeat(totalPadding - leftPadding);
  }
  return text.padStart(safeWidth, ' ');
}

function renderBody(value: number, decimals: number, width: number): string {
  const body = groupThousands(value, decimals);
  return padCell(body, width, 'right');
}

/**
 * Formats a plain number with a fixed decimal count.
 *
 * Negatives use bracket notation — `(124.50)` — and `width` pads the absolute
 * body so a stack of values lines up on the decimal separator.
 */
export function formatNumber(value: number, decimals: number = 2, width: number = 0): string {
  if (!isDisplayableNumber(value)) {
    return padCell(NULL_PLACEHOLDER, width, 'right');
  }
  const body = renderBody(value, decimals, width);
  return value < 0 ? `(${body})` : body;
}

/**
 * Formats a monetary value with a pinned currency symbol.
 *
 * `formatCurrency(-124.5)` -> `($124.50)`, `formatCurrency(124.5)` -> `$124.50`.
 */
export function formatCurrency(value: number, decimals: number = 2, width: number = 0): string {
  if (!isDisplayableNumber(value)) {
    return padCell(NULL_PLACEHOLDER, width, 'right');
  }
  const body = `$${renderBody(value, decimals, width)}`;
  return value < 0 ? `(${body})` : body;
}

/**
 * Formats a value that carries a direction: gains get an explicit `+`, losses
 * keep the bracket notation. `formatSignedCurrency(0)` -> `$0.00`.
 */
export function formatSignedCurrency(value: number, decimals: number = 2): string {
  if (!isDisplayableNumber(value)) {
    return NULL_PLACEHOLDER;
  }
  if (value > 0) {
    return `+$${groupThousands(value, decimals)}`;
  }
  return formatCurrency(value, decimals);
}

/** Formats a directional number without a currency symbol. */
export function formatSignedNumber(value: number, decimals: number = 2): string {
  if (!isDisplayableNumber(value)) {
    return NULL_PLACEHOLDER;
  }
  if (value > 0) {
    return `+${groupThousands(value, decimals)}`;
  }
  return formatNumber(value, decimals);
}

/** Formats a percentage. Sign is opt-in so 24h deltas can stay unpolluted. */
export function formatPercent(
  value: number,
  decimals: number = 2,
  options: PercentFormatOptions = {}
): string {
  const { signed = false, width = 0 } = options;
  if (!isDisplayableNumber(value)) {
    return padCell(NULL_PLACEHOLDER, width, 'right');
  }
  const body = `${padCell(Math.abs(value).toFixed(decimals), width, 'right')}%`;
  if (value < 0) {
    return `-${body}`;
  }
  return signed && value > 0 ? `+${body}` : body;
}

/**
 * Compact magnitude notation for 24h volume and market cap:
 * `1.28T`, `28.40B`, `310.50M`, `1.20K`.
 */
export function formatCompactNumber(value: number, decimals: number = 2): string {
  if (!isDisplayableNumber(value)) {
    return NULL_PLACEHOLDER;
  }

  const magnitude = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const tiers: ReadonlyArray<readonly [number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];

  for (const [threshold, suffix] of tiers) {
    if (magnitude >= threshold) {
      return `${sign}${(magnitude / threshold).toFixed(decimals)}${suffix}`;
    }
  }

  return `${sign}${magnitude.toFixed(decimals)}`;
}

/**
 * Formats a crypto quantity. Trailing zeros are trimmed but at least
 * `minDecimals` are kept, so `1.5` renders as `1.50` and `0.00000012` survives.
 */
export function formatQuantity(value: number, maxDecimals: number = 8, minDecimals: number = 2): string {
  if (!isDisplayableNumber(value)) {
    return NULL_PLACEHOLDER;
  }

  const safeMax = Math.max(0, Math.trunc(maxDecimals));
  const safeMin = Math.min(Math.max(0, Math.trunc(minDecimals)), safeMax);
  const fixed = Math.abs(value).toFixed(safeMax);

  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const paddedFraction = fraction.padEnd(safeMin, '0');
  const body = paddedFraction.length > 0 ? `${whole}.${paddedFraction}` : whole;

  return `${value < 0 ? '-' : ''}${body}`;
}

/**
 * Formats a dimensionless ratio (Sharpe, profit factor). An unbounded ratio
 * — every trade profitable, so gross loss is zero — renders as `∞`.
 */
export function formatRatio(value: number, decimals: number = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return NULL_PLACEHOLDER;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return INFINITY_GLYPH;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return `-${INFINITY_GLYPH}`;
  }
  return formatNumber(value, decimals);
}

/** Zero-fills an integer sequence number, e.g. `formatZeroFill(417, 6)` -> `000417`. */
export function formatZeroFill(value: number, length: number, decimals: number = 0): string {
  const safeLength = Math.max(0, Math.trunc(length));
  if (!isDisplayableNumber(value)) {
    return padCell(NULL_PLACEHOLDER, safeLength, 'right');
  }
  const body = Math.abs(value).toFixed(Math.max(0, Math.trunc(decimals)));
  const negative = value < 0 ? '-' : '';
  return `${negative}${body.padStart(Math.max(safeLength - negative.length, body.length), '0')}`;
}

/** Shortens a long identifier for dense tables: `ORD-1F2A3B4C` -> `ORD-1F2A…3B4C`. */
export function formatCompactId(id: string, head: number = 8, tail: number = 4): string {
  if (id.length <= head + tail + 1) {
    return id;
  }
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Parses anything date-ish, returning `null` instead of an `Invalid Date`. */
export function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * UTC clock/date formatters, built once.
 *
 * `Intl.DateTimeFormat` is the right primitive for splitting an instant into
 * calendar parts, but its *rendered* shape is locale-owned, and the ledger
 * needs a fixed `YYYY-MM-DD HH:MM:SS` so columns never reflow. So the parts are
 * pulled with `formatToParts` and reassembled by hand: locale-correct date
 * arithmetic, layout-stable output, and no dependence on how a particular
 * locale happens to order its separators.
 */
const UTC_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const UTC_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

interface UtcParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function utcPartsOf(date: Date): UtcParts {
  const parts: Partial<UtcParts> = {};
  for (const part of UTC_DATE_FORMAT.formatToParts(date)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      parts[part.type] = part.value;
    }
  }
  for (const part of UTC_CLOCK_FORMAT.formatToParts(date)) {
    if (part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
      parts[part.type] = part.value;
    }
  }
  return {
    year: parts.year ?? '0000',
    month: parts.month ?? '00',
    day: parts.day ?? '00',
    hour: parts.hour ?? '00',
    minute: parts.minute ?? '00',
    second: parts.second ?? '00',
  };
}

/** `HH:MM:SS` in UTC. */
export function formatUtcClock(value: Date | string | number, showSeconds: boolean = true): string {
  const date = toDate(value);
  if (date === null) {
    return NULL_PLACEHOLDER;
  }
  const { hour, minute, second } = utcPartsOf(date);
  return showSeconds ? `${hour}:${minute}:${second}` : `${hour}:${minute}`;
}

/** `YYYY-MM-DD` in UTC. */
export function formatUtcDate(value: Date | string | number): string {
  const date = toDate(value);
  if (date === null) {
    return NULL_PLACEHOLDER;
  }
  const { year, month, day } = utcPartsOf(date);
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD HH:MM:SSZ` in UTC — the full stamp used by the ledger and log feed. */
export function formatUtcDateTime(value: Date | string | number): string {
  const date = toDate(value);
  if (date === null) {
    return NULL_PLACEHOLDER;
  }
  return `${formatUtcDate(date)} ${formatUtcClock(date)}Z`;
}

/** `MM-DD HH:MM:SS` in UTC — the compact stamp used by the system console. */
export function formatLogStamp(value: Date | string | number): string {
  const date = toDate(value);
  if (date === null) {
    return NULL_PLACEHOLDER;
  }
  const { month, day, hour, minute, second } = utcPartsOf(date);
  return `${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * `HH:MM:SS` in UTC for an ISO timestamp. Retained as the canonical time-only
 * formatter so log rows, order rows and the header clock share one code path.
 */
export function formatTimestamp(isoString: string): string {
  const date = toDate(isoString);
  if (date === null) {
    return NULL_PLACEHOLDER;
  }
  return formatUtcClock(date);
}
