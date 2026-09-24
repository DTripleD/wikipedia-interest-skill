/**
 * Visual constants shared by all charts. Colors come from the dataviz reference palette
 * (light mode). The categorical order was checked with its validator: all adjacent pairs
 * pass the CVD and normal-vision floors. Three slots are below 3:1 contrast on the surface,
 * so line charts carry direct end-labels as well as a legend.
 *
 * Charts are static SVG destined for a printed/PDF report: light mode only, no hover layer.
 * The font is Helvetica because PDFKit (Stage 8) has it built in.
 */
import type { Config } from 'vega-lite';

export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const;

export const INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
} as const;

/** De-emphasized data (raw daily views, the earlier period). */
export const DEEMPHASIS = '#c3c2b7';

export const FONT = 'Helvetica, Arial, sans-serif';

export const CHART_CONFIG: Config = {
  background: 'white',
  font: FONT,
  view: { stroke: null },
  title: { anchor: 'start', color: INK.primary, fontSize: 13, fontWeight: 'bold', subtitleColor: INK.secondary, subtitleFontSize: 10, offset: 10 },
  axis: {
    domainColor: INK.axis,
    tickColor: INK.axis,
    gridColor: INK.grid,
    gridWidth: 1,
    labelColor: INK.muted,
    labelFontSize: 9,
    titleColor: INK.secondary,
    titleFontSize: 10,
    titleFontWeight: 'normal',
  },
  legend: { labelColor: INK.secondary, labelFontSize: 10, titleColor: INK.secondary, orient: 'bottom', title: null, symbolStrokeWidth: 2 },
  header: { labelColor: INK.secondary, labelFontSize: 10, title: null },
  line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' },
};
