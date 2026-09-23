import { describe, expect, it } from 'vitest';
import { todayInShanghai, weekdayFromDate } from '../../src/shared/date.js';

describe('shared Shanghai dates', () => {
  it.each([
    ['2026-12-31T15:59:59Z', '2026-12-31', 4],
    ['2026-12-31T16:00:00Z', '2027-01-01', 5],
    ['2026-07-18T17:00:00Z', '2026-07-19', 7],
    ['2024-02-28T16:00:00Z', '2024-02-29', 4]
  ])('maps %s to its Shanghai date and weekday', (timestamp, date, weekday) => {
    expect(todayInShanghai(new Date(timestamp))).toBe(date);
    expect(weekdayFromDate(date)).toBe(weekday);
  });

  it.each(['', 'invalid', '2026-13-01', '2026-7-1'])('rejects unparseable calendar dates: %s', (date) => {
    expect(weekdayFromDate(date)).toBeNull();
  });
});
