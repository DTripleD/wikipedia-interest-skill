import { describe, expect, it } from 'vitest';
import { formatNumber, formatSignificant, plural } from '../src/format.js';

describe('format', () => {
  it('formatSignificant keeps three significant digits so small per-million values stay distinct', () => {
    expect([0.1234, 0.28, 3.97, 12.77, 57.56, 221.14, 1234.5].map(formatSignificant)).toEqual(['0.123', '0.28', '3.97', '12.8', '57.6', '221', '1235']);
    // formatNumber (one decimal) would merge 0.12 and 0.14 into "0.1".
    expect(formatNumber(0.12)).toBe(formatNumber(0.14));
    expect(formatSignificant(0.12)).not.toBe(formatSignificant(0.14));
  });

  it('plural uses the singular for exactly one', () => {
    expect([plural(1, 'day'), plural(0, 'day'), plural(3, 'view')]).toEqual(['1 day', '0 days', '3 views']);
  });
});
