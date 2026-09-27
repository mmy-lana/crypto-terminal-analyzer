import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getListenerCount, setViewportWidth } from '../../test/matchMediaMock';
import {
  MOBILE_BREAKPOINT_PX,
  useIsDesktop,
  useIsMobile,
  useIsTablet,
  useMediaQuery,
} from '../useMediaQuery';

/**
 * The whole responsive layout hangs off these three hooks, so the boundary
 * values the plan specifies (768px phone ceiling, 1024px desktop floor) are
 * pinned here rather than left to a manual viewport check.
 */
describe('useMediaQuery', () => {
  afterEach(() => {
    setViewportWidth(1280);
  });

  it('reads the initial value synchronously during the first render', () => {
    setViewportWidth(390);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    // No waitFor: the very first committed render must already be correct,
    // otherwise the phone layout would flash the desktop column on mount.
    expect(result.current).toBe(true);
  });

  it('follows a viewport change after mount', async () => {
    setViewportWidth(1280);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);

    await act(async () => {
      setViewportWidth(800);
    });

    expect(result.current).toBe(false);
  });

  it('resubscribes when the query string changes', async () => {
    setViewportWidth(500);
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 1024px)' },
    });
    expect(result.current).toBe(false);

    await act(async () => {
      rerender({ query: '(max-width: 767px)' });
    });

    expect(result.current).toBe(true);
  });

  it('stops responding once unmounted', async () => {
    setViewportWidth(1280);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);

    unmount();
    await act(async () => {
      setViewportWidth(400);
    });

    // Nothing to assert on `result` after unmount; the point is that the
    // listener was removed, so no React state update is attempted.
    expect(result.current).toBe(true);
  });

  it('degrades to false when matchMedia is missing entirely', () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API to emulate an old webview
    delete window.matchMedia;

    try {
      const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
      expect(result.current).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('viewport predicates', () => {
  afterEach(() => {
    setViewportWidth(1280);
  });

  const cases: Array<{ width: number; mobile: boolean; tablet: boolean; desktop: boolean }> = [
    { width: 360, mobile: true, tablet: false, desktop: false },
    { width: 390, mobile: true, tablet: false, desktop: false },
    { width: 430, mobile: true, tablet: false, desktop: false },
    { width: 767, mobile: true, tablet: false, desktop: false },
    { width: 768, mobile: false, tablet: true, desktop: false },
    { width: 1023, mobile: false, tablet: true, desktop: false },
    { width: 1024, mobile: false, tablet: false, desktop: true },
    { width: 1280, mobile: false, tablet: false, desktop: true },
    { width: 1920, mobile: false, tablet: false, desktop: true },
  ];

  for (const { width, mobile, tablet, desktop } of cases) {
    it(`classifies ${width}px as ${mobile ? 'mobile' : tablet ? 'tablet' : 'desktop'}`, () => {
      setViewportWidth(width);
      const { result } = renderHook(() => ({
        mobile: useIsMobile(),
        tablet: useIsTablet(),
        desktop: useIsDesktop(),
      }));

      expect(result.current).toEqual({ mobile, tablet, desktop });
    });
  }

  it('never classifies a viewport as two sizes at once', () => {
    for (let width = 320; width <= 1600; width += 7) {
      setViewportWidth(width);
      const { result, unmount } = renderHook(() => ({
        mobile: useIsMobile(),
        tablet: useIsTablet(),
        desktop: useIsDesktop(),
      }));
      const active = Object.values(result.current).filter(Boolean).length;
      expect(active, `width ${width} matched ${active} breakpoints`).toBe(1);
      unmount();
    }
  });

  it('places the phone ceiling exactly at the documented breakpoint', () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(768);
  });
});

describe('subscription lifecycle', () => {
  it('removes its change listener on unmount', () => {
    setViewportWidth(1024);
    const before = getListenerCount();
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(getListenerCount()).toBe(before + 1);

    unmount();
    expect(getListenerCount()).toBe(before);
  });

  it('does not leave a subscription behind across a query change', () => {
    setViewportWidth(1024);
    const { rerender, unmount } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 1024px)' },
    });
    const afterMount = getListenerCount();

    rerender({ query: '(min-width: 768px)' });
    expect(getListenerCount()).toBe(afterMount);

    unmount();
    expect(getListenerCount()).toBe(0);
  });
});

describe('useMediaQuery inside a real component tree', () => {
  afterEach(() => {
    setViewportWidth(1280);
  });

  it('re-renders the consuming component when the breakpoint flips', async () => {
    function Probe(): React.ReactElement {
      const isMobile = useIsMobile();
      return <span data-testid="layout">{isMobile ? 'mobile' : 'desktop'}</span>;
    }

    setViewportWidth(390);
    const view = render(<Probe />);
    expect(view.getByTestId('layout').textContent).toBe('mobile');

    await act(async () => {
      setViewportWidth(1280);
    });

    expect(view.getByTestId('layout').textContent).toBe('desktop');
  });
});
