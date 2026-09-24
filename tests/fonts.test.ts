import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { vegaTextWidth } from '../src/charts/text-metrics.js';
import { FONT_FILES, missingGlyphs, textWidth } from '../src/fonts.js';

describe('embedded font', () => {
  it('measures text like PDFKit does with the same font file', () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    for (const [bold, file] of [[false, FONT_FILES.regular], [true, FONT_FILES.bold]] as const) {
      doc.font(file).fontSize(10);
      for (const text of ['Hello', 'Астрономія — uk.wikipedia', 'Přerušovaný půst', 'Views per million edition pageviews']) {
        expect(textWidth(text, 10, bold)).toBeCloseTo(doc.widthOfString(text), 3);
      }
    }
    expect(textWidth('', 10)).toBe(0);
    expect(textWidth('Hello', 10, true)).toBeGreaterThan(textWidth('Hello', 10));
  });

  it('reports characters without a glyph', () => {
    expect(missingGlyphs('Астрономія, Přerušovaný půst, Αστρονομία — Theil–Sen')).toEqual([]);
    expect(missingGlyphs('≈ 28 → 6 ▲ 天文')).toEqual(['≈', '→', '▲', '天', '文']);
  });
});

describe('vegaTextWidth', () => {
  it('reads text, size and weight from a Vega item', () => {
    expect(vegaTextWidth({ text: 'Hello', fontSize: 10 })).toBeCloseTo(textWidth('Hello', 10), 10);
    expect(vegaTextWidth({ text: 'x', fontSize: 10, fontWeight: 'bold' }, 'Hello')).toBeCloseTo(textWidth('Hello', 10, true), 10);
    expect(vegaTextWidth({ text: 'Hello', fontWeight: 700 })).toBeCloseTo(textWidth('Hello', 11, true), 10); // Vega default size 11
    expect(vegaTextWidth({ text: ['a', 'b'] })).toBeCloseTo(textWidth('a b', 11), 10);
    expect(vegaTextWidth({ text: null })).toBe(0);
  });
});
