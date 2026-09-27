import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluateMediaQuery,
  getListenerCount,
  resetMatchMediaMock,
  setContrast,
  setOrientation,
  setReducedMotion,
  setViewportWidth,
} from '../matchMediaMock';

/**
 * The preference features the mock has to model.
 *
 * A `prefers-reduced-motion` hook that always reads `false` under test passes
 * its own suite while shipping a no-op in the browser, so the branch has to be
 * reachable *and* has to be able to change at runtime. These pin both halves:
 * the initial value a suite sees, and the `change` event a mounted hook needs.
 */
const REDUCE = '(prefers-reduced-motion: reduce)';
const MOTION_FREE = '(prefers-reduced-motion: no-preference)';
const MORE_CONTRAST = '(prefers-contrast: more)';
const NO_CONTRAST = '(prefers-contrast: no-preference)';
const PORTRAIT = '(orientation: portrait)';
const LANDSCAPE = '(orientation: landscape)';

afterEach(() => {
  resetMatchMediaMock();
});

describe('prefers-reduced-motion', () => {
  it('defaults to no preference', () => {
    expect(evaluateMediaQuery(REDUCE)).toBe(false);
    expect(evaluateMediaQuery(MOTION_FREE)).toBe(true);
  });

  it('flips when the preference is set', () => {
    setReducedMotion('reduce');

    expect(evaluateMediaQuery(REDUCE)).toBe(true);
    expect(evaluateMediaQuery(MOTION_FREE)).toBe(false);
  });

  it('notifies a live reduced-motion query', () => {
    const list = window.matchMedia(REDUCE);
    const events: MediaQueryListEvent[] = [];
    list.addEventListener('change', (event) => events.push(event));

    expect(list.matches).toBe(false);

    setReducedMotion('reduce');

    expect(events).toHaveLength(1);
    expect(list.matches).toBe(true);
    expect(events[0]?.media).toBe(REDUCE);
  });

  it('leaves queries that do not name the feature alone', () => {
    const list = window.matchMedia('(min-width: 1024px)');
    let notified = 0;
    list.addEventListener('change', () => {
      notified += 1;
    });

    setReducedMotion('reduce');

    expect(notified).toBe(0);
  });

  it('combines with a width condition as AND', () => {
    setViewportWidth(1280);
    expect(evaluateMediaQuery(`(min-width: 1024px) and ${REDUCE}`)).toBe(false);

    setReducedMotion('reduce');
    expect(evaluateMediaQuery(`(min-width: 1024px) and ${REDUCE}`)).toBe(true);

    setViewportWidth(800);
    expect(evaluateMediaQuery(`(min-width: 1024px) and ${REDUCE}`)).toBe(false);
  });
});

describe('prefers-contrast', () => {
  it('defaults to no preference', () => {
    expect(evaluateMediaQuery(MORE_CONTRAST)).toBe(false);
    expect(evaluateMediaQuery(NO_CONTRAST)).toBe(true);
  });

  it('flips only for the requested value', () => {
    setContrast('more');

    expect(evaluateMediaQuery(MORE_CONTRAST)).toBe(true);
    expect(evaluateMediaQuery(NO_CONTRAST)).toBe(false);
    expect(evaluateMediaQuery('(prefers-contrast: less)')).toBe(false);
  });

  it('notifies a live contrast query', () => {
    const list = window.matchMedia(MORE_CONTRAST);
    const events: MediaQueryListEvent[] = [];
    list.addEventListener('change', (event) => events.push(event));

    setContrast('more');

    expect(events).toHaveLength(1);
    expect(list.matches).toBe(true);
  });
});

describe('orientation', () => {
  it('defaults to landscape', () => {
    expect(evaluateMediaQuery(LANDSCAPE)).toBe(true);
    expect(evaluateMediaQuery(PORTRAIT)).toBe(false);
  });

  it('flips when the orientation is set', () => {
    const list = window.matchMedia(PORTRAIT);
    const events: MediaQueryListEvent[] = [];
    list.addEventListener('change', (event) => events.push(event));

    setOrientation('portrait');

    expect(events).toHaveLength(1);
    expect(evaluateMediaQuery(PORTRAIT)).toBe(true);
    expect(evaluateMediaQuery(LANDSCAPE)).toBe(false);
  });
});

describe('unsupported features', () => {
  it('resolves to false rather than to a silent true', () => {
    // A mock that answers "yes" to a feature it does not model is worse than
    // one that answers "no": it makes the branch look covered.
    for (const query of ['(hover: hover)', '(any-hover: hover)', '(pointer: coarse)', '(min-resolution: 2dppx)']) {
      expect(evaluateMediaQuery(query), query).toBe(false);
    }
  });

  it('poisons a mixed query rather than being ignored', () => {
    setViewportWidth(1280);

    // The width half matches on its own; the unsupported half still fails the
    // query, which is the same answer a browser gives for an unknown feature.
    expect(evaluateMediaQuery('(min-width: 1024px)')).toBe(true);
    expect(evaluateMediaQuery('(min-width: 1024px) and (hover: hover)')).toBe(false);
  });
});

describe('listener bookkeeping', () => {
  it('counts and releases a listener per registered query', () => {
    const before = getListenerCount();
    const onMotionChange = (): void => {};
    const motion = window.matchMedia(REDUCE);
    const contrast = window.matchMedia(MORE_CONTRAST);
    motion.addEventListener('change', onMotionChange);
    contrast.addEventListener('change', () => {});

    expect(getListenerCount()).toBe(before + 2);

    motion.removeEventListener('change', onMotionChange);

    expect(getListenerCount()).toBe(before + 1);
  });

  it('restores every preference on reset', () => {
    setViewportWidth(390);
    setReducedMotion('reduce');
    setContrast('more');
    setOrientation('portrait');

    resetMatchMediaMock();

    expect(evaluateMediaQuery(REDUCE)).toBe(false);
    expect(evaluateMediaQuery(MORE_CONTRAST)).toBe(false);
    expect(evaluateMediaQuery(PORTRAIT)).toBe(false);
    expect(evaluateMediaQuery('(max-width: 767px)')).toBe(false);
    expect(getListenerCount()).toBe(0);
  });
});
