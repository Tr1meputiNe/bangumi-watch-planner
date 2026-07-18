import { useMemo, useState } from 'react';
import { dismissReminder, markUnwatched, markWatched, markWatchedThrough, snoozeReminderUntilTomorrow } from '../api.js';
import type { DashboardData, DashboardSubject, EpisodeRow } from '../../server/types.js';
import { displayEpisodeTitle, displaySubjectName } from '../../shared/format.js';

type WatchingViewProps = {
  dashboard: DashboardData;
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

export default function WatchingView({ dashboard, disabled, onChanged, onError }: WatchingViewProps) {
  const [busyEpisodeId, setBusyEpisodeId] = useState<number | null>(null);
  const [hiddenEpisodeIds, setHiddenEpisodeIds] = useState<Set<number>>(() => new Set());
  const pendingEpisodes = dashboard.pendingEpisodes.filter((episode) => !hiddenEpisodeIds.has(episode.id));
  const pendingBySubject = useMemo(() => {
    const counts = new Map<number, number>();
    for (const episode of pendingEpisodes) counts.set(episode.subjectId, (counts.get(episode.subjectId) ?? 0) + 1);
    return counts;
  }, [pendingEpisodes]);

  async function runEpisodeAction(episodeId: number, action: () => Promise<unknown>, hide = false) {
    setBusyEpisodeId(episodeId);
    try {
      await action();
      if (hide) setHiddenEpisodeIds((current) => new Set(current).add(episodeId));
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyEpisodeId(null);
    }
  }

  return (
    <div className="workspace">
      <section className="panel backlog-panel" aria-label="待补新集">
        <div className="panel-title">
          <div><span className="panel-eyebrow">Queue</span><h1>待补新集</h1></div>
          <strong>{pendingEpisodes.length}</strong>
        </div>
        {pendingEpisodes.length > 0 ? (
          <div className="episode-list">
            {pendingEpisodes.map((episode) => (
              <EpisodeItem
                key={episode.id}
                episode={episode}
                disabled={disabled || busyEpisodeId === episode.id}
                processing={busyEpisodeId === episode.id}
                onWatched={() => void runEpisodeAction(episode.id, () => markWatched(episode.id), true)}
                onSnooze={() => void runEpisodeAction(episode.id, () => snoozeReminderUntilTomorrow(episode.id), true)}
                onDismiss={() => void runEpisodeAction(episode.id, () => dismissReminder(episode.id), true)}
              />
            ))}
          </div>
        ) : <div className="empty">没有已播出且未看的本篇集数。</div>}
      </section>

      <section className="panel watching-panel" aria-label="在看动画">
        <div className="panel-title compact">
          <div><span className="panel-eyebrow">Watching</span><h2>在看动画</h2></div>
          <strong>{dashboard.subjects.length}</strong>
        </div>
        <div className="subject-list">
          {dashboard.subjects.map((subject) => (
            <SubjectItem
              key={subject.id}
              subject={subject}
              pendingCount={pendingBySubject.get(subject.id) ?? 0}
              disabled={disabled || busyEpisodeId !== null}
              onWatchedThrough={(episodeId) => void runEpisodeAction(episodeId, () => markWatchedThrough(subject.id, episodeId))}
              onUnwatched={(episodeId) => void runEpisodeAction(episodeId, () => markUnwatched(episodeId))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SubjectItem({
  subject,
  pendingCount,
  disabled,
  onWatchedThrough,
  onUnwatched
}: {
  subject: DashboardSubject;
  pendingCount: number;
  disabled: boolean;
  onWatchedThrough: (episodeId: number) => void;
  onUnwatched: (episodeId: number) => void;
}) {
  const subjectTitle = displaySubjectName(subject.name, subject.nameCn);
  const progressText = `${subject.epStatus} / ${subject.eps || '?'}`;
  const progressPercent = subject.eps > 0 ? Math.min(100, Math.round((subject.epStatus / subject.eps) * 100)) : 0;
  const unwatchedCount = subject.unwatchedMainEpisodeCount ?? pendingCount;
  const episodeOptions = subject.mainEpisodes.length > 0 ? subject.mainEpisodes : subject.unwatchedMainEpisodes;

  return (
    <article className="subject-row">
      <a className="subject-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={subjectTitle}>
        {subject.image ? <img src={subject.image} alt="" /> : <span>{subject.nameCn || subject.name}</span>}
      </a>
      <div className="subject-detail">
        <div className="subject-heading">
          <a href={subject.url} target="_blank" rel="noreferrer">{subjectTitle}</a>
          <span>{unwatchedCount > 0 ? `${unwatchedCount} 集未看` : '已同步'}</span>
        </div>
        <div className="progress-row">
          <span>{progressText}</span>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></div>
        </div>
        {subject.nextEpisode ? (
          <p>下一集：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)} · {formatEpisodeAirdate(subject.nextEpisode.airdate, subject.nextEpisode.airTime)}</p>
        ) : <p>暂无未看的本篇集数</p>}
        {episodeOptions.length > 0 ? (
          <WatchProgressGrid
            subjectTitle={subjectTitle}
            episodes={episodeOptions}
            disabled={disabled}
            onWatchedThrough={onWatchedThrough}
            onUnwatched={onUnwatched}
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
  disabled,
  processing,
  onWatched,
  onSnooze,
  onDismiss
}: {
  episode: EpisodeRow;
  disabled: boolean;
  processing: boolean;
  onWatched: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className="episode-row">
      <div className="episode-index" title={formatEpisodeAirdate(episode.airdate, episode.airTime)}>
        <span>{episode.airTime || episode.airdate.slice(5) || '--'}</span>
        <strong>{episode.airTime && episode.airdate ? `${episode.airdate.slice(5)} · ` : ''}第 {episode.sort} 集</strong>
      </div>
      <div className="episode-main">
        <a className="episode-subject" href={episode.subjectUrl} target="_blank" rel="noreferrer">{displaySubjectName(episode.subjectName, episode.subjectNameCn)}</a>
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
