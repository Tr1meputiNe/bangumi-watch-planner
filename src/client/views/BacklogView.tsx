import { useState } from 'react';
import {
  completeBacklog,
  markWatched,
  markUnwatched,
  markWatchedThrough,
  pauseBacklog,
  replanBacklogToday,
  skipBacklogToday,
  swapBacklogTask
} from '../api.js';
import type { BacklogData, BacklogTaskRow, DashboardSubject } from '../../server/types.js';
import { displayEpisodeTitle, displaySubjectName } from '../../shared/format.js';
import { MotionValue, motionStyle } from '../motion.js';
import WatchProgressGrid from '../WatchProgressGrid.js';

type BacklogViewProps = {
  data: BacklogData;
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

export default function BacklogView({ data, disabled, onChanged, onError }: BacklogViewProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const subjectsById = new Map(
    [...data.active, ...data.held, ...data.completed].map((subject) => [subject.id, subject])
  );

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
  const markThrough = (subjectId: number, episodeId: number) => void runAction(`watched-through-${episodeId}`, () => markWatchedThrough(subjectId, episodeId));
  const markOne = (episodeId: number) => void runAction(`watched-${episodeId}`, () => markWatched(episodeId));
  const markUnwatchedEpisode = (episodeId: number) => void runAction(`unwatched-${episodeId}`, () => markUnwatched(episodeId));

  return (
    <div className="backlog-workspace">
      <header className="backlog-overview" aria-label="补番概览">
        <div className="backlog-overview-copy">
          <span className="panel-eyebrow">旧番进度</span>
          <h1>补番计划</h1>
          <p>公平轮转多部旧番，依据每日新番负载自动调整。</p>
        </div>
        <dl className="backlog-overview-stats">
          <div><dt>今日</dt><dd><MotionValue value={data.todayTasks.length}>{data.todayTasks.length} 集</MotionValue></dd></div>
          <div><dt>进行中</dt><dd><MotionValue value={data.active.length}>{data.active.length} 部</MotionValue></dd></div>
          <div><dt>预计完成</dt><dd>{data.estimatedCompletionDate || '待估算'}</dd></div>
        </dl>
      </header>

      <section className="backlog-section backlog-today" aria-label="今日任务">
        <header className="backlog-section-header">
          <div>
            <span className="panel-eyebrow">今天</span>
            <h1>今日任务</h1>
            <p><time dateTime={data.today}>{formatPlanDate(data.today)}</time> · 安排 {data.todayTasks.length} 集</p>
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
        </header>
        {data.todayTasks.length > 0 ? (
          <div className="backlog-task-list">
            {data.todayTasks.map((task, index) => (
              <BacklogTask
                key={task.id}
                task={task}
                index={index + 1}
                subject={subjectsById.get(task.subjectId)}
                disabled={disabled}
                busyAction={busyAction}
                onAction={runAction}
              />
            ))}
          </div>
        ) : (
          <div className="empty backlog-today-empty">
            <span>今天没有补番任务。</span>
          </div>
        )}
        <p className="completion-estimate">
          {data.estimatedCompletionDate ? `预计完成 ${data.estimatedCompletionDate}` : '当前负载下无法估算'}
        </p>
      </section>

      <section className="backlog-section backlog-week" aria-label="未来 7 天">
        <header className="backlog-section-header">
          <div>
            <span className="panel-eyebrow">接下来</span>
            <h2>未来 7 天</h2>
          </div>
          <span className="backlog-section-count">按新番负载动态排期</span>
        </header>
        <div className="backlog-days">
          {data.futureDays.map((day, dayIndex) => (
            <section key={day.date} className="backlog-day motion-item" style={motionStyle(dayIndex, `backlog-day-${day.date}`)} aria-label={day.date}>
              <header>
                <strong>{formatPlanDate(day.date)}</strong>
                <span>新番 {day.seasonalLoad} 集 · 可补 {day.capacity} 集</span>
              </header>
              {day.tasks.length > 0 ? (
                <ul>
                  {day.tasks.map((task, taskIndex) => {
                    const subject = subjectsById.get(task.subjectId);
                    return (
                      <li key={task.id} className="backlog-day-task motion-item" style={motionStyle(taskIndex, `backlog-future-task-${task.id}`)}>
                        <a className="backlog-day-cover" href={task.episode.subjectUrl} target="_blank" rel="noreferrer" aria-label={taskLabel(task)}>
                          {subject?.image ? <img src={subject.image} alt="" /> : <span>{episodeNumber(task)}</span>}
                        </a>
                        <span>{taskLabel(task)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>无补番任务</p>
              )}
            </section>
          ))}
        </div>
      </section>

      <div className="backlog-library">
        <SubjectSection
          title="进行中"
          subjects={data.active}
          empty="没有进行中的补番。"
          disabled={disabled || busyAction !== null}
          onWatchedThrough={markThrough}
          onWatched={markOne}
          onUnwatched={markUnwatchedEpisode}
          renderActions={(subject) => (
            <>
              <button
                type="button"
                className="secondary"
                disabled={actionDisabled(`pause-${subject.id}`)}
                onClick={() => void runAction(`pause-${subject.id}`, () => pauseBacklog(subject.id))}
              >
                搁置
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
          title="已完成"
          subjects={data.completed}
          empty="还没有完成的补番。"
          disabled={disabled || busyAction !== null}
          onWatchedThrough={markThrough}
          onWatched={markOne}
          onUnwatched={markUnwatchedEpisode}
        />
      </div>
    </div>
  );
}

function BacklogTask({
  task,
  index,
  subject,
  disabled,
  busyAction,
  onAction
}: {
  task: BacklogTaskRow;
  index: number;
  subject?: DashboardSubject;
  disabled: boolean;
  busyAction: string | null;
  onAction(key: string, action: () => Promise<unknown>): Promise<void>;
}) {
  return (
    <article className="backlog-task motion-item" style={motionStyle(index - 1, `backlog-task-${task.id}`)}>
      <a className="backlog-task-cover" href={task.episode.subjectUrl} target="_blank" rel="noreferrer" aria-label={taskLabel(task)}>
        {subject?.image ? <img src={subject.image} alt="" /> : <span>{String(index).padStart(2, '0')}</span>}
      </a>
      <div className="backlog-task-copy">
        <span className="backlog-task-meta">任务 {String(index).padStart(2, '0')} · 第 {episodeNumber(task)} 集</span>
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
  disabled,
  onWatchedThrough,
  onWatched,
  onUnwatched,
  renderActions
}: {
  title: string;
  subjects: DashboardSubject[];
  empty: string;
  disabled: boolean;
  onWatchedThrough: (subjectId: number, episodeId: number) => void;
  onWatched: (episodeId: number) => void;
  onUnwatched: (episodeId: number) => void;
  renderActions?: (subject: DashboardSubject) => React.ReactNode;
}) {
  return (
    <section className="backlog-section backlog-subject-section" aria-label={title}>
      <header className="backlog-section-header">
        <div><span className="panel-eyebrow">补番片库</span><h2>{title}</h2></div>
        <strong className="backlog-section-count"><MotionValue value={subjects.length}>{subjects.length} 部</MotionValue></strong>
      </header>
      {subjects.length > 0 ? (
        <div className="backlog-subject-list">
          {subjects.map((subject, index) => (
            <BacklogSubjectItem
              key={subject.id}
              index={index}
              subject={subject}
              disabled={disabled}
              renderActions={renderActions}
              onWatchedThrough={onWatchedThrough}
              onWatched={onWatched}
              onUnwatched={onUnwatched}
            />
          ))}
        </div>
      ) : (
        <div className="empty">{empty}</div>
      )}
    </section>
  );
}

function BacklogSubjectItem({
  index,
  subject,
  disabled,
  renderActions,
  onWatchedThrough,
  onWatched,
  onUnwatched
}: {
  index: number;
  subject: DashboardSubject;
  disabled: boolean;
  renderActions?: (subject: DashboardSubject) => React.ReactNode;
  onWatchedThrough: (subjectId: number, episodeId: number) => void;
  onWatched: (episodeId: number) => void;
  onUnwatched: (episodeId: number) => void;
}) {
  const subjectTitle = displaySubjectName(subject.name, subject.nameCn);
  const progressText = `${subject.epStatus} / ${subject.eps || '?'}`;
  const progressPercent = subject.eps > 0 ? Math.min(100, Math.round((subject.epStatus / subject.eps) * 100)) : 0;
  const episodeOptions = subject.progressEpisodes ?? subject.mainEpisodes ?? subject.unwatchedMainEpisodes ?? [];
  const unwatchedProgressCount = subject.unwatchedProgressEpisodeCount
    ?? episodeOptions.filter((episode) => episode.collectionType !== 2).length;

  return (
    <article className="subject-row backlog-subject-row motion-item" style={motionStyle(index, `backlog-subject-${subject.id}`)}>
      <a className="subject-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={subjectTitle}>
        {subject.image ? <img src={subject.image} alt="" /> : <span>{subject.nameCn || subject.name}</span>}
      </a>
      <div className="subject-detail">
        <div className="subject-heading">
          <a href={subject.url} target="_blank" rel="noreferrer">{subjectTitle}</a>
          <span>{unwatchedProgressCount > 0 ? `${unwatchedProgressCount} 集未看` : '已同步'}</span>
        </div>
        <div className="progress-row">
          <MotionValue value={progressText}>{progressText}</MotionValue>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></div>
        </div>
        {subject.nextEpisode ? (
          <p>下一集：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)} · {formatEpisodeAirdate(subject.nextEpisode.airdate, subject.nextEpisode.airTime)}</p>
        ) : <p>暂无未看的本篇集数</p>}
        {subject.eps > 0 || episodeOptions.length > 0 ? (
          <WatchProgressGrid
            subjectTitle={subjectTitle}
            episodes={episodeOptions}
            totalEpisodes={subject.eps}
            disabled={disabled}
            motionKey="backlog-episode"
            onWatchedThrough={(episodeId) => onWatchedThrough(subject.id, episodeId)}
            onWatched={onWatched}
            onUnwatched={onUnwatched}
          />
        ) : null}
        {renderActions ? <div className="backlog-subject-actions">{renderActions(subject)}</div> : null}
      </div>
    </article>
  );
}

function taskLabel(task: BacklogTaskRow): string {
  return `${task.episode.subjectNameCn || task.episode.subjectName} 第 ${episodeNumber(task)} 集`;
}

function episodeNumber(task: BacklogTaskRow): number {
  return task.episode.ep ?? task.episode.sort;
}

function formatEpisodeAirdate(airdate: string, airTime = ''): string {
  if (airdate && airTime) return `播出时间：${airdate} ${airTime}`;
  if (airdate) return `播出日期：${airdate} · 具体时间未知`;
  return '播出时间未知';
}

function formatPlanDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'short'
  }).format(new Date(`${date}T12:00:00+08:00`));
}
