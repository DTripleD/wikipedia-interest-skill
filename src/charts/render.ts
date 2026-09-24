/**
 * Renders a Vega-Lite spec to an SVG string in Node, headless (renderer "none"). No canvas
 * is needed: text widths come from Helvetica metrics (text-metrics.ts), installed through
 * Vega's `textMetrics.width` hook (the same hook vl-convert uses; it is not in Vega's typings).
 */
import * as vega from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { vegaTextWidth } from './text-metrics.js';

export interface Chart {
  spec: TopLevelSpec;
  svg: string;
}

(vega as unknown as { textMetrics: { width: typeof vegaTextWidth } }).textMetrics.width = vegaTextWidth;

export async function renderSvg(spec: TopLevelSpec): Promise<string> {
  const view = new vega.View(vega.parse(compile(spec).spec), { renderer: 'none' });
  try {
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}

export async function toChart(spec: TopLevelSpec): Promise<Chart> {
  return { spec, svg: await renderSvg(spec) };
}
