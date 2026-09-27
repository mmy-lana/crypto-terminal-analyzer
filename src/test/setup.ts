/**
 * Global test environment shims.
 *
 * jsdom implements the DOM but not layout, not canvas, and not
 * `ResizeObserver`. Rather than mocking the terminal's own modules — which
 * would test the mocks instead of the code — the missing *platform* APIs are
 * provided here, so components under test run their real effects.
 */

import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { resetMatchMediaMock } from './matchMediaMock';

/** Minimal 2D context recording nothing but satisfying every call the app makes. */
function createStubContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };

  const context = {
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,

    setTransform: () => {},
    resetTransform: () => {},
    save: () => {},
    restore: () => {},
    scale: () => {},
    rotate: () => {},
    translate: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    bezierCurveTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {},
    rect: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    fillText: () => {},
    strokeText: () => {},
    measureText: (text: string) => ({ width: text.length * 6 }) as TextMetrics,
    createLinearGradient: () => gradient as unknown as CanvasGradient,
    createRadialGradient: () => gradient as unknown as CanvasGradient,
    setLineDash: () => {},
    getLineDash: () => [],
    drawImage: () => {},
  };

  return context as unknown as CanvasRenderingContext2D;
}

class StubResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  // Pure-logic suites opt into the node environment with a `@vitest-environment`
  // docblock, where none of the DOM shims below apply.
  if (typeof window === 'undefined') return;

  resetMatchMediaMock();

  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  }

  HTMLCanvasElement.prototype.getContext = function getContext(contextId: string) {
    return contextId === '2d' ? createStubContext() : null;
  } as HTMLCanvasElement['getContext'];

  // jsdom has no layout, so containers measure 0x0. `setupHiDPICanvas`
  // correctly declines to draw in that case; giving elements a box lets the
  // canvas path actually run in tests.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.testWidth ?? 320);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.testHeight ?? 200);
    },
  });
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    const width = Number((this as HTMLElement).dataset?.testWidth ?? 320);
    const height = Number((this as HTMLElement).dataset?.testHeight ?? 200);
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };

  // `resetMatchMediaMock()` above already installed the controllable
  // implementation; do not overwrite it with jsdom's always-false stub.

  // jsdom implements neither of these, and the ledger's CSV export needs them.
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
  }
  if (window.confirm === undefined) {
    window.confirm = () => true;
  }

  // React's act() and error-boundary logging are expected in this suite;
  // everything else still reaches the console.
  const realError = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (first.includes('not wrapped in act')) return;
    if (first.includes('Unrecoverable render fault')) return;
    realError(...args);
  });
});

afterEach(() => {
  if (typeof window === 'undefined') return;

  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});
