import cron from 'node-cron';
import { createNotificationSummary, shouldNotifyToday, todayInShanghai } from './reminders.js';
import type { DashboardService } from './types.js';
import type { Notifier } from './notifier.js';
import type { Repository } from './db.js';

type SchedulerDeps = {
  dashboard: DashboardService;
  repository: Repository;
  notifier: Notifier;
  cronExpression: string;
  notificationsEnabled: () => Promise<boolean>;
};

export function startScheduler(deps: SchedulerDeps): { stop(): void } {
  const task = cron.schedule(
    deps.cronExpression,
    () => {
      void runReminderCheck(deps);
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
  if (!(await deps.notificationsEnabled())) return;
  await deps.dashboard.syncNow();

  const dashboard = await deps.dashboard.getDashboard();
  if (dashboard.pendingEpisodes.length === 0) return;

  const today = todayInShanghai();
  const lastNotificationDate = await deps.repository.getLastNotificationDate();
  if (!shouldNotifyToday(lastNotificationDate, today)) return;

  const summary = createNotificationSummary(dashboard.pendingEpisodes);
  await deps.notifier.notify(summary.title, summary.body);
  await deps.repository.setLastNotificationDate(today);
}
