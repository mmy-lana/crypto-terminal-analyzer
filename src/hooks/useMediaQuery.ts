import { useEffect, useState } from 'react';

/** The plan's mobile ceiling: every rule below 768px is the phone layout. */
export const MOBILE_BREAKPOINT_PX = 768;

/**
 * Subscribes to a CSS media query.
 *
 * `useSyncExternalStore` would need a cached server snapshot; the terminal is
 * a single-page app rendered on the client, so a plain effect subscription is
 * both sufficient and one less moving part. The initial read is wrapped in a
 * guard because `matchMedia` is absent in some test environments and in
 * older embedded webviews.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const list = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    setMatches(list.matches);
    list.addEventListener('change', handleChange);
    return () => list.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}

/** True on phone-sized viewports (<= 767px). */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
}

/** True on tablet-sized viewports (768px - 1023px). */
export function useIsTablet(): boolean {
  return useMediaQuery(`(min-width: ${MOBILE_BREAKPOINT_PX}px) and (max-width: 1023px)`);
}

/** True on desktop workstations (>= 1024px). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}
