/**
 * Text width for Vega layout without a canvas. Vega's built-in fallback assumes every
 * character is 0.8 em wide, which roughly doubles real widths and leaves large empty margins
 * (long subtitles widen the SVG, and rotated axis titles push the plot down).
 *
 * Widths come from the embedded Noto Sans (src/fonts.ts), the font the PDF report draws the
 * charts with, so the layout matches the final output.
 */
import { textWidth } from '../fonts.js';

interface TextItem {
  text?: unknown;
  fontSize?: number;
  fontWeight?: string | number;
}

/** Signature of Vega's `textMetrics.width(item, text?)`; Vega's default font size is 11. */
export function vegaTextWidth(item: TextItem, text?: unknown): number {
  const value = text ?? item.text;
  const str = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(' ') : String(value);
  const weight = item.fontWeight;
  const bold = weight === 'bold' || (typeof weight === 'number' && weight >= 600);
  return textWidth(str, item.fontSize ?? 11, bold);
}
