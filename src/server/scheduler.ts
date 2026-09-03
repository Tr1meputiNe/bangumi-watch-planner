import cron from 'node-cron';
import { createDailyNotificationSummary, shouldNotifyToday, todayInShanghai } from './reminders.js';
import type { DashboardService } from './types.js';
import type { Notifier } from './notifier.js';
import type { Repository } from './db.js';

type SchedulerDeps = {
  dashboard: DashboardService;
  repository: Repository;
  notifier: Notifier;
  cronExpression: string;
  notificationsEnabled: () => Promise<boolean>;
  clock?: () => Date;
};

export function startScheduler(deps: SchedulerDeps): { stop(): void } {
  const task = cron.schedule(
    deps.cronExpression,
    () => {
      void runReminderCheck(deps).catch(() => undefined);
    },
    { timezone: 'Asia/Shanghai' }
  );

  return {
    stop() {
      task.stop();
    }
  };
}

export async function runReminderCheck(deps: Omit<SchedulerDeps, 'cronExpression'>): Promise<void> {
  await deps.dashboard.syncNow('full');
  if (!(await deps.notificationsEnabled())) return;

  const dashboard = await deps.dashboard.getDashboard();
  const backlog = await deps.dashboard.getBacklog();
  const today = todayInShanghai(deps.clock?.());
  const summary = createDailyNotificationSummary(
    dashboard.pendingEpisodes,
    backlog.todayTasks.filter((task) => task.plannedDate === today)
  );
  if (!summary) return;

  const lastNotificationDate = await deps.repository.getLastNotificationDate();
  if (!shouldNotifyToday(lastNotificationDate, today)) return;

  await deps.notifier.notify(summary.title, summary.body);
  await deps.repository.setLastNotificationDate(today);
}
