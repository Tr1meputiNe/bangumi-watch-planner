import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  dismissReminder,
  dropSubject,
  getSubjectEpisodes,
  holdSubject,
  markUnwatched,
  markWatched,
  markWatchedThrough,
  snoozeReminderUntilTomorrow
} from '../api.js';
import LongPressButton from '../LongPressButton.js';
import WatchProgressGrid from '../WatchProgressGrid.js';
import CoverImage from '../CoverImage.js';
import { commitWithMotion, MotionValue, motionStyle } from '../motion.js';
import type { BacklogData, DashboardData, DashboardSubject, DashboardSubjectSummary, EpisodeRow } from '../../server/types.js';
import { displayEpisodeTitle, displaySubjectName } from '../../shared/format.js';

type WatchingViewProps = {
  mode: 'today' | 'watching';
  dashboard: DashboardData;
  backlog?: BacklogData | null;
  backlogError?: string | null;
  onRetryBacklog?(): Promise<void>;
  disabled: boolean;
  refreshVersion?: number;
  onOpenBacklog?(): void;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

export default function WatchingView({
  mode,
  dashboard,
  backlog,
  backlogError,
  onRetryBacklog,
  disabled,
  refreshVersion = 0,
  onOpenBacklog,
  onChanged,
  onError
}: WatchingViewProps) {
  const [busyEpisodeId, setBusyEpisodeId] = useState<number | null>(null);
  const [busySubjectId, setBusySubjectId] = useState<number | null>(null);
  const actionPending = useRef(false);
  const [retryingBacklog, setRetryingBacklog] = useState(false);
  const backlogRetryPending = useRef(false);
  const [hiddenSubjectIds, setHiddenSubjectIds] = useState<Set<number>>(new Set());
  const pendingEpisodes = dashboard.pendingEpisodes;
  const [todayLabel, setTodayLabel] = useState(formatTodayLabel);
  useEffect(() => {
    if (mode !== 'today') return;
    const update = () => setTodayLabel(formatTodayLabel());
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [mode]);
  const actionsDisabled = disabled || busyEpisodeId !== null || busySubjectId !== null;
  const recentSubjects = (backlog?.recent ?? []).slice(0, 3);
  const subjectsById = useMemo(
    () => new Map(dashboard.subjects.map((subject) => [subject.id, subject])),
    [dashboard.subjects]
  );
  const pendingBySubject = useMemo(() => {
    const counts = new Map<number, number>();
    for (const episode of pendingEpisodes) counts.set(episode.subjectId, (counts.get(episode.subjectId) ?? 0) + 1);
    return counts;
  }, [pendingEpisodes]);

  async function retryBacklog() {
    if (!onRetryBacklog || disabled || backlogRetryPending.current) return;
    backlogRetryPending.current = true;
    setRetryingBacklog(true);
    try {
      await onRetryBacklog();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      backlogRetryPending.current = false;
      setRetryingBacklog(false);
    }
  }

  async function runEpisodeAction(episodeId: number, action: () => Promise<unknown>) {
    if (disabled || actionPending.current) return;
    actionPending.current = true;
    setBusyEpisodeId(episodeId);
    try {
      await action();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      actionPending.current = false;
      setBusyEpisodeId(null);
    }
  }

  async function runSubjectAction(subjectId: number, action: () => Promise<void>) {
    if (disabled || actionPending.current) return;
    actionPending.current = true;
    setBusySubjectId(subjectId);
    commitWithMotion(() => setHiddenSubjectIds((current) => new Set(current).add(subjectId)));
    try {
      await action();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      actionPending.current = false;
      setBusySubjectId(null);
      commitWithMotion(() => setHiddenSubjectIds((current) => {
        const next = new Set(current);
        next.delete(subjectId);
        return next;
      }));
    }
  }

  return (
    <div className={`workspace${mode === 'today' ? ' today-workspace' : ''}`}>
      {mode === 'today' ? (
        <header className="backlog-overview today-overview">
          <div className="backlog-overview-copy">
            <h1>今天</h1>
            <p>{todayLabel}</p>
          </div>
          <dl className="backlog-overview-stats">
            <div><dt>已播出待看</dt><dd><MotionValue value={pendingEpisodes.length}>{pendingEpisodes.length} 集</MotionValue></dd></div>
          </dl>
        </header>
      ) : null}

      {mode === 'today' ? <section className="panel backlog-panel" aria-label="今日追番">
        <div className="panel-title">
          <div><h2>今日追番</h2></div>
          <strong><MotionValue value={pendingEpisodes.length} /></strong>
        </div>
        {pendingEpisodes.length > 0 ? (
          <div className="episode-list">
            {pendingEpisodes.map((episode, index) => (
              <EpisodeItem
                key={episode.id}
                index={index}
                episode={episode}
                subject={subjectsById.get(episode.subjectId)}
                disabled={actionsDisabled}
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
        <section className="backlog-section today-recent" aria-label="接着看">
          <header className="backlog-section-header">
            <div><h2>接着看</h2></div>
            {onOpenBacklog ? <button type="button" className="secondary" onClick={onOpenBacklog}>全部补番</button> : null}
          </header>
          {!backlog ? backlogError ? (
            <div className="empty retryable">
              <p role="alert">{backlogError}</p>
              {onRetryBacklog ? <button type="button" className="secondary"
                disabled={disabled || retryingBacklog} aria-busy={retryingBacklog}
                onClick={() => void retryBacklog()}>重试观看记录</button> : null}
            </div>
          ) : <div className="empty" role="status">正在加载观看记录。</div>
            : recentSubjects.length > 0 ? (
              <div className="subject-list today-recent-list">
                {recentSubjects.map((subject, index) => (
                  <RecentSubject key={subject.id} subject={subject} index={index} />
                ))}
              </div>
            ) : <div className="empty">暂无最近观看</div>}
        </section>
      ) : null}

      {mode === 'watching' ? <section className="panel watching-panel" aria-label="在看动画">
        <div className="panel-title compact">
          <div><h2>在看动画</h2></div>
          <strong><MotionValue value={dashboard.subjects.length} /></strong>
        </div>
        <div className="subject-list">
          {dashboard.subjects.length === 0 ? <div className="empty">暂无正在追的新番。</div> : null}
          {dashboard.subjects.filter((subject) => !hiddenSubjectIds.has(subject.id)).map((subject, index) => (
            <SubjectItem
              key={subject.id}
              index={index}
              subject={subject}
              pendingCount={pendingBySubject.get(subject.id) ?? 0}
              disabled={actionsDisabled}
              refreshVersion={refreshVersion}
              onWatchedThrough={(episodeId) => runEpisodeAction(episodeId, () => markWatchedThrough(subject.id, episodeId))}
              onWatched={(episodeId) => runEpisodeAction(episodeId, () => markWatched(episodeId))}
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

function RecentSubject({ subject, index }: {
  subject: DashboardSubject;
  index: number;
}) {
  const title = displaySubjectName(subject.name, subject.nameCn);
  const next = subject.nextEpisode;
  return (
    <article className="subject-row today-recent-row motion-item" style={motionStyle(index, `today-recent-${subject.id}`)}>
      <a className="subject-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={title}>
        <CoverImage src={subject.image} fallback={title} />
      </a>
      <div className="subject-detail">
        <div className="subject-heading"><a href={subject.url} target="_blank" rel="noreferrer">{title}</a></div>
        <p>已看 {subject.epStatus} / {subject.eps || '?'} 集</p>
        {next ? <>
          <p>下一集：第 {next.ep ?? next.sort} 集 · {displayEpisodeTitle(next.name, next.nameCn, next.sort)}</p>
        </> : <p>暂无可继续的集数</p>}
      </div>
    </article>
  );
}

function SubjectItem({
  index,
  subject,
  pendingCount,
  disabled,
  refreshVersion,
  onWatchedThrough,
  onWatched,
  onUnwatched,
  onHold,
  onDrop,
  onError
}: {
  index: number;
  subject: DashboardSubjectSummary;
  pendingCount: number;
  disabled: boolean;
  refreshVersion: number;
  onWatchedThrough: (episodeId: number) => Promise<void>;
  onWatched: (episodeId: number) => Promise<void>;
  onUnwatched: (episodeId: number) => Promise<void>;
  onHold: () => void;
  onDrop: () => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeRow[] | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const episodeRequest = useRef(0);
  const subjectTitle = displaySubjectName(subject.name, subject.nameCn);
  const progressText = `${subject.epStatus} / ${subject.eps || '?'}`;
  const progressPercent = subject.eps > 0 ? Math.min(100, Math.round((subject.epStatus / subject.eps) * 100)) : 0;
  const unwatchedCount = subject.unwatchedProgressEpisodeCount
    ?? subject.unwatchedMainEpisodeCount
    ?? pendingCount;

  const loadEpisodes = useCallback(async () => {
    const request = ++episodeRequest.current;
    setLoadingEpisodes(true);
    setEpisodeError(null);
    try {
      const result = await getSubjectEpisodes(subject.id);
      if (request === episodeRequest.current) setEpisodes(result);
    } catch (error) {
      if (request !== episodeRequest.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setEpisodeError(message);
      onError(message);
    } finally {
      if (request === episodeRequest.current) setLoadingEpisodes(false);
    }
  }, [onError, subject.id]);

  useEffect(() => {
    if (expanded) void loadEpisodes();
    return () => { episodeRequest.current += 1; };
  }, [expanded, loadEpisodes, refreshVersion]);

  async function runGridAction(action: () => Promise<void>) {
    try {
      await action();
      await loadEpisodes();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function toggleEpisodes() {
    setExpanded((current) => !current);
  }

  return (
    <article className="subject-row motion-item" style={motionStyle(index, `watching-subject-${subject.id}`)}>
      <a className="subject-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={subjectTitle}>
        <CoverImage src={subject.image} fallback={subject.nameCn || subject.name} />
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
          <MotionValue value={progressText}>{progressText}</MotionValue>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></div>
        </div>
        {subject.nextEpisode ? (
          <p>下一集：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)} · {formatEpisodeAirdate(subject.nextEpisode.airdate, subject.nextEpisode.airTime)}</p>
        ) : <p>暂无未看的本篇集数</p>}
        <button
          type="button"
          className="secondary episode-grid-toggle"
          onClick={toggleEpisodes}
          disabled={disabled}
          aria-label={`${expanded ? '收起' : '查看'}${subjectTitle}集数`}
          aria-expanded={expanded}
        >
          {expanded ? '收起集数' : '查看集数'}
        </button>
        {expanded && loadingEpisodes ? <p role="status">正在加载集数。</p> : null}
        {expanded && episodeError ? <div className="episode-load-error"><p role="alert">{episodeError}</p>
          <button type="button" className="secondary" disabled={disabled || loadingEpisodes} onClick={() => void loadEpisodes()}>重试加载集数</button></div> : null}
        {expanded && episodes?.length === 0 && !loadingEpisodes && !episodeError ? <p>暂无已同步集数。</p> : null}
        {expanded && episodes ? (
          <WatchProgressGrid
            subjectTitle={subjectTitle}
            episodes={episodes}
            totalEpisodes={subject.eps}
            disabled={disabled || loadingEpisodes}
            motionKey="watching-episode"
            onWatchedThrough={(episodeId) => void runGridAction(() => onWatchedThrough(episodeId))}
            onWatched={(episodeId) => void runGridAction(() => onWatched(episodeId))}
            onUnwatched={(episodeId) => void runGridAction(() => onUnwatched(episodeId))}
          />
        ) : null}
      </div>
    </article>
  );
}

function EpisodeItem({
  index,
  episode,
  subject,
  disabled,
  processing,
  onWatched,
  onSnooze,
  onDismiss
}: {
  index: number;
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
    <article className="episode-row motion-item" style={motionStyle(index, `pending-episode-${episode.id}`)}>
      <a className="episode-visual" href={episode.subjectUrl} target="_blank" rel="noreferrer" aria-label={subjectTitle}>
        <CoverImage src={subject?.image} fallback={subjectTitle} />
        <span className="episode-index" title={formatEpisodeAirdate(episode.airdate, episode.airTime)}>
          <span>{episode.airTime || episode.airdate.slice(5) || '--'}</span>
          <strong>
            {episode.airTime && episode.airdate ? <span className="episode-date">{episode.airdate.slice(5)}</span> : null}
            <span className="episode-number">第 {episode.ep ?? episode.sort} 集</span>
          </strong>
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
