/**
 * Controllable `matchMedia` for jsdom.
 *
 * jsdom ships a `matchMedia` that never matches anything and never re-evaluates,
 * which would make every breakpoint-dependent branch in the layout untestable.
 * This module replaces it with an implementation that understands exactly the
 * condition forms the terminal uses — `min-width`, `max-width`, `resolution`,
 * `prefers-reduced-motion`, `prefers-contrast` and `orientation` — combined
 * with AND, and re-evaluates them when the viewport or a preference changes.
 *
 * It is deliberately not a general media-query parser. A feature outside that
 * list resolves to `false`, never to a silent `true`: a mock that answers "yes"
 * to a query it does not understand is how a reduced-motion branch ships
 * untested.
 */

type ChangeListener = (event: MediaQueryListEvent) => void;

/** Values the `prefers-reduced-motion` feature can be asked about. */
export type MotionPreference = 'no-preference' | 'reduce';

/** Values the `prefers-contrast` feature can be asked about. */
export type ContrastPreference = 'no-preference' | 'more' | 'less' | 'custom';

/** Values the `orientation` feature can be asked about. */
export type ViewportOrientation = 'portrait' | 'landscape';

interface FakeMediaQueryList extends MediaQueryList {
  /** Registered listeners, so a viewport change can notify them. */
  __listeners: Set<ChangeListener>;
}

let viewportWidth = 1280;
let devicePixelRatio = 1;
// The defaults are a stock desktop browser, not a test-only shortcut: motion
// allowed, no contrast override, landscape. A suite that wants the other
// branch has to say so through the setters below.
let motionPreference: MotionPreference = 'no-preference';
let contrastPreference: ContrastPreference = 'no-preference';
let orientation: ViewportOrientation = 'landscape';

const tracked = new Set<FakeMediaQueryList>();

/** Every `feature: value` pair in a query, in source order. */
const featurePattern = /([a-z-]+)\s*:\s*([a-z0-9.]+)/gi;

const pxPattern = /(min|max)-width:\s*(\d+(?:\.\d+)?)px/g;
const resolutionPattern = /resolution:\s*(\d+(?:\.\d+)?)dppx/g;
const reducedMotionPattern = /prefers-reduced-motion\s*:\s*(no-preference|reduce)/gi;
const contrastPattern = /prefers-contrast\s*:\s*(no-preference|more|less|custom)/gi;
const orientationPattern = /orientation\s*:\s*(portrait|landscape)/gi;

/** The features this mock models; anything else in a query is unsupported. */
const SUPPORTED_FEATURES = new Set([
  'min-width',
  'max-width',
  'resolution',
  'prefers-reduced-motion',
  'prefers-contrast',
  'orientation',
]);

/** Evaluates the subset of media features the terminal actually queries. */
export function evaluateMediaQuery(query: string): boolean {
  let matched = true;

  // Unsupported feature => no match, checked before anything else so a query
  // like `(hover: hover)` cannot pass by defaulting to true.
  featurePattern.lastIndex = 0;
  let featureMatch = featurePattern.exec(query);
  while (featureMatch !== null) {
    const feature = (featureMatch[1] ?? '').toLowerCase();
    if (!SUPPORTED_FEATURES.has(feature)) return false;
    featureMatch = featurePattern.exec(query);
  }

  pxPattern.lastIndex = 0;
  let widthMatch = pxPattern.exec(query);
  while (widthMatch !== null) {
    const feature = widthMatch[1];
    const value = Number(widthMatch[2]);
    if (feature === 'min' && !(viewportWidth >= value)) matched = false;
    if (feature === 'max' && !(viewportWidth <= value)) matched = false;
    widthMatch = pxPattern.exec(query);
  }

  resolutionPattern.lastIndex = 0;
  const resolutionMatch = resolutionPattern.exec(query);
  if (resolutionMatch !== null) {
    const target = Number(resolutionMatch[1]);
    // Browsers quantise DPR to 0.25 steps; match that so the value is stable.
    if (Math.round(devicePixelRatio * 4) / 4 < target) matched = false;
  }

  reducedMotionPattern.lastIndex = 0;
  const motionMatch = reducedMotionPattern.exec(query);
  if (motionMatch !== null && motionMatch[1] !== motionPreference) matched = false;

  contrastPattern.lastIndex = 0;
  const contrastMatch = contrastPattern.exec(query);
  if (contrastMatch !== null && contrastMatch[1] !== contrastPreference) matched = false;

  orientationPattern.lastIndex = 0;
  const orientationMatch = orientationPattern.exec(query);
  if (orientationMatch !== null && orientationMatch[1] !== orientation) matched = false;

  return matched;
}

function createList(query: string): FakeMediaQueryList {
  const listeners = new Set<ChangeListener>();
  const list = {
    media: query,
    get matches() {
      return evaluateMediaQuery(query);
    },
    onchange: null,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type !== 'change' || typeof listener !== 'function') return;
      listeners.add(listener as ChangeListener);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (type !== 'change' || typeof listener !== 'function') return;
      listeners.delete(listener as ChangeListener);
    },
    dispatchEvent: () => true,
    addListener: (listener: ChangeListener | null) => {
      if (listener !== null) listeners.add(listener);
    },
    removeListener: (listener: ChangeListener | null) => {
      if (listener !== null) listeners.delete(listener);
    },
    __listeners: listeners,
  } as unknown as FakeMediaQueryList;

  tracked.add(list);
  return list;
}

/**
 * Fires a `change` event on every tracked query accepted by `concerns`,
 * exactly as the browser does when the value behind the feature changes.
 */
function notifyQueries(concerns: (media: string) => boolean): void {
  for (const list of tracked) {
    if (!concerns(list.media)) continue;
    for (const listener of list.__listeners) {
      listener({ matches: list.matches, media: list.media } as MediaQueryListEvent);
    }
  }
}

/**
 * Sets the simulated viewport and notifies every live query, exactly as a real
 * window resize would. Components using `useMediaQuery` re-render from the
 * resulting `change` events.
 */
export function setViewportWidth(width: number): void {
  viewportWidth = width;
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
  notifyQueries(() => true);
}

/** Sets the simulated device pixel ratio and notifies listeners. */
export function setDevicePixelRatio(ratio: number): void {
  devicePixelRatio = ratio;
  Object.defineProperty(window, 'devicePixelRatio', { value: ratio, writable: true, configurable: true });
  notifyQueries((media) => media.includes('resolution'));
}

/**
 * Sets the simulated `prefers-reduced-motion` value and notifies listeners.
 *
 * Exists for the same reason `setViewportWidth` does: a hook that switches off
 * its animations on this feature is otherwise unreachable from a suite, and a
 * suite that cannot reach the branch cannot catch it breaking.
 */
export function setReducedMotion(preference: MotionPreference): void {
  motionPreference = preference;
  notifyQueries((media) => media.includes('prefers-reduced-motion'));
}

/** Sets the simulated `prefers-contrast` value and notifies listeners. */
export function setContrast(preference: ContrastPreference): void {
  contrastPreference = preference;
  notifyQueries((media) => media.includes('prefers-contrast'));
}

/** Sets the simulated `orientation` value and notifies listeners. */
export function setOrientation(value: ViewportOrientation): void {
  orientation = value;
  notifyQueries((media) => media.includes('orientation'));
}

export function installMatchMediaMock(): void {
  window.matchMedia = ((query: string) => createList(query)) as typeof window.matchMedia;
}

/** Total live `change` listeners across every query created so far. */
export function getListenerCount(): number {
  let total = 0;
  for (const list of tracked) {
    total += list.__listeners.size;
  }
  return total;
}

/** Clears tracked listeners between tests so a stale component cannot leak. */
export function resetMatchMediaMock(): void {
  tracked.clear();
  viewportWidth = 1280;
  devicePixelRatio = 1;
  motionPreference = 'no-preference';
  contrastPreference = 'no-preference';
  orientation = 'landscape';
  installMatchMediaMock();
}
