import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInMonth,
  daysInclusive,
  eachDay,
  fromApiTimestamp,
  isIsoDate,
  toApiDate,
  todayUtc,
} from '../src/dates.js';

describe('date arithmetic', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('counts and lists days inclusively', () => {
    expect(daysInclusive('2024-01-01', '2024-01-01')).toBe(1);
    expect(daysInclusive('2024-01-01', '2024-12-31')).toBe(366);
    expect(daysInclusive('2024-01-02', '2024-01-01')).toBe(0);
    expect(eachDay('2024-02-27', '2024-03-01')).toEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
    expect(eachDay('2024-01-02', '2024-01-01')).toEqual([]);
  });

  it('knows month lengths', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2023-02')).toBe(28);
    expect(daysInMonth('2024-04-15')).toBe(30);
  });

  it('rejects invalid dates', () => {
    expect(() => addDays('2024-02-30', 1)).toThrow(RangeError);
  });
});

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
