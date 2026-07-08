import { describe, expect, it } from 'vitest';
import type { EpisodeRow } from '../../src/server/types.js';
import { buildReminderCandidates, shouldNotifyToday } from '../../src/server/reminders.js';

const baseEpisode: EpisodeRow = {
  id: 10,
  subjectId: 1,
  subjectName: 'テスト番組',
  subjectNameCn: '测试番剧',
  subjectUrl: 'https://bgm.tv/subject/1',
  episodeType: 0,
  sort: 3,
  ep: 3,
  name: 'third',
  nameCn: '第三集',
  airdate: '2026-07-08',
  collectionType: 0,
  dismissedAt: null
};

describe('buildReminderCandidates', () => {
  it('returns unwatched main episodes that already aired, sorted by airdate', () => {
    const candidates = buildReminderCandidates(
      [
        { ...baseEpisode, id: 3, airdate: '2026-07-08' },
        { ...baseEpisode, id: 1, airdate: '2026-07-01' },
        { ...baseEpisode, id: 2, airdate: '2026-07-10' },
        { ...baseEpisode, id: 4, episodeType: 1 },
        { ...baseEpisode, id: 5, collectionType: 2 },
        { ...baseEpisode, id: 6, airdate: '' },
        { ...baseEpisode, id: 7, airdate: 'not-a-date' },
        { ...baseEpisode, id: 8, airdate: '2026-02-31' }
      ],
      '2026-07-08'
    );

    expect(candidates.map((episode) => episode.id)).toEqual([1, 3]);
  });

  it('does not include dismissed episodes', () => {
    const candidates = buildReminderCandidates(
      [{ ...baseEpisode, dismissedAt: '2026-07-08T12:00:00+08:00' }],
      '2026-07-08'
    );

    expect(candidates).toEqual([]);
  });
});

describe('shouldNotifyToday', () => {
  it('allows one summary notification per local date', () => {
    expect(shouldNotifyToday(null, '2026-07-08')).toBe(true);
    expect(shouldNotifyToday('2026-07-07', '2026-07-08')).toBe(true);
    expect(shouldNotifyToday('2026-07-08', '2026-07-08')).toBe(false);
  });
});
