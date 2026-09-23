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

/** Current UTC date as `YYYY-MM-DD`. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
