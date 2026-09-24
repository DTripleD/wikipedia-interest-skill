import { addDays, daysInMonth } from '../../src/dates.js';
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

/** Whole calendar months from `firstMonth` (`YYYY-MM`); every day of month k has `dailyViews[k]` views. */
export function monthlySeries(firstMonth: string, dailyViews: readonly number[], meta: Partial<SeriesMeta> = {}): PageviewSeries {
  const values: number[] = [];
  let [y, m] = firstMonth.split('-').map(Number) as [number, number];
  for (const v of dailyViews) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    for (let d = 0; d < daysInMonth(month); d++) values.push(v);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return makeSeries(`${firstMonth}-01`, values, meta);
}
