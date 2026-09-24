/**
 * One-page A4 PDF report (PDFKit + svg-to-pdfkit, vector charts, embedded Noto Sans).
 *
 * Layout, top to bottom: title and subtitle, the attention-not-demand banner, the metrics
 * table, the charts, then two columns (findings and analyst note | confidence and limitations),
 * and a footer. All text blocks are measured first; the charts are scaled into the height that
 * is left, so the report always fits on one page.
 */
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { TOOL_NAME, TOOL_VERSION } from '../config.js';
import { renderSvg } from '../charts/render.js';
import { INK } from '../charts/theme.js';
import { FONT_FILES } from '../fonts.js';
import { buildReportModel, type ReportInput, type ReportModel } from './content.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const CONTENT_WIDTH = A4.width - 2 * MARGIN;
const COLUMN_GAP = 18;
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2;
const SECTION_GAP = 10;
const BULLET_INDENT = 9;
const BANNER_FILL = '#f0efec';
/** Table column widths (sum = CONTENT_WIDTH); columns 2–6 are numbers and right-aligned. */
const TABLE_COLUMNS = [48, 112, 56, 64, 58, 44, 72, 69.28];
const NUMERIC_COLUMNS = new Set([2, 3, 4, 5, 6]);
const ROW_HEIGHT = 13;
/** Charts are never drawn smaller than this share of their natural size. */
const MIN_CHART_SCALE = 0.45;

/** Cell padding on each side of a table column. */
const CELL_PADDING = 5;
/**
 * Ligatures off: with them "fi" becomes one glyph and text extracted from the PDF reads
 * "Confdence". fontkit accepts a {tag: false} object (the PDFKit typings only list arrays).
 */
const NO_LIGATURES = { liga: false, clig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

const REGULAR = 'NotoSans';
const BOLD = 'NotoSans-Bold';

type Doc = PDFKit.PDFDocument;

export interface Report {
  pdf: Buffer;
  model: ReportModel;
}

/** Builds the report content and renders it to a PDF buffer. */
export async function generateReport(input: ReportInput): Promise<Report> {
  const model = buildReportModel(input);
  const svgs = await Promise.all(model.charts.map((chart) => renderSvg(chart.spec)));
  const { pdf, warnings } = await renderReportPdf(model, svgs, input.generatedAt);
  return { pdf, model: { ...model, warnings: [...model.warnings, ...warnings] } };
}

/**
 * Renders the page. If the charts do not fit at MIN_CHART_SCALE, the later charts are dropped
 * (with a warning) until they do; if even the first one does not fit, it throws.
 */
export async function renderReportPdf(model: ReportModel, svgs: readonly string[], generatedAt: Date): Promise<{ pdf: Buffer; warnings: string[] }> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: model.title, Author: TOOL_NAME, Subject: 'Wikipedia pageview analysis', CreationDate: generatedAt, ModDate: generatedAt },
  });
  doc.registerFont(REGULAR, FONT_FILES.regular);
  doc.registerFont(BOLD, FONT_FILES.bold);
  const done = collect(doc);

  let y = MARGIN;
  y = text(doc, model.title, MARGIN, y, CONTENT_WIDTH, { font: BOLD, size: 16 }) + 2;
  y = text(doc, model.subtitle, MARGIN, y, CONTENT_WIDTH, { size: 8.5, color: INK.secondary }) + 6;

  // Banner.
  const bannerText = { size: 8.5, font: BOLD };
  const bannerHeight = measure(doc, model.attentionBanner, CONTENT_WIDTH - 12, bannerText) + 8;
  doc.rect(MARGIN, y, CONTENT_WIDTH, bannerHeight).fill(BANNER_FILL);
  text(doc, model.attentionBanner, MARGIN + 6, y + 4, CONTENT_WIDTH - 12, bannerText);
  y += bannerHeight + SECTION_GAP;

  y = table(doc, model.table.header, model.table.rows, y) + SECTION_GAP;

  // Measure the bottom columns and the footer, then give the charts the rest.
  const footer = `Source: Wikimedia Pageviews API (per-article and aggregate, agent=user). All numbers are computed deterministically by ${TOOL_NAME} ${TOOL_VERSION}; only the analyst note is free text.`;
  const footerHeight = measure(doc, footer, CONTENT_WIDTH, { size: 7 });
  const left = leftColumn(model);
  const right = rightColumn(model);
  const columnsHeight = Math.max(blocksHeight(doc, left), blocksHeight(doc, right));
  const footerTop = A4.height - MARGIN - footerHeight;
  const chartSpace = footerTop - SECTION_GAP - columnsHeight - SECTION_GAP - y;

  const warnings: string[] = [];
  let shown = [...svgs];
  while (shown.length > 1 && chartShrink(shown, chartSpace) < MIN_CHART_SCALE) shown = shown.slice(0, -1);
  if (shown.length < svgs.length) warnings.push(`Not enough room on the page: ${svgs.length - shown.length} chart(s) left out.`);
  y = charts(doc, shown, y, chartSpace) + SECTION_GAP;
  drawBlocks(doc, left, MARGIN, y);
  drawBlocks(doc, right, MARGIN + COLUMN_WIDTH + COLUMN_GAP, y);
  text(doc, footer, MARGIN, footerTop, CONTENT_WIDTH, { size: 7, color: INK.muted });

  const pages = doc.bufferedPageRange().count;
  doc.end();
  const pdf = await done;
  if (pages !== 1) throw new Error(`The report layout overflowed to ${pages} pages.`);
  return { pdf, warnings };
}

// ---------------------------------------------------------------------------
// Text blocks
// ---------------------------------------------------------------------------

interface TextStyle {
  font?: string;
  size?: number;
  color?: string;
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'label'; text: string }
  | { kind: 'paragraph'; text: string; size: number }
  | { kind: 'bullets'; items: string[]; size: number };

function leftColumn(model: ReportModel): Block[] {
  const blocks: Block[] = [{ kind: 'heading', text: 'Findings' }, { kind: 'bullets', items: model.findings, size: 8.5 }];
  if (model.analystNote) {
    blocks.push({ kind: 'label', text: 'Analyst note (written by the AI agent, not computed):' }, { kind: 'paragraph', text: model.analystNote, size: 8.5 });
  }
  return blocks;
}

function rightColumn(model: ReportModel): Block[] {
  return [
    { kind: 'heading', text: `Confidence: ${model.confidence.level.toUpperCase()}` },
    { kind: 'bullets', items: model.confidence.reasons, size: 8 },
    { kind: 'heading', text: 'Limitations' },
    { kind: 'bullets', items: model.limitations, size: 7.5 },
  ];
}

function blockStyle(block: Block): TextStyle {
  switch (block.kind) {
    case 'heading':
      return { font: BOLD, size: 10 };
    case 'label':
      return { font: BOLD, size: 8, color: INK.secondary };
    default:
      return { size: block.size };
  }
}

function blockHeight(doc: Doc, block: Block): number {
  if (block.kind === 'bullets') {
    return block.items.reduce((h, item) => h + measure(doc, item, COLUMN_WIDTH - BULLET_INDENT, { size: block.size }) + 2, 0);
  }
  return measure(doc, block.text, COLUMN_WIDTH, blockStyle(block)) + (block.kind === 'heading' ? 3 : 2);
}

function blocksHeight(doc: Doc, blocks: readonly Block[]): number {
  return blocks.reduce((h, b, i) => h + blockHeight(doc, b) + (b.kind === 'heading' && i > 0 ? 6 : 0), 0);
}

function drawBlocks(doc: Doc, blocks: readonly Block[], x: number, y: number): void {
  blocks.forEach((block, i) => {
    if (block.kind === 'heading' && i > 0) y += 6;
    if (block.kind === 'bullets') {
      for (const item of block.items) {
        text(doc, '•', x, y, BULLET_INDENT, { size: block.size, color: INK.secondary });
        y = text(doc, item, x + BULLET_INDENT, y, COLUMN_WIDTH - BULLET_INDENT, { size: block.size }) + 2;
      }
    } else {
      y = text(doc, block.text, x, y, COLUMN_WIDTH, blockStyle(block)) + (block.kind === 'heading' ? 3 : 2);
    }
  });
}

// ---------------------------------------------------------------------------
// Table and charts
// ---------------------------------------------------------------------------

function table(doc: Doc, header: readonly string[], rows: readonly string[][], y: number): number {
  const drawRow = (cells: readonly string[], rowY: number, font: string, color: string) => {
    let x = MARGIN;
    cells.forEach((cell, c) => {
      const width = TABLE_COLUMNS[c]!;
      doc.font(font).fontSize(8).fillColor(color);
      const inner = width - 2 * CELL_PADDING;
      doc.text(fit(doc, cell, inner), x + CELL_PADDING, rowY + 2.5, {
        width: inner,
        lineBreak: false,
        align: NUMERIC_COLUMNS.has(c) ? 'right' : 'left',
        features: NO_LIGATURES,
      });
      x += width;
    });
  };
  drawRow(header, y, BOLD, INK.secondary);
  y += ROW_HEIGHT;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.75).strokeColor(INK.axis).stroke();
  for (const row of rows) {
    drawRow(row, y, REGULAR, INK.primary);
    y += ROW_HEIGHT;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor(INK.grid).stroke();
  }
  return y;
}

/**
 * Draws the charts stacked. All charts share one scale (so their text sizes match): the
 * widest chart fits the content width, and the stack fits `space` in height.
 */
function charts(doc: Doc, svgs: readonly string[], y: number, space: number): number {
  const sizes = svgs.map(svgSize);
  const shrink = chartShrink(svgs, space);
  if (shrink < MIN_CHART_SCALE) throw new Error('Not enough room for the charts on one page.');
  const scale = Math.min(1, ...sizes.map((s) => CONTENT_WIDTH / s.width)) * shrink;
  svgs.forEach((svg, i) => {
    const size = sizes[i]!;
    const width = size.width * scale;
    const height = size.height * scale;
    // svg-to-pdfkit sizes the drawing from the root width/height attributes (observed: the
    // width/height options alone do not scale it), so rewrite them; the viewBox scales the
    // content. assumePt: without it those attributes are read as px and drawn at 0.75×.
    SVGtoPDF(doc as unknown as typeof PDFDocument, resizeSvg(svg, width, height), MARGIN, y, {
      width,
      height,
      assumePt: true,
      fontCallback: (_family, bold) => (bold ? BOLD : REGULAR),
    });
    y += height + (i < svgs.length - 1 ? SECTION_GAP : 0);
  });
  return y;
}

/** How much the stacked charts must shrink (≤ 1) beyond fitting the width to fit `space`. */
function chartShrink(svgs: readonly string[], space: number): number {
  const sizes = svgs.map(svgSize);
  const fitWidth = Math.min(1, ...sizes.map((s) => CONTENT_WIDTH / s.width));
  const naturalHeight = sizes.reduce((h, s) => h + s.height * fitWidth, 0);
  return Math.min(1, (space - SECTION_GAP * (svgs.length - 1)) / naturalHeight);
}

function resizeSvg(svg: string, width: number, height: number): string {
  return svg.replace(/^<svg([^>]*?)\swidth="[\d.]+"([^>]*?)\sheight="[\d.]+"/, `<svg$1 width="${width}"$2 height="${height}"`);
}

function svgSize(svg: string): { width: number; height: number } {
  const m = /^<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg);
  if (!m) throw new Error('Chart SVG has no width/height.');
  return { width: Number(m[1]), height: Number(m[2]) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyStyle(doc: Doc, style: TextStyle): void {
  doc.font(style.font ?? REGULAR).fontSize(style.size ?? 9).fillColor(style.color ?? INK.primary);
}

function measure(doc: Doc, value: string, width: number, style: TextStyle): number {
  applyStyle(doc, style);
  return doc.heightOfString(value, { width, features: NO_LIGATURES });
}

/** Draws wrapped text at (x, y) and returns the y below it. */
function text(doc: Doc, value: string, x: number, y: number, width: number, style: TextStyle): number {
  applyStyle(doc, style);
  const height = doc.heightOfString(value, { width, features: NO_LIGATURES });
  doc.text(value, x, y, { width, features: NO_LIGATURES });
  return y + height;
}

/** Shortens `value` with an ellipsis until it fits `width` in the current font. */
function fit(doc: Doc, value: string, width: number): string {
  const widthOf = (s: string) => doc.widthOfString(s, { features: NO_LIGATURES });
  if (widthOf(value) <= width) return value;
  let chars = [...value];
  while (chars.length > 1 && widthOf(`${chars.join('')}…`) > width) chars = chars.slice(0, -1);
  return `${chars.join('')}…`;
}

function collect(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
