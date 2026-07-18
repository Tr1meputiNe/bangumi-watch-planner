import { describe, expect, it } from 'vitest';
import type { EpisodeRow } from '../../src/server/types.js';
import {
  buildBacklogPlan,
  capacityForSeasonalLoad,
  countSeasonalLoad,
  estimateBacklogCompletionDate
} from '../../src/server/backlog-planner.js';

describe('backlog planner', () => {
  it.each([
    [0, 2], [1, 2], [2, 1], [4, 1], [5, 0], [8, 0]
  ])('maps seasonal load %s to backlog capacity %s', (load, capacity) => {
    expect(capacityForSeasonalLoad(load)).toBe(capacity);
  });

  it('counts only exact-date seasonal main episodes regardless of watched state', () => {
    expect(countSeasonalLoad([
      episode({ airdate: '2026-07-20', episodeType: 0, collectionType: 2 }),
      episode({ airdate: '2026-07-20', episodeType: 0, collectionType: 0 }),
      episode({ airdate: '2026-07-20', episodeType: 1 }),
      episode({ airdate: '2026-07-19', episodeType: 0 })
    ], '2026-07-20')).toBe(2);
  });

  it('rotates eligible queues fairly across available slots', () => {
    const result = buildBacklogPlan(input());

    expect(result.tasks.map((task) => task.episodeId)).toEqual([11, 21, 31, 12, 22, 13]);
    expect(result.days.find((day) => day.date === '2026-07-19')?.tasks.map((task) => task.subjectId)).toEqual([1, 2]);
    expect(result.days.find((day) => day.date === '2026-07-21')?.tasks).toEqual([]);
  });

  it('starts after the saved rotation cursor', () => {
    const result = buildBacklogPlan({ ...input(), throughDate: '2026-07-19', rotationCursorSubjectId: 1 });

    expect(result.tasks.map((task) => task.episodeId)).toEqual([21, 31]);
  });

  it('keeps a fixed locked task today and fills its remaining slot', () => {
    const result = buildBacklogPlan({
      ...input(),
      throughDate: '2026-07-19',
      fixedTasks: [{ episodeId: 11, subjectId: 1, plannedDate: '2026-07-19', slot: 0, locked: true }]
    });

    expect(result.tasks).toEqual([
      { episodeId: 11, subjectId: 1, plannedDate: '2026-07-19', slot: 0, locked: true },
      { episodeId: 21, subjectId: 2, plannedDate: '2026-07-19', slot: 1, locked: false }
    ]);
  });

  it('counts a fixed task against capacity regardless of its slot number', () => {
    const result = buildBacklogPlan({
      ...input(),
      throughDate: '2026-07-19',
      seasonalLoadByDate: new Map([['2026-07-19', 2]]),
      fixedTasks: [{ episodeId: 11, subjectId: 1, plannedDate: '2026-07-19', slot: 1, locked: true }]
    });

    expect(result.tasks).toEqual([
      { episodeId: 11, subjectId: 1, plannedDate: '2026-07-19', slot: 1, locked: true }
    ]);
  });

  it('returns past tasks to their queue', () => {
    const result = buildBacklogPlan({
      ...input(),
      throughDate: '2026-07-19',
      fixedTasks: [{ episodeId: 11, subjectId: 1, plannedDate: '2026-07-18', slot: 0, locked: true }]
    });

    expect(result.tasks.map((task) => task.episodeId)).toEqual([11, 21]);
  });

  it('leaves skipped dates empty', () => {
    const result = buildBacklogPlan({ ...input(), throughDate: '2026-07-19', skippedDates: new Set(['2026-07-19']) });

    expect(result.tasks).toEqual([]);
    expect(result.days[0].tasks).toEqual([]);
  });

  it('applies an episode exclusion only on its excluded date', () => {
    const result = buildBacklogPlan({
      ...input(),
      throughDate: '2026-07-20',
      subjects: [queue('A', [11]), queue('B', [21])],
      exclusions: new Map([['2026-07-19', new Set([11])]])
    });

    expect(result.tasks.map((task) => [task.plannedDate, task.episodeId])).toEqual([
      ['2026-07-19', 21],
      ['2026-07-20', 11]
    ]);
  });

  it('selects a later eligible episode without removing an excluded queue head', () => {
    const result = buildBacklogPlan({
      ...input(),
      throughDate: '2026-07-20',
      subjects: [queue('A', [11, 12]), queue('B', [21])],
      exclusions: new Map([['2026-07-19', new Set([11])]])
    });

    expect(result.tasks.map((task) => [task.plannedDate, task.episodeId])).toEqual([
      ['2026-07-19', 12],
      ['2026-07-19', 21],
      ['2026-07-20', 11]
    ]);
  });

  it('returns deterministic future plans without mutating inputs', () => {
    const plannerInput = input();
    const first = buildBacklogPlan(plannerInput);
    const second = buildBacklogPlan(plannerInput);

    expect(second).toEqual(first);
    expect(plannerInput.subjects[0].episodes.map((item) => item.id)).toEqual([11, 12, 13]);
  });

  it('estimates completion from repeated weekly seasonal loads', () => {
    expect(estimateBacklogCompletionDate('2026-07-19', 3, [0, 5, 0, 5, 5, 5, 5])).toBe('2026-07-21');
  });

  it('aligns repeated seasonal loads with the Shanghai weekday of the start date', () => {
    expect(estimateBacklogCompletionDate('2026-07-20', 1, [0, 5, 0, 5, 5, 5, 5])).toBe('2026-07-21');
  });

  it('does not estimate when there is no remaining backlog or weekly capacity', () => {
    expect(estimateBacklogCompletionDate('2026-07-19', 0, [0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(estimateBacklogCompletionDate('2026-07-19', 1, [5, 5, 5, 5, 5, 5, 5])).toBeNull();
  });
});

function input() {
  return {
    today: '2026-07-19',
    throughDate: '2026-07-25',
    seasonalLoadByDate: new Map([
      ['2026-07-19', 0], ['2026-07-20', 2], ['2026-07-21', 5]
    ]),
    subjects: [queue('A', [11, 12, 13]), queue('B', [21, 22]), queue('C', [31])],
    fixedTasks: [],
    skippedDates: new Set<string>(),
    exclusions: new Map<string, Set<number>>(),
    rotationCursorSubjectId: null
  };
}

function queue(name: string, ids: number[]) {
  const subjectId = name.charCodeAt(0) - 64;
  return { subjectId, episodes: ids.map((id, index) => episode({ id, subjectId, ep: index + 1, sort: index + 1 })) };
}

function episode(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 1,
    subjectId: 1,
    subjectName: 'Test',
    subjectNameCn: 'Test',
    subjectUrl: 'https://bgm.tv/subject/1',
    episodeType: 0,
    sort: 1,
    ep: 1,
    name: 'episode',
    nameCn: 'episode',
    airdate: '2026-07-19',
    airTime: '',
    collectionType: 0,
    dismissedAt: null,
    ...overrides
  };
}
