/**
 * The embedded font: Noto Sans (SIL Open Font License, assets/fonts/OFL.txt), static
 * unhinted TTFs from notofonts/latin-greek-cyrillic release NotoSans-v2.015. PDFKit's built-in
 * fonts only cover WinAnsi (Latin), so Cyrillic article titles need an embedded font.
 * Coverage: Latin, Greek, Cyrillic. Not covered: CJK, Arabic, Hebrew, Indic scripts, and
 * symbols such as ≈ → ▲ (so the code writes them out in words).
 */
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { PROJECT_ROOT } from './config.js';

export const FONT_FILES = {
  regular: join(PROJECT_ROOT, 'assets', 'fonts', 'NotoSans-Regular.ttf'),
  bold: join(PROJECT_ROOT, 'assets', 'fonts', 'NotoSans-Bold.ttf'),
} as const;

/** CSS family name used in chart SVGs (with fallbacks for viewing the SVG on its own). */
export const FONT_FAMILY = 'Noto Sans, Helvetica, Arial, sans-serif';

let loaded: { regular: fontkit.Font; bold: fontkit.Font } | null = null;

function fonts(): { regular: fontkit.Font; bold: fontkit.Font } {
  if (loaded === null) {
    const open = (path: string): fontkit.Font => {
      const font = fontkit.openSync(path);
      if ('fonts' in font) throw new Error(`${path} is a font collection, expected a single font.`);
      return font;
    };
    loaded = { regular: open(FONT_FILES.regular), bold: open(FONT_FILES.bold) };
  }
  return loaded;
}

/** Advance width of `text` in the embedded font, in the same unit as `fontSize`. */
export function textWidth(text: string, fontSize: number, bold = false): number {
  if (text === '') return 0;
  const font = bold ? fonts().bold : fonts().regular;
  return (font.layout(text).advanceWidth / font.unitsPerEm) * fontSize;
}

/** Characters of `text` the embedded font has no glyph for (unique, in order of appearance). */
export function missingGlyphs(text: string): string[] {
  const font = fonts().regular;
  const missing = new Set<string>();
  for (const ch of text) {
    if (!/\s/.test(ch) && !font.hasGlyphForCodePoint(ch.codePointAt(0)!)) missing.add(ch);
  }
  return [...missing];
}
