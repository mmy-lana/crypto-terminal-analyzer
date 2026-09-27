import React, { useMemo } from 'react';

import { formatNumber, formatPercent } from '../../utils/formatters';

export interface SparklineChartProps {
  /** Chronological price series, oldest first. */
  data: number[];
  /** Line and fill colour. Defaults to the terminal cyan. */
  color?: string;
  /** Draws a flat baseline and mid-line grid. */
  showGrid?: boolean;
  /** Renders the last point with a marker. */
  showLastPoint?: boolean;
  /** Stroke width in viewBox units; DPR-independent because the SVG scales. */
  strokeWidth?: number;
  /** Internal viewBox size. Aspect ratio drives the rendered box. */
  viewBoxWidth?: number;
  viewBoxHeight?: number;
  className?: string;
  /** What the series *is*; the shape of the data is appended to it. */
  label?: string;
}

/**
 * A sparkline is a path with no text nodes, so the accessible name is the only
 * channel its data has: the caller's `label` says what the series is and this
 * adds what it shows — point count, direction, latest value and range — none of
 * which survives in pixels.
 */
function describeSeries(data: number[], subject: string): string {
  const points = data.filter((value) => Number.isFinite(value));

  if (points.length === 0) {
    return `${subject}: no data points yet.`;
  }

  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const change = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;

  return (
    [
      `${subject}: ${points.length} point${points.length === 1 ? '' : 's'}`,
      change === null ? null : `${formatPercent(change, 2, { signed: true })} across the series`,
      `latest ${formatNumber(last, 2)}`,
      points.length > 1 ? `range ${formatNumber(Math.min(...points), 2)} to ${formatNumber(Math.max(...points), 2)}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(', ') + '.'
  );
}

/**
 * Zero-dependency SVG sparkline.
 *
 * The path is built in a fixed internal coordinate space and the SVG scales
 * to the container with `w-full h-auto`, so the same markup is crisp at any
 * breakpoint and needs no resize observer. A flat series would divide by a
 * zero range, so the scale collapses to a centred line instead.
 */
export const SparklineChart: React.FC<SparklineChartProps> = ({
  data,
  color = '#06b6d4',
  showGrid = false,
  showLastPoint = true,
  strokeWidth = 1.5,
  viewBoxWidth = 100,
  viewBoxHeight = 32,
  className = '',
  label,
}) => {
  const geometry = useMemo(() => {
    const points = data.filter((value) => Number.isFinite(value));
    if (points.length === 0) {
      return { line: '', area: '', last: null as { x: number; y: number } | null, flat: true };
    }

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min;
    // A dead-flat series has no range to scale against; centre it instead of
    // dividing by zero.
    const flat = range === 0;
    const padding = flat ? 0 : 0;

    const toX = (index: number): number =>
      points.length === 1 ? viewBoxWidth / 2 : (index / (points.length - 1)) * viewBoxWidth;

    const toY = (value: number): number => {
      if (flat) return viewBoxHeight / 2;
      const usable = viewBoxHeight - padding * 2;
      return padding + ((max - value) / range) * usable;
    };

    const coords = points.map((value, index) => `${toX(index).toFixed(2)},${toY(value).toFixed(2)}`);

    return {
      line: `M${coords.join(' L')}`,
      area: `M0,${viewBoxHeight} L${coords.join(' L')} L${viewBoxWidth},${viewBoxHeight} Z`,
      last: { x: toX(points.length - 1), y: toY(points[points.length - 1] ?? 0) },
      flat,
    };
  }, [data, viewBoxWidth, viewBoxHeight]);

  const accessibleName = useMemo(
    // The fallback has to stand on its own: a caller that forgets the label
    // still gets a name that describes the shape of the data, not just "chart".
    () => describeSeries(data, label ?? 'Value trend sparkline'),
    [data, label]
  );

  if (data.length === 0) {
    return (
      <div
        className={`flex h-8 items-center justify-center text-[9px] uppercase tracking-[0.14em] text-neutral-600 ${className}`}
      >
        No history
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={accessibleName}
      className={`h-8 w-full ${className}`}
    >
      {showGrid ? (
        <g stroke="#262c36" strokeWidth={0.5} aria-hidden="true">
          <line x1={0} y1={viewBoxHeight / 2} x2={viewBoxWidth} y2={viewBoxHeight / 2} />
          <line x1={0} y1={0} x2={viewBoxWidth} y2={0} />
          <line x1={0} y1={viewBoxHeight} x2={viewBoxWidth} y2={viewBoxHeight} />
        </g>
      ) : null}

      {!geometry.flat ? (
        <path d={geometry.area} fill={color} fillOpacity={0.12} />
      ) : null}

      <path
        d={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />

      {showLastPoint && geometry.last ? (
        <circle cx={geometry.last.x} cy={geometry.last.y} r={1.8} fill={color} />
      ) : null}
    </svg>
  );
};

export default SparklineChart;
