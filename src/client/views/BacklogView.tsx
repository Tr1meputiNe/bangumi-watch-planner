import { useState } from 'react';
import {
  completeBacklog,
  markWatched,
  pauseBacklog,
  replanBacklogToday,
  resumeBacklog,
  skipBacklogToday,
  swapBacklogTask
} from '../api.js';
import type { BacklogData, BacklogTaskRow, DashboardSubject } from '../../server/types.js';
import { displaySubjectName } from '../../shared/format.js';

type BacklogViewProps = {
  data: BacklogData;
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

export default function BacklogView({ data, disabled, onChanged, onError }: BacklogViewProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function runAction(key: string, action: () => Promise<unknown>) {
    setBusyAction(key);
    try {
      await action();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  const actionDisabled = (key: string) => disabled || busyAction === key;

  return (
    <div className="backlog-workspace">
      <section className="panel backlog-today" aria-label="今日任务">
        <div className="panel-title">
          <div>
            <span className="panel-eyebrow">Today</span>
            <h1>今日任务</h1>
            <p>今天安排 {data.todayTasks.length} 集</p>
          </div>
          <div className="backlog-day-actions">
            <button
              type="button"
              className="secondary"
              disabled={actionDisabled('skip-today')}
              onClick={() => void runAction('skip-today', skipBacklogToday)}
            >
              今天跳过
            </button>
            <button
              type="button"
              className="secondary"
              disabled={actionDisabled('replan-today')}
              onClick={() => void runAction('replan-today', replanBacklogToday)}
            >
              重新规划今天
            </button>
          </div>
        </div>
        {data.todayTasks.length > 0 ? (
          <div className="backlog-task-list">
            {data.todayTasks.map((task, index) => (
              <BacklogTask
                key={task.id}
                task={task}
                index={index + 1}
                disabled={disabled}
                busyAction={busyAction}
                onAction={runAction}
              />
            ))}
          </div>
        ) : (
          <div className="empty">今天没有补番任务。</div>
        )}
        <p className="completion-estimate">
          {data.estimatedCompletionDate ? `预计完成 ${data.estimatedCompletionDate}` : '当前负载下无法估算'}
        </p>
      </section>

      <section className="panel backlog-week" aria-label="未来 7 天">
        <div className="panel-title compact">
          <div>
            <span className="panel-eyebrow">Next</span>
            <h2>未来 7 天</h2>
          </div>
        </div>
        <div className="backlog-days">
          {data.futureDays.map((day) => (
            <section key={day.date} className="backlog-day" aria-label={day.date}>
              <header>
                <strong>{day.date}</strong>
                <span>新番 {day.seasonalLoad} 集 · 可补 {day.capacity} 集</span>
              </header>
              {day.tasks.length > 0 ? (
                <ul>
                  {day.tasks.map((task) => <li key={task.id}>{taskLabel(task)}</li>)}
                </ul>
              ) : (
                <p>无补番任务</p>
              )}
            </section>
          ))}
        </div>
      </section>

      <SubjectSection
        title="进行中"
        subjects={data.active}
        empty="没有进行中的补番。"
        renderActions={(subject) => (
          <>
            <button
              type="button"
              className="secondary"
              disabled={actionDisabled(`pause-${subject.id}`)}
              onClick={() => void runAction(`pause-${subject.id}`, () => pauseBacklog(subject.id))}
            >
              暂停
            </button>
            {!subject.totalEpisodesKnown ? (
              <button
                type="button"
                className="secondary"
                disabled={actionDisabled(`complete-${subject.id}`)}
                onClick={() => void runAction(`complete-${subject.id}`, () => completeBacklog(subject.id))}
              >
                手动完成
              </button>
            ) : null}
          </>
        )}
      />
      <SubjectSection
        title="搁置"
        subjects={data.held}
        empty="没有搁置的补番。"
        renderActions={(subject) => (
          <button
            type="button"
            className="secondary"
            disabled={actionDisabled(`resume-${subject.id}`)}
            onClick={() => void runAction(`resume-${subject.id}`, () => resumeBacklog(subject.id))}
          >
            恢复
          </button>
        )}
      />
      <SubjectSection title="已完成" subjects={data.completed} empty="还没有完成的补番。" />
    </div>
  );
}

function BacklogTask({
  task,
  index,
  disabled,
  busyAction,
  onAction
}: {
  task: BacklogTaskRow;
  index: number;
  disabled: boolean;
  busyAction: string | null;
  onAction(key: string, action: () => Promise<unknown>): Promise<void>;
}) {
  return (
    <article className="backlog-task">
      <span className="backlog-task-index">{String(index).padStart(2, '0')}</span>
      <div>
        <a href={task.episode.subjectUrl} target="_blank" rel="noreferrer">{taskLabel(task)}</a>
        <p>{task.episode.nameCn || task.episode.name || `第 ${episodeNumber(task)} 集`}</p>
      </div>
      <div className="backlog-task-actions">
        <button
          type="button"
          disabled={disabled || busyAction === `watched-${task.episodeId}`}
          onClick={() => void onAction(`watched-${task.episodeId}`, () => markWatched(task.episodeId))}
        >
          已看
        </button>
        <button
          type="button"
          className="ghost"
          disabled={disabled || busyAction === `swap-${task.episodeId}`}
          onClick={() => void onAction(`swap-${task.episodeId}`, () => swapBacklogTask(task.episodeId))}
        >
          换一部
        </button>
      </div>
    </article>
  );
}

function SubjectSection({
  title,
  subjects,
  empty,
  renderActions
}: {
  title: string;
  subjects: DashboardSubject[];
  empty: string;
  renderActions?: (subject: DashboardSubject) => React.ReactNode;
}) {
  return (
    <section className="panel backlog-subject-section" aria-label={title}>
      <div className="panel-title compact">
        <h2>{title}</h2>
        <strong>{subjects.length}</strong>
      </div>
      {subjects.length > 0 ? (
        <div className="backlog-subject-list">
          {subjects.map((subject) => (
            <article key={subject.id} className="backlog-subject-row">
              <div>
                <a href={subject.url} target="_blank" rel="noreferrer">
                  {displaySubjectName(subject.name, subject.nameCn)}
                </a>
                <p>
                  <span>{subject.totalEpisodesKnown ? `${subject.epStatus} / ${subject.eps} 集` : '总集数未知'}</span>
                  {subject.unwatchedMainEpisodeCount > 0 ? <span> · {subject.unwatchedMainEpisodeCount} 集未看</span> : null}
                </p>
              </div>
              {renderActions ? <div className="backlog-subject-actions">{renderActions(subject)}</div> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">{empty}</div>
      )}
    </section>
  );
}

function taskLabel(task: BacklogTaskRow): string {
  return `${task.episode.subjectNameCn || task.episode.subjectName} 第 ${episodeNumber(task)} 集`;
}

function episodeNumber(task: BacklogTaskRow): number {
  return task.episode.ep ?? task.episode.sort;
}
