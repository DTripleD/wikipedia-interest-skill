/** Number formatting for human-readable messages and chart labels (presentation only). */

/** 1234.5 → "1235", 9.25 → "9.3", 0.5 → "0.5". */
export function formatNumber(x: number): string {
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
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
