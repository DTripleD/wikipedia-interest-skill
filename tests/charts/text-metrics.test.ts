import { describe, expect, it } from 'vitest';
import { helveticaTextWidth, vegaTextWidth } from '../../src/charts/text-metrics.js';

describe('helveticaTextWidth', () => {
  it('sums Helvetica advance widths (AFM units / 1000 × font size)', () => {
    // H 722 + e 556 + l 222 + l 222 + o 556 = 2278
    expect(helveticaTextWidth('Hello', 10)).toBeCloseTo(22.78, 10);
    expect(helveticaTextWidth('Hello', 10, true)).toBeCloseTo(22.78 * 1.08, 10);
    expect(helveticaTextWidth('', 10)).toBe(0);
  });

  it('estimates non-ASCII characters by case', () => {
    expect(helveticaTextWidth('Аб', 10)).toBeCloseTo(12.56, 10); // Cyrillic upper 700 + lower 556
    expect(helveticaTextWidth('→—', 10)).toBe(20);
  });
});

describe('vegaTextWidth', () => {
  it('reads text, size and weight from a Vega item', () => {
    expect(vegaTextWidth({ text: 'Hello', fontSize: 10 })).toBeCloseTo(22.78, 10);
    expect(vegaTextWidth({ text: 'x', fontSize: 10, fontWeight: 'bold' }, 'Hello')).toBeCloseTo(22.78 * 1.08, 10);
    expect(vegaTextWidth({ text: 'Hello', fontWeight: 700 })).toBeCloseTo(22.78 * 1.1 * 1.08, 10); // default size 11
    expect(vegaTextWidth({ text: null })).toBe(0);
  });
});
