/** Number formatting for human-readable messages and chart labels (presentation only). */

/** 1234.5 → "1235", 9.25 → "9.3", 0.5 → "0.5". */
export function formatNumber(x: number): string {
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
}

/** Three significant digits for small ratios: 0.1234 → "0.123", 3.97 → "3.97", 57.56 → "57.6", 221.1 → "221". */
export function formatSignificant(x: number): string {
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Number(x.toPrecision(3)));
}

/** 1 → "1 day", 3 → "3 days" (English messages only). */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** 0.183 → "18%". */
export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** 0.134 → "+13%", −0.5 → "-50%", 0 → "0%". */
export function formatSignedPercent(change: number): string {
  const v = Math.round(change * 100);
  return `${v > 0 ? '+' : ''}${v === 0 ? 0 : v}%`;
}

/** "p < 0.001", "p = 0.008", "p = 0.03". */
export function formatPValue(p: number): string {
  return p < 0.001 ? 'p < 0.001' : `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}

/** 12345.6 → "12,346". */
export function formatInteger(x: number): string {
  return Math.round(x).toLocaleString('en-US');
}
