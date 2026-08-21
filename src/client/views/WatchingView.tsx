import { useMemo, useState } from 'react';
import {
  dismissReminder,
  dropSubject,
  getSubjectEpisodes,
  holdSubject,
  markUnwatched,
  markWatched,
  markWatchedThrough,
  snoozeReminderUntilTomorrow,
  swapBacklogTask
} from '../api.js';
import LongPressButton from '../LongPressButton.js';
import type { BacklogData, BacklogTaskRow, DashboardData, DashboardSubject, DashboardSubjectSummary, EpisodeRow } from '../../server/types.js';
import { displayEpisodeTitle, displaySubjectName } from '../../shared/format.js';

type WatchingViewProps = {
  mode: 'today' | 'watching';
  dashboard: DashboardData;
  backlog?: BacklogData | null;
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

export default function WatchingView({ mode, dashboard, backlog, disabled, onChanged, onError }: WatchingViewProps) {
  const [busyEpisodeId, setBusyEpisodeId] = useState<number | null>(null);
  const [hiddenSubjectIds, setHiddenSubjectIds] = useState<Set<number>>(new Set());
  const pendingEpisodes = dashboard.pendingEpisodes;
  const todayLabel = useMemo(() => formatTodayLabel(), []);
  const subjectsById = useMemo(
    () => new Map(dashboard.subjects.map((subject) => [subject.id, subject])),
    [dashboard.subjects]
  );
  const pendingBySubject = useMemo(() => {
    const counts = new Map<number, number>();
    for (const episode of pendingEpisodes) counts.set(episode.subjectId, (counts.get(episode.subjectId) ?? 0) + 1);
    return counts;
  }, [pendingEpisodes]);

  async function runEpisodeAction(episodeId: number, action: () => Promise<unknown>) {
    setBusyEpisodeId(episodeId);
    try {
      await action();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyEpisodeId(null);
    }
  }

  async function runSubjectAction(subjectId: number, action: () => Promise<void>) {
    setHiddenSubjectIds((current) => new Set(current).add(subjectId));
    try {
      await action();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setHiddenSubjectIds((current) => {
        const next = new Set(current);
        next.delete(subjectId);
        return next;
      });
    }
  }

  return (
    <div className="workspace">
      {mode === 'today' ? (
        <header className="backlog-overview today-overview">
          <div className="backlog-overview-copy">
            <h1>今日安排</h1>
            <p>{todayLabel}</p>
          </div>
          <dl className="backlog-overview-stats">
            <div><dt>追番</dt><dd>{pendingEpisodes.length} 集</dd></div>
            <div><dt>补番</dt><dd>{backlog?.todayTasks.length ?? 0} 集</dd></div>
          </dl>
        </header>
      ) : null}

      {mode === 'today' ? <section className="panel backlog-panel" aria-label="今日追番">
        <div className="panel-title">
          <div><span className="panel-eyebrow">本季新番</span><h2>今日追番</h2><p className="today-date">{todayLabel}</p></div>
          <strong>{pendingEpisodes.length}</strong>
        </div>
        {pendingEpisodes.length > 0 ? (
          <div className="episode-list">
            {pendingEpisodes.map((episode) => (
              <EpisodeItem
                key={episode.id}
                episode={episode}
                subject={subjectsById.get(episode.subjectId)}
                disabled={disabled || busyEpisodeId === episode.id}
                processing={busyEpisodeId === episode.id}
                onWatched={() => void runEpisodeAction(episode.id, () => markWatched(episode.id))}
                onSnooze={() => void runEpisodeAction(episode.id, () => snoozeReminderUntilTomorrow(episode.id))}
                onDismiss={() => void runEpisodeAction(episode.id, () => dismissReminder(episode.id))}
              />
            ))}
          </div>
        ) : <div className="empty">没有已播出且未看的本篇集数。</div>}
      </section> : null}

      {mode === 'today' ? (
        <section className="backlog-section backlog-today" aria-label="今日补番">
          <header className="backlog-section-header">
            <div><span className="panel-eyebrow">旧番计划</span><h2>今日补番</h2></div>
            <strong className="backlog-section-count">{backlog?.todayTasks.length ?? 0} 集</strong>
          </header>
          {backlog === undefined || backlog === null ? (
            <div className="empty">正在加载补番安排。</div>
          ) : backlog.todayTasks.length > 0 ? (
            <div className="backlog-task-list">
              {backlog.todayTasks.map((task, index) => (
                <TodayBacklogTask
                  key={task.id}
                  task={task}
                  index={index + 1}
                  subject={findBacklogSubject(backlog, task.subjectId)}
                  disabled={disabled || busyEpisodeId !== null}
                  processing={busyEpisodeId === task.episodeId}
                  onWatched={() => void runEpisodeAction(task.episodeId, () => markWatched(task.episodeId))}
                  onSwap={() => void runEpisodeAction(task.episodeId, () => swapBacklogTask(task.episodeId))}
                />
              ))}
            </div>
          ) : <div className="empty">今天没有补番任务。</div>}
        </section>
      ) : null}

      {mode === 'watching' ? <section className="panel watching-panel" aria-label="在看动画">
        <div className="panel-title compact">
          <div><span className="panel-eyebrow">本季追番</span><h2>在看动画</h2></div>
          <strong>{dashboard.subjects.length}</strong>
        </div>
        <div className="subject-list">
          {dashboard.subjects.filter((subject) => !hiddenSubjectIds.has(subject.id)).map((subject) => (
            <SubjectItem
              key={subject.id}
              subject={subject}
              pendingCount={pendingBySubject.get(subject.id) ?? 0}
              disabled={disabled || busyEpisodeId !== null}
              onWatchedThrough={(episodeId) => runEpisodeAction(episodeId, () => markWatchedThrough(subject.id, episodeId))}
              onUnwatched={(episodeId) => runEpisodeAction(episodeId, () => markUnwatched(episodeId))}
              onHold={() => void runSubjectAction(subject.id, () => holdSubject(subject.id))}
              onDrop={() => void runSubjectAction(subject.id, () => dropSubject(subject.id))}
              onError={onError}
            />
          ))}
        </div>
      </section> : null}
    </div>
  );
}

function TodayBacklogTask({
  task,
  index,
  subject,
  disabled,
  processing,
  onWatched,
  onSwap
}: {
  task: BacklogTaskRow;
  index: number;
  subject?: DashboardSubject;
  disabled: boolean;
  processing: boolean;
  onWatched(): void;
  onSwap(): void;
}) {
  const subjectTitle = displaySubjectName(task.episode.subjectName, task.episode.subjectNameCn);
  const episodeNumber = task.episode.ep ?? task.episode.sort;

  return (
    <article className="backlog-task">
      <a className="backlog-task-cover" href={task.episode.subjectUrl} target="_blank" rel="noreferrer" aria-label={subjectTitle}>
        {subject?.image ? <img src={subject.image} alt="" /> : <span>{String(index).padStart(2, '0')}</span>}
      </a>
      <div className="backlog-task-copy">
        <span className="backlog-task-meta">补番 {String(index).padStart(2, '0')} · 第 {episodeNumber} 集</span>
        <a href={task.episode.subjectUrl} target="_blank" rel="noreferrer">{subjectTitle}</a>
        <p>{displayEpisodeTitle(task.episode.name, task.episode.nameCn, task.episode.sort)}</p>
      </div>
      <div className="backlog-task-actions">
        <button type="button" disabled={disabled} onClick={onWatched}>{processing ? '处理中' : '已看'}</button>
        <button type="button" className="ghost" disabled={disabled} onClick={onSwap}>换一部</button>
      </div>
    </article>
  );
}

function findBacklogSubject(backlog: BacklogData, subjectId: number): DashboardSubject | undefined {
  return [...backlog.active, ...backlog.held, ...backlog.completed].find((subject) => subject.id === subjectId);
}

function SubjectItem({
  subject,
  pendingCount,
  disabled,
  onWatchedThrough,
  onUnwatched,
  onHold,
  onDrop,
  onError
}: {
  subject: DashboardSubjectSummary;
  pendingCount: number;
  disabled: boolean;
  onWatchedThrough: (episodeId: number) => Promise<void>;
  onUnwatched: (episodeId: number) => Promise<void>;
  onHold: () => void;
  onDrop: () => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeRow[] | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const subjectTitle = displaySubjectName(subject.name, subject.nameCn);
  const progressText = `${subject.epStatus} / ${subject.eps || '?'}`;
  const progressPercent = subject.eps > 0 ? Math.min(100, Math.round((subject.epStatus / subject.eps) * 100)) : 0;
  const unwatchedCount = subject.unwatchedMainEpisodeCount ?? pendingCount;

  async function loadEpisodes() {
    setLoadingEpisodes(true);
    try {
      setEpisodes(await getSubjectEpisodes(subject.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingEpisodes(false);
    }
  }

  async function runGridAction(action: () => Promise<void>) {
    await action();
    await loadEpisodes();
  }

  function toggleEpisodes() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && episodes === null) void loadEpisodes();
  }

  return (
    <article className="subject-row">
      <a className="subject-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={subjectTitle}>
        {subject.image ? <img src={subject.image} alt="" /> : <span>{subject.nameCn || subject.name}</span>}
      </a>
      <div className="subject-detail">
        <div className="subject-heading">
          <div className="subject-heading-copy">
            <a href={subject.url} target="_blank" rel="noreferrer">{subjectTitle}</a>
            <span>{unwatchedCount > 0 ? `${unwatchedCount} 集未看` : '已同步'}</span>
          </div>
          <div className="subject-heading-actions">
            <button type="button" className="secondary" disabled={disabled} onClick={onHold}>搁置</button>
            <LongPressButton subjectTitle={subjectTitle} disabled={disabled} onCommit={onDrop} />
          </div>
        </div>
        <div className="progress-row">
          <span>{progressText}</span>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></div>
        </div>
        {subject.nextEpisode ? (
          <p>下一集：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)} · {formatEpisodeAirdate(subject.nextEpisode.airdate, subject.nextEpisode.airTime)}</p>
        ) : <p>暂无未看的本篇集数</p>}
        <button
          type="button"
          className="secondary episode-grid-toggle"
          onClick={toggleEpisodes}
          disabled={disabled || loadingEpisodes}
          aria-label={`${expanded ? '收起' : '查看'}${subjectTitle}集数`}
          aria-expanded={expanded}
        >
          {loadingEpisodes ? '加载中' : expanded ? '收起集数' : '查看集数'}
        </button>
        {expanded && episodes && episodes.length > 0 ? (
          <WatchProgressGrid
            subjectTitle={subjectTitle}
            episodes={episodes}
            disabled={disabled || loadingEpisodes}
            onWatchedThrough={(episodeId) => void runGridAction(() => onWatchedThrough(episodeId))}
            onUnwatched={(episodeId) => void runGridAction(() => onUnwatched(episodeId))}
          />
        ) : null}
      </div>
    </article>
  );
}

function WatchProgressGrid({
  subjectTitle,
  episodes,
  disabled,
  onWatchedThrough,
  onUnwatched
}: {
  subjectTitle: string;
  episodes: EpisodeRow[];
  disabled: boolean;
  onWatchedThrough: (episodeId: number) => void;
  onUnwatched: (episodeId: number) => void;
}) {
  return (
    <div className="watch-progress-grid" aria-label={`${subjectTitle}集数进度`}>
      {episodes.map((episode) => {
        const progress = Number(episode.ep ?? episode.sort);
        const watched = episode.collectionType === 2;
        const aired = hasAired(episode.airdate);
        return (
          <button
            key={episode.id}
            type="button"
            className={['watch-episode-button', watched ? 'is-watched' : aired ? 'is-aired' : 'is-unaired'].join(' ')}
            onClick={() => (watched ? onUnwatched(episode.id) : onWatchedThrough(episode.id))}
            disabled={disabled}
            aria-label={watched ? `${subjectTitle} 第 ${progress} 集 取消看过` : `${subjectTitle} 第 ${progress} 集 标为看过`}
            title={`${displayEpisodeTitle(episode.name, episode.nameCn, episode.sort)}${episode.airdate ? ` · ${episode.airdate}` : ''}`}
          >
            {formatEpisodeProgress(progress)}
          </button>
        );
      })}
    </div>
  );
}

function EpisodeItem({
  episode,
  subject,
  disabled,
  processing,
  onWatched,
  onSnooze,
  onDismiss
}: {
  episode: EpisodeRow;
  subject?: DashboardSubjectSummary;
  disabled: boolean;
  processing: boolean;
  onWatched: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
}) {
  const subjectTitle = displaySubjectName(episode.subjectName, episode.subjectNameCn);

  return (
    <article className="episode-row">
      <a className="episode-visual" href={episode.subjectUrl} target="_blank" rel="noreferrer" aria-label={subjectTitle}>
        {subject?.image ? <img src={subject.image} alt="" /> : <span>{subjectTitle}</span>}
        <span className="episode-index" title={formatEpisodeAirdate(episode.airdate, episode.airTime)}>
          <span>{episode.airTime || episode.airdate.slice(5) || '--'}</span>
          <strong>{episode.airTime && episode.airdate ? `${episode.airdate.slice(5)} · ` : ''}第 {episode.sort} 集</strong>
        </span>
      </a>
      <div className="episode-main">
        <a className="episode-subject" href={episode.subjectUrl} target="_blank" rel="noreferrer">{subjectTitle}</a>
        <h3>{displayEpisodeTitle(episode.name, episode.nameCn, episode.sort)}</h3>
        <a href={episode.subjectUrl} target="_blank" rel="noreferrer">打开 Bangumi</a>
      </div>
      <div className="episode-actions">
        <button type="button" onClick={onWatched} disabled={disabled}>{processing ? '处理中' : '已看'}</button>
        <button type="button" className="secondary" onClick={onSnooze} disabled={disabled}>明天再看</button>
        <button type="button" className="ghost" onClick={onDismiss} disabled={disabled}>忽略</button>
      </div>
    </article>
  );
}

function hasAired(airdate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(airdate) && airdate <= todayInShanghai();
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatEpisodeProgress(progress: number): string {
  if (!Number.isFinite(progress)) return '?';
  return Number.isInteger(progress) ? String(progress).padStart(2, '0') : String(progress);
}

function formatEpisodeAirdate(airdate: string, airTime = ''): string {
  if (airdate && airTime) return `播出时间：${airdate} ${airTime}`;
  if (airdate) return `播出日期：${airdate} · 具体时间未知`;
  return '播出时间未知';
}

function formatTodayLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).format(new Date()).replace('星期', ' · 星期');
}
