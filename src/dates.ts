/**
 * Calendar-date helpers. All dates are ISO `YYYY-MM-DD` strings interpreted in UTC,
 * which is the time zone used by the Wikimedia Pageviews API.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const API_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})?$/;

/** True if `value` is a real calendar date in strict `YYYY-MM-DD` form. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.toISOString().slice(0, 10) === value;
}

/** `2024-01-05` → `20240105` (the API's YYYYMMDD format). */
export function toApiDate(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`Invalid ISO date: "${isoDate}"`);
  return isoDate.replaceAll('-', '');
}

/** `2024010500` or `20240105` → `2024-01-05`. Returns null if malformed. */
export function fromApiTimestamp(timestamp: string): string | null {
  const m = API_TIMESTAMP.exec(timestamp);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isIsoDate(iso) ? iso : null;
}

const DAY_MS = 86_400_000;

function toUtcMs(isoDate: string): number {
  if (!isIsoDate(isoDate)) throw new RangeError(`Invalid ISO date: "${isoDate}"`);
  return Date.parse(`${isoDate}T00:00:00Z`);
}

/** `addDays('2024-02-28', 2)` → `2024-03-01`. Negative values go back in time. */
export function addDays(isoDate: string, days: number): string {
  return new Date(toUtcMs(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Number of days in the inclusive range; 0 if `end` is before `start`. */
export function daysInclusive(start: string, end: string): number {
  return Math.max(0, Math.round((toUtcMs(end) - toUtcMs(start)) / DAY_MS) + 1);
}

/** Every date from `start` to `end`, inclusive. */
export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Days in the calendar month of `YYYY-MM` (or of a `YYYY-MM-DD` date). */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Current UTC date as `YYYY-MM-DD`. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
