import { describe, expect, it } from 'vitest';
import { fromApiTimestamp, isIsoDate, toApiDate, todayUtc } from '../src/dates.js';

describe('isIsoDate', () => {
  it('accepts real dates, including leap days', () => {
    expect(isIsoDate('2024-01-05')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects impossible or malformed dates', () => {
    for (const v of ['2023-02-29', '2024-13-01', '2024-04-31', '20240105', '2024-1-5', '', '2024-01-05T00:00']) {
      expect(isIsoDate(v), v).toBe(false);
    }
  });
});

describe('toApiDate / fromApiTimestamp', () => {
  it('round-trips between ISO and API formats', () => {
    expect(toApiDate('2024-01-05')).toBe('20240105');
    expect(fromApiTimestamp('2024010500')).toBe('2024-01-05');
    expect(fromApiTimestamp('20240105')).toBe('2024-01-05');
  });

  it('rejects malformed values', () => {
    expect(() => toApiDate('2024-02-30')).toThrow(RangeError);
    expect(fromApiTimestamp('2024013200')).toBeNull();
    expect(fromApiTimestamp('abc')).toBeNull();
  });
});

describe('todayUtc', () => {
  it('uses the UTC calendar date', () => {
    expect(todayUtc(new Date('2026-09-23T23:30:00-05:00'))).toBe('2026-09-24');
  });
});
