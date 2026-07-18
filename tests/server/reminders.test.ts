import { describe, expect, it } from 'vitest';
import type { BacklogTaskRow, EpisodeRow } from '../../src/server/types.js';
import { buildReminderCandidates, createDailyNotificationSummary, shouldNotifyToday } from '../../src/server/reminders.js';

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
  airTime: '',
  collectionType: 0,
  dismissedAt: null,
  snoozedUntil: null
};

describe('buildReminderCandidates', () => {
  it('returns unwatched main episodes that already aired, sorted by broadcast time', () => {
    const candidates = buildReminderCandidates(
      [
        { ...baseEpisode, id: 3, airdate: '2026-07-08', airTime: '23:00' },
        { ...baseEpisode, id: 1, airdate: '2026-07-01' },
        { ...baseEpisode, id: 2, airdate: '2026-07-08', airTime: '21:00' },
        { ...baseEpisode, id: 9, airdate: '2026-07-08' },
        { ...baseEpisode, id: 12, airdate: '2026-07-10' },
        { ...baseEpisode, id: 4, episodeType: 1 },
        { ...baseEpisode, id: 5, collectionType: 2 },
        { ...baseEpisode, id: 6, airdate: '' },
        { ...baseEpisode, id: 7, airdate: 'not-a-date' },
        { ...baseEpisode, id: 8, airdate: '2026-02-31' }
      ],
      '2026-07-08'
    );

    expect(candidates.map((episode) => episode.id)).toEqual([1, 2, 3, 9]);
  });

  it('does not include dismissed episodes', () => {
    const candidates = buildReminderCandidates(
      [{ ...baseEpisode, dismissedAt: '2026-07-08T12:00:00+08:00' }],
      '2026-07-08'
    );

    expect(candidates).toEqual([]);
  });

  it('hides a snoozed episode until the selected Shanghai date', () => {
    const snoozed = { ...baseEpisode, snoozedUntil: '2026-07-09' };

    expect(buildReminderCandidates([snoozed], '2026-07-08')).toEqual([]);
    expect(buildReminderCandidates([snoozed], '2026-07-09')).toEqual([snoozed]);
  });
});

describe('shouldNotifyToday', () => {
  it('allows one summary notification per local date', () => {
    expect(shouldNotifyToday(null, '2026-07-08')).toBe(true);
    expect(shouldNotifyToday('2026-07-07', '2026-07-08')).toBe(true);
    expect(shouldNotifyToday('2026-07-08', '2026-07-08')).toBe(false);
  });
});

describe('createDailyNotificationSummary', () => {
  it('builds two labeled sections when both kinds have tasks', () => {
    expect(createDailyNotificationSummary(
      [{ ...baseEpisode, subjectNameCn: '测试新番', ep: 3 }],
      [backlogTask({ episode: { ...baseEpisode, subjectNameCn: '旧番', ep: 2 } })]
    )).toEqual({
      title: '今日追番计划',
      body: '今日新番待看：测试新番 第 3 集\n今日补番计划：旧番 第 2 集'
    });
  });

  it('omits the backlog section when today has no backlog task', () => {
    expect(createDailyNotificationSummary(
      [{ ...baseEpisode, subjectNameCn: '测试新番', ep: 3 }],
      []
    )?.body).toBe('今日新番待看：测试新番 第 3 集');
  });

  it('returns null when both sections are empty', () => {
    expect(createDailyNotificationSummary([], [])).toBeNull();
  });

  it('limits each section to three titles and reports the full title count', () => {
    const episodes = Array.from({ length: 4 }, (_, index) => ({
      ...baseEpisode,
      id: index + 1,
      subjectId: index + 1,
      subjectNameCn: `番剧 ${index + 1}`,
      ep: index + 1
    }));

    expect(createDailyNotificationSummary(episodes, [])?.body).toBe(
      '今日新番待看：番剧 1 第 1 集、番剧 2 第 2 集、番剧 3 第 3 集 等 4 部'
    );
  });
});

function backlogTask(overrides: Partial<BacklogTaskRow> = {}): BacklogTaskRow {
  return {
    id: 1,
    episodeId: overrides.episode?.id ?? 10,
    subjectId: overrides.episode?.subjectId ?? 1,
    plannedDate: '2026-07-19',
    slot: 0,
    locked: true,
    episode: baseEpisode,
    ...overrides
  };
}
