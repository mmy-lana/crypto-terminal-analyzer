import React, { useEffect, useRef } from 'react';

import { OrderBookEntry, OrderBookState } from '../../types/terminal';
import { CanvasRenderCallback, resizeHiDPICanvas, setupHiDPICanvas } from '../../utils/canvas';
import { formatCurrency, formatQuantity } from '../../utils/formatters';

export interface DepthVisualizerProps {
  book: OrderBookState;
  /** Canvas CSS height in pixels. */
  height?: number;
  className?: string;
  /** Mark price drawn as a vertical rule. Defaults to the book's last price. */
  midPrice?: number;
}

const BID_RGB = '16, 185, 129';
const ASK_RGB = '244, 63, 94';
const GRID_RGB = '38, 44, 54';

function buildPriceRange(book: OrderBookState, mid: number): { min: number; max: number } {
  const prices = [...book.bids.map((entry) => entry.price), ...book.asks.map((entry) => entry.price), mid].filter(
    (price) => Number.isFinite(price) && price > 0
  );

  if (prices.length === 0) {
    const pad = Math.max(mid * 0.0005, 1e-6);
    return { min: mid - pad, max: mid + pad };
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // A one-sided or empty book gives a zero-width range; widen it so the
  // scale stays finite instead of dividing by zero.
  if (max - min < 1e-9) {
    const pad = Math.max(mid * 0.0005, 1e-6);
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

/**
 * The canvas is pixels, so nothing on it reaches assistive tech: the accessible
 * name has to carry what the bitmap draws. The "AWAITING DEPTH" state is the
 * sharpest case — it is a label painted onto the canvas and otherwise
 * unannounced, so the empty book is spoken here instead.
 */
function describeDepth(book: OrderBookState, midPrice?: number): string {
  const mid = midPrice ?? book.lastPrice;
  const totals = [...book.bids, ...book.asks].map((entry) => entry.total);
  const maxTotal = totals.length > 0 ? Math.max(...totals) : 0;

  if (maxTotal <= 0 || !Number.isFinite(mid) || mid <= 0) {
    return `Cumulative order depth for ${book.symbol}: awaiting depth, no orders resting on the book.`;
  }

  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  const bidDepth = book.bids[book.bids.length - 1]?.total ?? 0;
  const askDepth = book.asks[book.asks.length - 1]?.total ?? 0;

  return (
    [
      `Cumulative order depth for ${book.symbol}`,
      `${book.bids.length} bid levels against ${book.asks.length} ask levels`,
      bestBid === undefined ? 'no resting bids' : `best bid ${formatCurrency(bestBid.price)}`,
      bestAsk === undefined ? 'no resting asks' : `best ask ${formatCurrency(bestAsk.price)}`,
      `${formatQuantity(bidDepth)} of cumulative bid against ${formatQuantity(askDepth)} ask`,
    ].join(', ') + '.'
  );
}

/**
 * Everything the painter reads, and therefore everything that has to change
 * before a repaint is worth skipping.
 *
 * The obvious five-number fingerprint — mid, top bid, top ask and the deepest
 * cumulative total on each side — is not enough. The polygon is drawn from
 * *every* level and its vertical scale comes from the largest total in the
 * book, so two books can agree on all five and still differ in the middle of
 * the ladder or in where the peak sits. Skipping that repaint leaves a stale
 * curve on screen, which is worse than the redraw it was trying to avoid.
 */
interface DepthFrame {
  mid: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

function ladderIsUnchanged(before: OrderBookEntry[], after: OrderBookEntry[]): boolean {
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    const previous = before[index];
    const current = after[index];
    if (previous === undefined || current === undefined) return false;
    if (previous.price !== current.price || previous.total !== current.total) return false;
  }
  return true;
}

/**
 * Canvas cumulative-depth curve.
 *
 * All bitmap lifecycle work is delegated to `utils/canvas`: the observer and
 * the frame loop are installed once per mount, and a market tick only
 * repaints through the same code path a resize would take. Data lives in a ref
 * so a tick never re-subscribes the observer, and the effect disposer tears
 * the observer, the pending frame and the bitmap itself down together.
 */
export const DepthVisualizer: React.FC<DepthVisualizerProps> = ({
  book,
  height = 120,
  className = '',
  midPrice,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderRef = useRef<CanvasRenderCallback | null>(null);
  const bookRef = useRef<OrderBookState>(book);
  const midPriceRef = useRef<number | undefined>(midPrice);
  const lastDrawnRef = useRef<DepthFrame | null>(null);

  bookRef.current = book;
  midPriceRef.current = midPrice;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const render: CanvasRenderCallback = (ctx, width, heightPx) => {
      const current = bookRef.current;
      const mid = midPriceRef.current ?? current.lastPrice;

      ctx.clearRect(0, 0, width, heightPx);

      ctx.strokeStyle = `rgba(${GRID_RGB}, 0.9)`;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (heightPx / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }

      const totals = [...current.bids, ...current.asks].map((entry) => entry.total);
      const maxTotal = totals.length > 0 ? Math.max(...totals) : 0;

      if (maxTotal <= 0 || !Number.isFinite(mid) || mid <= 0) {
        ctx.fillStyle = 'rgba(120, 120, 130, 0.6)';
        ctx.font = '10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('AWAITING DEPTH', width / 2, heightPx / 2);
        return;
      }

      const range = buildPriceRange(current, mid);
      const span = range.max - range.min;
      const toX = (price: number): number => ((price - range.min) / span) * width;
      const toY = (total: number): number => heightPx - (total / maxTotal) * heightPx;

      const drawSide = (entries: OrderBookState['bids'], rgb: string, fromLeft: boolean): void => {
        if (entries.length === 0) return;
        const points = entries.map((entry) => ({ x: toX(entry.price), y: toY(entry.total) }));

        ctx.beginPath();
        ctx.moveTo(points[0]?.x ?? 0, heightPx);
        for (const point of points) {
          ctx.lineTo(point.x, point.y);
        }
        ctx.lineTo(fromLeft ? (points[points.length - 1]?.x ?? 0) : (points[0]?.x ?? 0), heightPx);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, heightPx);
        gradient.addColorStop(0, `rgba(${rgb}, 0.32)`);
        gradient.addColorStop(1, `rgba(${rgb}, 0.02)`);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
        ctx.lineWidth = 1.25;
        ctx.lineJoin = 'round';
        ctx.stroke();
      };

      drawSide(current.bids, BID_RGB, true);
      drawSide(current.asks, ASK_RGB, false);

      const midX = toX(mid);
      if (midX >= 0 && midX <= width) {
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(midX + 0.5, 0);
        ctx.lineTo(midX + 0.5, heightPx);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    renderRef.current = render;
    const dispose = setupHiDPICanvas(canvas, container, render);

    return () => {
      renderRef.current = null;
      dispose();
    };
  }, []);

  // A tick changes the data but not the layout: repaint through the same
  // HiDPI sizing path a resize would take, without touching the observer.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const render = renderRef.current;
    if (!container || !canvas || !render) return;

    const next: DepthFrame = { mid: midPrice ?? book.lastPrice, bids: book.bids, asks: book.asks };
    const previous = lastDrawnRef.current;
    if (
      previous !== null &&
      previous.mid === next.mid &&
      ladderIsUnchanged(previous.bids, next.bids) &&
      ladderIsUnchanged(previous.asks, next.asks)
    ) {
      return;
    }

    // Record the frame only once it is genuinely on the canvas.
    // `resizeHiDPICanvas` returns false without drawing when the container has
    // no box — which is what a hidden panel or a pre-layout frame looks like —
    // and marking that frame as drawn would suppress the first real repaint and
    // leave a blank chart for the rest of the mount.
    if (resizeHiDPICanvas(canvas, container, render)) {
      lastDrawnRef.current = next;
    }
  }, [book, midPrice]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`} style={{ height }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describeDepth(book, midPrice)}
      />
    </div>
  );
};

export default DepthVisualizer;
