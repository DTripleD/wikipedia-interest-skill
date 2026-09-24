/**
 * Text width for Vega layout without a canvas. Vega's built-in fallback assumes every
 * character is 0.8 em wide, which roughly doubles real widths and leaves large empty margins
 * (long subtitles widen the SVG, and rotated axis titles push the plot down).
 *
 * This uses the Helvetica advance widths from Adobe's core-font metrics (ASCII, in 1/1000 em;
 * the font the PDF report uses), with class-based fallbacks for other characters (Cyrillic,
 * accented Latin, arrows). Bold text is widened by 8 %. It is an estimate for layout only.
 */
const ASCII_WIDTHS = [
  // 32–47: space ! " # $ % & ' ( ) * + , - . /
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  // 48–63: 0–9 : ; < = > ?
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  // 64–79: @ A–O
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  // 80–95: P–Z [ \ ] ^ _
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  // 96–111: ` a–o
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  // 112–126: p–z { | } ~
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function charWidth(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code >= 32 && code <= 126) return ASCII_WIDTHS[code - 32]!;
  if (ch === '—' || ch === '→') return 1000;
  if (ch !== ch.toLowerCase()) return 700; // uppercase letter (Cyrillic, accented Latin)
  return 556;
}

export function helveticaTextWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of text) units += charWidth(ch);
  return (units / 1000) * fontSize * (bold ? 1.08 : 1);
}

interface TextItem {
  text?: unknown;
  fontSize?: number;
  fontWeight?: string | number;
}

/** Signature of Vega's `textMetrics.width(item, text?)`. */
export function vegaTextWidth(item: TextItem, text?: unknown): number {
  const value = text ?? item.text;
  const str = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(' ') : String(value);
  const weight = item.fontWeight;
  const bold = weight === 'bold' || (typeof weight === 'number' && weight >= 600);
  return helveticaTextWidth(str, item.fontSize ?? 11, bold);
}
