import { describe, expect, it } from 'vitest';
import {
  acgSecretsUrlForSeason,
  buildSeasonWindow,
  previousSeasonKey,
  seasonKeyForDate
} from '../../src/server/season-window.js';
import type { SeasonCatalog, SeasonEntry, SeasonKind } from '../../src/server/types.js';

function entry(subjectId: number, seasonKind: SeasonKind, normalPremiereDate: string): SeasonEntry {
  return {
    subjectId,
    seasonKey: '2026Q3',
    seasonKind,
    normalPremiereDate,
    airTime: '20:00',
    dayOffset: 0
  };
}

function catalog(seasonKey: string, entries: SeasonEntry[]): SeasonCatalog {
  return {
    seasonKey,
    entries: new Map(entries.map((item) => [item.subjectId, { ...item, seasonKey }]))
  };
}

describe('season window', () => {
  it('derives Shanghai quarter keys, previous quarters, and ACG URLs', () => {
    expect(seasonKeyForDate(new Date('2026-06-30T16:30:00Z'))).toBe('2026Q3');
    expect(previousSeasonKey('2026Q1')).toBe('2025Q4');
    expect(acgSecretsUrlForSeason('2026Q3')).toBe('https://acgsecrets.hk/bangumi/202607/');
  });

  it('keeps old and new quarters for fourteen natural days', () => {
    const current = catalog('2026Q3', [entry(101, 'new', '2026-07-04'), entry(202, 'continuing', '2026-07-06')]);
    const previous = catalog('2026Q2', [entry(303, 'new', '2026-04-02')]);

    expect([...buildSeasonWindow('2026-07-04', current, previous).activeSubjectIds]).toEqual([101, 202, 303]);
    expect([...buildSeasonWindow('2026-07-17', current, previous).activeSubjectIds]).toEqual([101, 202, 303]);
    expect([...buildSeasonWindow('2026-07-18', current, previous).activeSubjectIds]).toEqual([101, 202]);
  });

  it('falls back to quarter start when no normal premiere exists', () => {
    const window = buildSeasonWindow('2026-07-10', catalog('2026Q3', []), catalog('2026Q2', []));

    expect(window.anchorDate).toBe('2026-07-01');
    expect(window.overlapThrough).toBe('2026-07-14');
  });
});
