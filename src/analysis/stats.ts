/**
 * Basic descriptive statistics. Pure functions; empty input is a programming error
 * (RangeError) unless the function documents a null result.
 */

function requireValues(xs: readonly number[], name: string): void {
  if (xs.length === 0) throw new RangeError(`${name} of an empty list is undefined.`);
}

export function sum(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}

export function mean(xs: readonly number[]): number {
  requireValues(xs, 'mean');
  return sum(xs) / xs.length;
}

export function median(xs: readonly number[]): number {
  requireValues(xs, 'median');
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Sample standard deviation (n − 1); null for fewer than 2 values. */
export function sampleStdDev(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Sample standard deviation / mean; null for fewer than 2 values or a zero mean. */
export function coefficientOfVariation(xs: readonly number[]): number | null {
  const sd = sampleStdDev(xs);
  if (sd === null) return null;
  const m = mean(xs);
  return m === 0 ? null : sd / m;
}

/** Median absolute deviation from `center` (default: the median). Unscaled. */
export function medianAbsoluteDeviation(xs: readonly number[], center: number = median(xs)): number {
  return median(xs.map((x) => Math.abs(x - center)));
}

/** Mean absolute deviation from `center`. */
export function meanAbsoluteDeviation(xs: readonly number[], center: number): number {
  return mean(xs.map((x) => Math.abs(x - center)));
}

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 approximation of erf
 * (absolute error < 1.5e-7), which is ample for p-values.
 */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
