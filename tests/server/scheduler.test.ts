import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runReminderCheck, startScheduler } from '../../src/server/scheduler.js';
import type { DashboardService, DashboardData, BacklogData, EpisodeRow } from '../../src/server/types.js';
import type { Repository } from '../../src/server/db.js';
import type { Notifier } from '../../src/server/notifier.js';

const cronState = vi.hoisted(() => ({ callback: null as (() => void) | null, stop: vi.fn() }));
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expression: string, callback: () => void) => {
      cronState.callback = callback;
      return { stop: cronState.stop };
    })
  }
}));

const now = new Date('2026-07-19T12:00:00.000Z');

describe('runReminderCheck', () => {
  beforeEach(() => {
    cronState.callback = null;
    cronState.stop.mockClear();
  });

  it('syncs and replans before loading one combined notification', async () => {
    const events: string[] = [];
    const dashboard = dashboardService({
      syncNow: vi.fn(async () => { events.push('sync'); return { subjectsSynced: 1, episodesSynced: 2 }; }),
      getDashboard: vi.fn(async () => { events.push('dashboard'); return dashboardData([episode()]); }),
      getBacklog: vi.fn(async () => { events.push('backlog'); return backlogData([taskEpisode()]); })
    });
    const repository = repositoryStub({
      getLastNotificationDate: vi.fn(async () => { events.push('marker read'); return null; }),
      setLastNotificationDate: vi.fn(async () => { events.push('marker write'); })
    });
    const notifier = notifierStub(vi.fn(async () => { events.push('notify'); }));

    await runReminderCheck({
      dashboard,
      repository,
      notifier,
      notificationsEnabled: async () => true,
      clock: () => now
    });

    expect(events).toEqual(['sync', 'dashboard', 'backlog', 'marker read', 'notify', 'marker write']);
    expect(notifier.notify).toHaveBeenCalledWith(
      '今日追番计划',
      '今日新番待看：测试新番 第 3 集\n今日补番计划：旧番 第 2 集'
    );
    expect(repository.setLastNotificationDate).toHaveBeenCalledWith('2026-07-19');
  });

  it('does not notify twice on the same Shanghai date', async () => {
    const notifier = notifierStub();
    const repository = repositoryStub({ getLastNotificationDate: vi.fn(async () => '2026-07-19') });

    await runReminderCheck({
      dashboard: dashboardService(),
      repository,
      notifier,
      notificationsEnabled: async () => true,
      clock: () => now
    });

    expect(notifier.notify).not.toHaveBeenCalled();
    expect(repository.setLastNotificationDate).not.toHaveBeenCalled();
  });

  it('does not consume the daily marker when both sections are empty', async () => {
    const repository = repositoryStub();
    const notifier = notifierStub();

    await runReminderCheck({
      dashboard: dashboardService({
        getDashboard: vi.fn(async () => dashboardData([])),
        getBacklog: vi.fn(async () => backlogData([]))
      }),
      repository,
      notifier,
      notificationsEnabled: async () => true,
      clock: () => now
    });

    expect(notifier.notify).not.toHaveBeenCalled();
    expect(repository.setLastNotificationDate).not.toHaveBeenCalled();
  });

  it('still syncs when notifications are disabled without loading or sending reminders', async () => {
    const dashboard = dashboardService();

    await runReminderCheck({
      dashboard,
      repository: repositoryStub(),
      notifier: notifierStub(),
      notificationsEnabled: async () => false,
      clock: () => now
    });

    expect(dashboard.syncNow).toHaveBeenCalledOnce();
    expect(dashboard.getDashboard).not.toHaveBeenCalled();
    expect(dashboard.getBacklog).not.toHaveBeenCalled();
  });

  it('contains a scheduled sync failure and keeps the cron task alive', async () => {
    const dashboard = dashboardService({ syncNow: vi.fn(async () => { throw new Error('offline'); }) });
    const scheduler = startScheduler({
      dashboard,
      repository: repositoryStub(),
      notifier: notifierStub(),
      cronExpression: '0 20 * * *',
      notificationsEnabled: async () => true
    });

    cronState.callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dashboard.syncNow).toHaveBeenCalledOnce();
    scheduler.stop();
    expect(cronState.stop).toHaveBeenCalledOnce();
  });
});

function dashboardService(overrides: Partial<DashboardService> = {}): DashboardService {
  return {
    getDashboard: vi.fn(async () => dashboardData([episode()])),
    getBacklog: vi.fn(async () => backlogData([taskEpisode()])),
    syncNow: vi.fn(async () => ({ subjectsSynced: 0, episodesSynced: 0 })),
    ...overrides
  } as DashboardService;
}

function repositoryStub(overrides: Partial<Repository> = {}): Repository {
  return {
    getLastNotificationDate: vi.fn(async () => null),
    setLastNotificationDate: vi.fn(async () => undefined),
    ...overrides
  } as Repository;
}

function notifierStub(notify = vi.fn(async () => undefined)): Notifier {
  return { notify };
}

function dashboardData(pendingEpisodes: EpisodeRow[]): DashboardData {
  return { pendingEpisodes, subjects: [], lastSyncAt: null, lastError: null };
}

function backlogData(todayEpisodes: EpisodeRow[]): BacklogData {
  return {
    today: '2026-07-19',
    todayTasks: todayEpisodes.map((episodeRow, index) => ({
      id: index + 1,
      episodeId: episodeRow.id,
      subjectId: episodeRow.subjectId,
      plannedDate: '2026-07-19',
      slot: index,
      locked: true,
      episode: episodeRow
    })),
    futureDays: [],
    active: [],
    held: [],
    completed: [],
    estimatedCompletionDate: null
  };
}

function episode(): EpisodeRow {
  return {
    id: 10,
    subjectId: 1,
    subjectName: 'New Anime',
    subjectNameCn: '测试新番',
    subjectUrl: 'https://bgm.tv/subject/1',
    episodeType: 0,
    sort: 3,
    ep: 3,
    name: 'third',
    nameCn: '第三集',
    airdate: '2026-07-19',
    airTime: '20:00',
    collectionType: 0,
    dismissedAt: null,
    snoozedUntil: null
  };
}

function taskEpisode(): EpisodeRow {
  return { ...episode(), id: 20, subjectId: 2, subjectName: 'Old Anime', subjectNameCn: '旧番', ep: 2, sort: 2 };
}
