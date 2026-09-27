// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  calculateDrawdownSeries,
  calculatePearsonCorrelation,
  calculateMaxDrawdown,
} from '../finance';

describe('calculatePearsonCorrelation', () => {
  it('returns 1 for a series perfectly correlated with itself', () => {
    const series = [0.01, -0.02, 0.03, 0.005, -0.011];
    expect(calculatePearsonCorrelation(series, series)).toBeCloseTo(1, 10);
  });

  it('returns -1 for a perfectly inversely correlated series', () => {
    const left = [0.01, -0.02, 0.03, 0.005, -0.011];
    const right = left.map((value) => -value);
    expect(calculatePearsonCorrelation(left, right)).toBeCloseTo(-1, 10);
  });

  it('separates co-moving from counter-moving series by sign', () => {
    const left = [0.01, -0.02, 0.03, 0.005, -0.011, 0.02, -0.006];
    const sameDirection = left.map((value, index) => value + index * 0.001);
    const opposite = left.map((value, index) => -value - index * 0.001);

    expect(calculatePearsonCorrelation(left, sameDirection)).toBeGreaterThan(0.9);
    expect(calculatePearsonCorrelation(left, opposite)).toBeLessThan(-0.9);
  });

  it('is invariant to a positive linear rescaling of either series', () => {
    const left = [0.01, -0.02, 0.03, 0.005];
    const right = [0.02, -0.01, 0.05, 0.011];
    const baseline = calculatePearsonCorrelation(left, right);
    expect(calculatePearsonCorrelation(left, right.map((v) => v * 7.5))).toBeCloseTo(baseline, 10);
    expect(calculatePearsonCorrelation(left.map((v) => v * 3), right)).toBeCloseTo(baseline, 10);
  });

  it('is invariant to a constant offset on either series', () => {
    const left = [0.01, -0.02, 0.03, 0.005];
    const right = [0.02, -0.01, 0.05, 0.011];
    const baseline = calculatePearsonCorrelation(left, right);
    expect(calculatePearsonCorrelation(left.map((v) => v + 100), right)).toBeCloseTo(baseline, 10);
    expect(calculatePearsonCorrelation(left, right.map((v) => v - 42))).toBeCloseTo(baseline, 10);
  });

  it('is symmetric', () => {
    const left = [0.01, -0.02, 0.03, 0.005, -0.011];
    const right = [0.02, 0.01, -0.005, 0.04, -0.02];
    expect(calculatePearsonCorrelation(left, right)).toBeCloseTo(
      calculatePearsonCorrelation(right, left),
      12
    );
  });

  it('returns 0 rather than NaN for a constant series', () => {
    // Zero variance makes the denominator zero; the coefficient is undefined,
    // so the contract is 0 — a NaN here would poison the matrix rendering.
    expect(calculatePearsonCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
    expect(calculatePearsonCorrelation([1, 2, 3, 4], [2, 2, 2, 2])).toBe(0);
    expect(calculatePearsonCorrelation([1, 1, 1, 1], [1, 1, 1, 1])).toBe(0);
  });

  it('returns 0 for series too short to correlate', () => {
    expect(calculatePearsonCorrelation([], [])).toBe(0);
    expect(calculatePearsonCorrelation([1], [2])).toBe(0);
  });

  it('truncates to the shorter series instead of returning NaN', () => {
    const result = calculatePearsonCorrelation([1, 2, 3, 4, 5, 6], [1, 2, 3]);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeCloseTo(1, 10);
  });

  it('never returns a value outside [-1, 1] despite float overshoot', () => {
    const left = [1e-8, 2e-8, 3e-8, 4e-8, 5e-8];
    const result = calculatePearsonCorrelation(left, left);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(-1);
  });
});

describe('calculateDrawdownSeries', () => {
  it('starts at 0 because the first point is its own peak', () => {
    expect(calculateDrawdownSeries([100, 110, 105])[0]).toBe(0);
  });

  it('measures each point against its running peak, not the global peak', () => {
    // Peak 100 -> 0%, 120 -> 0%, 60 -> 50% below 120, 120 -> 0% again.
    expect(calculateDrawdownSeries([100, 120, 60, 120]).map((v) => Number(v.toFixed(4)))).toEqual([
      0, 0, 50, 0,
    ]);
  });

  it('returns all zeros for a monotonically rising curve', () => {
    expect(calculateDrawdownSeries([1, 2, 3, 4, 5])).toEqual([0, 0, 0, 0, 0]);
  });

  it('returns all zeros for a flat curve', () => {
    expect(calculateDrawdownSeries([50, 50, 50])).toEqual([0, 0, 0]);
  });

  it('returns an empty series for an empty curve', () => {
    expect(calculateDrawdownSeries([])).toEqual([]);
  });

  it('agrees with calculateMaxDrawdown at its deepest point', () => {
    const curve = [100, 140, 90, 120, 80, 160, 150];
    const series = calculateDrawdownSeries(curve);
    // calculateMaxDrawdown is a display metric and rounds to 2dp, so compare
    // to that precision rather than to full float equality.
    expect(Math.max(...series)).toBeCloseTo(calculateMaxDrawdown(curve), 1);
  });

  it('never reports a negative drawdown', () => {
    const curve = [100, 50, 200, 10, 300, 250];
    expect(calculateDrawdownSeries(curve).every((value) => value >= 0)).toBe(true);
  });

  it('reports 0 rather than dividing by zero on a non-positive peak', () => {
    expect(calculateDrawdownSeries([0, -10, -5])).toEqual([0, 0, 0]);
  });

  it('carries the peak forward across a non-finite reading', () => {
    // A NaN sample must stay finite so the area chart still plots, and must
    // not stop the peak from recovering on the samples after it.
    expect(calculateDrawdownSeries([100, Number.NaN, 50])).toEqual([0, 0, 50]);
    expect(calculateDrawdownSeries([100, 80, Number.POSITIVE_INFINITY, 80])).toEqual([0, 20, 20, 20]);
  });

  it('always returns a same-length, all-finite series', () => {
    const curve = [100, Number.NaN, 120, Number.POSITIVE_INFINITY, 60, 0, -5];
    const series = calculateDrawdownSeries(curve);
    expect(series).toHaveLength(curve.length);
    expect(series.every((value) => Number.isFinite(value))).toBe(true);
  });
});
