/**
 * Canvas lifecycle & high-DPI scaling utilities.
 *
 * Terminal widgets (order depth curve, equity sparkline) render on a raw
 * 2D canvas. Without explicit device-pixel-ratio handling the bitmap is
 * upscaled by the browser and the 1px hairlines that define the terminal
 * aesthetic turn to mush. Every canvas in the terminal is therefore mounted
 * through `setupHiDPICanvas`, which owns:
 *
 *  - bitmap sizing (`canvas.width = cssWidth * dpr`),
 *  - the `ctx.scale(dpr, dpr)` normalisation so callers draw in CSS pixels,
 *  - a `ResizeObserver` that keeps the bitmap in sync with its container,
 *  - frame coalescing through `requestAnimationFrame`,
 *  - and a disposer that tears every one of those down again.
 *
 * The disposer is mandatory: leaking a `ResizeObserver` keeps a detached
 * subtree (and its whole React tree) alive for the lifetime of the document.
 */

export type CanvasRenderCallback = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) => void;

/** Lowest device pixel ratio we will ever scale to; keeps hairlines crisp on odd setups. */
const MIN_DEVICE_PIXEL_RATIO = 1;

/** Highest DPR we will honour — 3x on a large monitor wastes fill rate for no visible gain. */
const MAX_DEVICE_PIXEL_RATIO = 3;

/**
 * Current device pixel ratio, clamped to a sane range and safe on server/worker
 * environments where `window` is not defined.
 */
export function getDevicePixelRatio(): number {
  if (typeof window === 'undefined') {
    return MIN_DEVICE_PIXEL_RATIO;
  }
  const raw = window.devicePixelRatio;
  if (!Number.isFinite(raw) || raw <= 0) {
    return MIN_DEVICE_PIXEL_RATIO;
  }
  return Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(MIN_DEVICE_PIXEL_RATIO, raw));
}

/**
 * Sizes `canvas` so that its backing bitmap matches the CSS box of `container`
 * at the current DPR, normalises the context transform to CSS pixels and
 * hands a ready-to-draw context to `onRender`.
 *
 * Returns `false` when the container has no measurable box yet (detached node,
 * hidden tab) or when the 2D context is unavailable, in which case nothing is
 * drawn and the caller stays idle until the next resize.
 */
export function resizeHiDPICanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  onRender: CanvasRenderCallback
): boolean {
  const rect = container.getBoundingClientRect();
  const cssWidth = Math.floor(rect.width);
  const cssHeight = Math.floor(rect.height);

  if (cssWidth <= 0 || cssHeight <= 0) {
    return false;
  }

  const dpr = getDevicePixelRatio();
  const bitmapWidth = Math.floor(cssWidth * dpr);
  const bitmapHeight = Math.floor(cssHeight * dpr);

  // Assigning width/height resets all context state, so only touch them when
  // the required bitmap size actually changed — this keeps the drawn frame
  // alive across no-op resizes.
  if (canvas.width !== bitmapWidth) {
    canvas.width = bitmapWidth;
  }
  if (canvas.height !== bitmapHeight) {
    canvas.height = bitmapHeight;
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext('2d');
  if (context === null) {
    return false;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  onRender(context, cssWidth, cssHeight);
  return true;
}

/**
 * Binds a canvas to its container for the lifetime of the returned disposer.
 *
 * The initial render happens synchronously so the widget never shows a blank
 * frame between mount and the first animation frame. Subsequent renders are
 * coalesced into a single animation frame per resize burst.
 */
export function setupHiDPICanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  onRender: CanvasRenderCallback
): () => void {
  let animationFrameId: number | null = null;
  let disposed = false;

  const render = (): void => {
    if (disposed) {
      return;
    }
    animationFrameId = null;
    resizeHiDPICanvas(canvas, container, onRender);
  };

  const scheduleRender = (): void => {
    if (disposed || animationFrameId !== null) {
      return;
    }
    animationFrameId = requestAnimationFrame(render);
  };

  const observer: ResizeObserver | null =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleRender);

  if (observer !== null) {
    observer.observe(container);
  }

  // Fallback for engines without ResizeObserver: the window resize event is
  // coarser, but it still keeps the bitmap from drifting out of sync.
  const handleWindowResize = (): void => {
    scheduleRender();
  };

  if (observer === null && typeof window !== 'undefined') {
    window.addEventListener('resize', handleWindowResize);
  }

  // Re-render when the window is dragged between displays with a different DPR.
  const dprQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(resolution: ${getDevicePixelRatio()}dppx)`)
      : null;

  const handleDprChange = (): void => {
    dprQuery?.removeEventListener('change', handleDprChange);
    scheduleRender();
  };

  dprQuery?.addEventListener('change', handleDprChange, { once: true });

  render();

  return () => {
    disposed = true;

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    observer?.disconnect();

    if (observer === null && typeof window !== 'undefined') {
      window.removeEventListener('resize', handleWindowResize);
    }

    dprQuery?.removeEventListener('change', handleDprChange);

    // Drop the bitmap allocation so a hidden panel cannot pin megabytes.
    canvas.width = 0;
    canvas.height = 0;
  };
}
