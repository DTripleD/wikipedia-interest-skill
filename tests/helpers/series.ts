import { addDays } from '../../src/dates.js';
import { buildSeries, type PageviewSeries, type SeriesMeta } from '../../src/data/series.js';

export const META: SeriesMeta = {
  language: 'cs',
  project: 'cs.wikipedia',
  article: 'Přerušovaný_půst',
  access: 'all-access',
  agent: 'user',
};

/** Dense series from `start`; a null value is a day the API omitted (imputed as 0). */
export function makeSeries(start: string, values: ReadonlyArray<number | null>, meta: Partial<SeriesMeta> = {}): PageviewSeries {
  const reported = values.flatMap((v, i) => (v === null ? [] : [{ date: addDays(start, i), views: v }]));
  return buildSeries({ ...META, ...meta }, start, addDays(start, values.length - 1), reported);
}

/** `days` values produced by `f(dayIndex)`. */
export function seriesOf(start: string, days: number, f: (i: number) => number, meta: Partial<SeriesMeta> = {}): PageviewSeries {
  return makeSeries(start, Array.from({ length: days }, (_, i) => f(i)), meta);
}
