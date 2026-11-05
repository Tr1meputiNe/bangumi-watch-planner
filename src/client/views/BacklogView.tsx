import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ImageOff, Pause, Search, Shuffle, TvMinimalPlay } from 'lucide-react';
import { completeBacklog, markWatched, markUnwatched, markWatchedThrough, pauseBacklog } from '../api.js';
import type { BacklogData, DashboardSubject } from '../../server/types.js';
import { displayEpisodeTitle, displaySubjectName, episodeProgress } from '../../shared/format.js';
import WatchProgressGrid from '../WatchProgressGrid.js';
import CoverImage from '../CoverImage.js';
import '../backlog.css';

type Props = {
  data: BacklogData;
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};
type SortOrder = 'recent' | 'name' | 'remaining';
type RunAction = (key: string, action: () => Promise<unknown>, message: string) => Promise<void>;
const PAGE_SIZE = 24;
const COLLAPSE_MS = 180;

export default function BacklogView({ data, disabled, onChanged, onError }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOrder>('recent');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [candidateIds, setCandidateIds] = useState<number[] | null>(null);
  const seenCandidates = useRef(new Set<number>());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<number[] | null>(null);
  const [columns, setColumns] = useState(2);
  const libraryRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewId = useId();
  const panelId = `${viewId}-progress`;
  const activeById = new Map(data.active.map((subject) => [subject.id, subject]));
  const recent = (data.recent ?? []).flatMap((subject) => {
    const active = activeById.get(subject.id);
    return active ? [active] : [];
  }).slice(0, 6);
  const keyword = query.trim().toLocaleLowerCase();
  const matching = data.active
    .filter((subject) => `${subject.name}\n${subject.nameCn}`.toLocaleLowerCase().includes(keyword))
    .sort((a, b) => compareSubjects(a, b, sort));
  if (expandedOrder) {
    const positions = new Map(expandedOrder.map((id, index) => [id, index]));
    matching.sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
  }
  const visibleSubjects = matching.slice(0, visibleCount);
  const expandedIndex = visibleSubjects.findIndex((subject) => subject.id === expandedId);
  const expandedSubject = expandedIndex >= 0 ? visibleSubjects[expandedIndex] : null;
  const panelAfterIndex = expandedIndex >= 0
    ? Math.min(visibleSubjects.length, Math.ceil((expandedIndex + 1) / columns) * columns) - 1
    : -1;
  const hasMatches = matching.length > 0;
  const eligible = data.active.filter((subject) => subject.nextEpisode !== null);
  const candidates = (candidateIds ?? []).flatMap((id) => {
    const subject = activeById.get(id);
    return subject?.nextEpisode ? [subject] : [];
  });
  const actionsDisabled = disabled || busyAction !== null;

  useEffect(() => {
    const grid = libraryRef.current;
    if (!grid) return;
    const measure = (width = grid.getBoundingClientRect().width) => {
      // These container widths match the gallery's CSS container queries.
      setColumns(width >= 960 ? 4 : width >= 640 ? 3 : 2);
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width));
      observer.observe(grid);
      return () => observer.disconnect();
    }
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [hasMatches]);

  useEffect(() => () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
  }, []);

  const runAction: RunAction = async (key, action, message) => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusyAction(key);
    setNotice('');
    try {
      await action();
      await onChanged();
      setNotice(message);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  };

  function collapseDetails(restoreFocus = true) {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    if (restoreFocus && expandedId !== null) document.getElementById(`${viewId}-toggle-${expandedId}`)?.focus();
    const finish = () => {
      setExpandedId(null);
      setExpandedOrder(null);
      setClosing(false);
      collapseTimer.current = null;
    };
    if (!restoreFocus || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    setClosing(true);
    collapseTimer.current = setTimeout(finish, COLLAPSE_MS);
  }

  function toggleDetails(subjectId: number) {
    if (expandedId === subjectId && !closing) {
      collapseDetails();
      return;
    }
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setClosing(false);
    // Keep this row in place while a progress update changes recent-viewing order.
    setExpandedOrder(matching.map((subject) => subject.id));
    setExpandedId(subjectId);
  }

  function pickCandidates() {
    if (disabled || eligible.length === 0) return;
    let pool = eligible.filter((subject) => !seenCandidates.current.has(subject.id));
    if (pool.length === 0) {
      seenCandidates.current.clear();
      const previous = new Set(candidateIds ?? []);
      pool = eligible.filter((subject) => !previous.has(subject.id));
      if (pool.length === 0) pool = [...eligible];
    }
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[randomIndex]] = [pool[randomIndex], pool[i]];
    }
    const batchSize = Math.min(3, Math.max(1, Math.ceil(eligible.length / 2)));
    const next = pool.slice(0, batchSize).map((subject) => subject.id);
    for (const id of next) seenCandidates.current.add(id);
    setCandidateIds(next);
  }

  return (
    <div className="free-backlog">
      <header className="free-backlog-hero">
        <div>
          <div className="free-backlog-title-line"><h1>补番</h1><span className="free-backlog-count">片库 {data.active.length} 部</span></div>
        </div>
        <button type="button" className="secondary free-backlog-pick" onClick={pickCandidates}
          disabled={actionsDisabled || eligible.length === 0 || (eligible.length === 1 && candidates[0]?.id === eligible[0].id)}>
          <Shuffle size={17} aria-hidden="true" />{candidateIds === null ? '帮我挑一部' : '换一批'}
        </button>
      </header>
      <p role="status" aria-live="polite" className="free-backlog-notice">{notice}</p>

      <section className="free-backlog-section free-backlog-recent-section" aria-label="最近在看">
        <header className="free-backlog-section-heading"><h2>最近在看</h2></header>
        {recent.length > 0 ? (
          <div className="free-backlog-recent">
            {recent.map((subject) => <CompactSubjectCard key={subject.id} subject={subject} />)}
          </div>
        ) : (
          <div className="free-backlog-recent-empty"><span className="free-backlog-recent-icon"><TvMinimalPlay size={19} aria-hidden="true" /></span><p>暂无最近观看</p></div>
        )}
      </section>

      {candidateIds !== null ? (
        <section className="free-backlog-section free-backlog-discovery" aria-label="按需挑选">
          <header className="free-backlog-section-heading"><h2>这次的候选</h2></header>
          <div aria-label="这次的候选" className="free-backlog-recent">
            {candidates.length > 0 ? candidates.map((subject) => <CompactSubjectCard key={subject.id} subject={subject} />)
              : <p className="free-backlog-empty">暂无候选</p>}
          </div>
        </section>
      ) : null}

      <section className="free-backlog-section" aria-label="全部待补">
        <header className="free-backlog-section-heading free-backlog-library-heading">
          <div className="free-backlog-title-line"><h2>全部待补</h2><span className="free-backlog-count">{keyword ? `${matching.length} 部符合` : `${data.active.length} 部`}</span></div>
          <div className="free-backlog-toolbar">
            <label className="free-backlog-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" aria-label="搜索补番" placeholder="搜索中文名或原名" value={query}
                onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); collapseDetails(false); }} />
            </label>
            <select aria-label="补番排序" value={sort} className="free-backlog-sort"
              onChange={(event) => { setSort(event.target.value as SortOrder); setVisibleCount(PAGE_SIZE); collapseDetails(false); }}>
              <option value="recent">最近看过</option><option value="name">名称</option><option value="remaining">剩余集数少的优先</option>
            </select>
          </div>
        </header>
        {hasMatches ? (
          <div className="free-backlog-library-container">
            <div className="free-backlog-library" ref={libraryRef}>
              {visibleSubjects.map((subject, index) => (
                <Fragment key={subject.id}>
                  <LibrarySubjectCard subject={subject} expanded={expandedId === subject.id && !closing}
                    toggleId={`${viewId}-toggle-${subject.id}`} panelId={panelId} onToggle={() => toggleDetails(subject.id)}
                    disabled={actionsDisabled} busyAction={busyAction} onAction={runAction} />
                  {index === panelAfterIndex && expandedSubject ? (
                    <SubjectProgressPanel subject={expandedSubject} panelId={panelId} closing={closing}
                      disabled={actionsDisabled} busyAction={busyAction} onAction={runAction} onCollapse={() => collapseDetails()} />
                  ) : null}
                </Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div className="free-backlog-empty">
            {data.active.length === 0 ? <><p>还没有待补的动画。</p><span>从「想看」添加</span></>
              : <><p>没有找到符合条件的动画。</p><button type="button" className="ghost" onClick={() => { setQuery(''); setVisibleCount(PAGE_SIZE); }}>清除搜索</button></>}
          </div>
        )}
        {!expandedSubject ? <div id={panelId} hidden /> : null}
        {matching.length > visibleCount ? (
          <div className="free-backlog-more"><button type="button" className="secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>再显示 {Math.min(PAGE_SIZE, matching.length - visibleCount)} 部</button><span>已显示 {visibleCount} / {matching.length} 部</span></div>
        ) : null}
      </section>
    </div>
  );
}

function LibrarySubjectCard({ subject, expanded, toggleId, panelId, onToggle, disabled, busyAction, onAction }: {
  subject: DashboardSubject;
  expanded: boolean;
  toggleId: string;
  panelId: string;
  onToggle(): void;
  disabled: boolean;
  busyAction: string | null;
  onAction: RunAction;
}) {
  const title = displaySubjectName(subject.name, subject.nameCn);
  return (
    <article className={`free-backlog-card${expanded ? ' is-expanded' : ''}`} aria-label={title}>
      <SubjectCover subject={subject} />
      <div className="free-backlog-card-copy">
        <h3 title={title}><a href={subject.url} target="_blank" rel="noreferrer">{title}</a></h3>
        <p className="free-backlog-original-name" title={subject.name}>{subject.nameCn && subject.name !== subject.nameCn ? subject.name : ''}</p>
        <SubjectProgress subject={subject} />
      </div>
      <div className="free-backlog-card-actions">
        <button type="button" id={toggleId} className="secondary free-backlog-expand" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
          {expanded ? '收起集数' : '展开集数'}<ChevronDown size={15} aria-hidden="true" />
        </button>
        <button type="button" className="ghost free-backlog-pause" disabled={disabled} aria-busy={busyAction === `pause-${subject.id}`}
          aria-label={`搁置《${title}》`} title="搁置，保留观看进度"
          onClick={() => void onAction(`pause-${subject.id}`, () => pauseBacklog(subject.id), `已搁置《${title}》`)}><Pause size={17} aria-hidden="true" /></button>
      </div>
    </article>
  );
}

function CompactSubjectCard({ subject }: { subject: DashboardSubject }) {
  const title = displaySubjectName(subject.name, subject.nameCn);
  return (
    <article className="free-backlog-card is-compact" aria-label={title}>
      <SubjectCover subject={subject} />
      <div className="free-backlog-card-copy">
        <h3><a href={subject.url} target="_blank" rel="noreferrer">{title}</a></h3>
        <SubjectProgress subject={subject} />
      </div>
    </article>
  );
}

function SubjectCover({ subject }: { subject: DashboardSubject }) {
  const title = displaySubjectName(subject.name, subject.nameCn);
  return (
    <a className="free-backlog-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={`${title} Bangumi 条目`}>
      <CoverImage src={subject.image} alt={`${title}封面`} fallbackClassName="free-backlog-cover-placeholder" fallback={<><ImageOff size={24} aria-hidden="true" /><span>暂无封面</span></>} />
    </a>
  );
}

function SubjectProgress({ subject }: { subject: DashboardSubject }) {
  const percent = subject.eps > 0 ? Math.min(100, Math.max(0, Math.round(subject.epStatus / subject.eps * 100))) : 0;
  return (
    <div className="free-backlog-progress">
      <span>{subject.epStatus} / {subject.totalEpisodesKnown && subject.eps > 0 ? subject.eps : '?'} 集</span>
      <div className="free-backlog-progress-track" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function SubjectProgressPanel({ subject, panelId, closing, disabled, busyAction, onAction, onCollapse }: {
  subject: DashboardSubject;
  panelId: string;
  closing: boolean;
  disabled: boolean;
  busyAction: string | null;
  onAction: RunAction;
  onCollapse(): void;
}) {
  const title = displaySubjectName(subject.name, subject.nameCn);
  const next = subject.nextEpisode;
  const episodes = subject.progressEpisodes ?? subject.mainEpisodes ?? [];
  return (
    <section id={panelId} className={`free-backlog-details${closing ? ' is-closing' : ''}`} role="region" aria-label={`${title}观看进度`} aria-hidden={closing || undefined} inert={closing}>
      <div className="free-backlog-details-clip"><div className="free-backlog-details-inner">
        <header className="free-backlog-details-heading">
          <div><h3>{title}<span>观看进度</span></h3><p>{next ? `下一集 · 第 ${episodeProgress(next)} 集 · ${displayEpisodeTitle(next.name, next.nameCn, next.sort)}` : '暂无未看的本篇集数'}</p></div>
          <button type="button" className="ghost" aria-label={`收起《${title}》的集数`} onClick={onCollapse}>收起<ChevronUp size={15} aria-hidden="true" /></button>
        </header>
        {episodes.length > 0 || subject.eps > 0 ? (
          <WatchProgressGrid subjectTitle={title} episodes={episodes} totalEpisodes={subject.eps} disabled={disabled}
            motionKey={`backlog-episode-${subject.id}`}
            onWatchedThrough={(episodeId) => void onAction(`watched-through-${episodeId}`, () => markWatchedThrough(subject.id, episodeId), '进度已更新')}
            onWatched={(episodeId) => void onAction(`watched-${episodeId}`, () => markWatched(episodeId), '进度已更新')}
            onUnwatched={(episodeId) => void onAction(`unwatched-${episodeId}`, () => markUnwatched(episodeId), '进度已更新')} />
        ) : <p className="free-backlog-empty">暂无分集信息</p>}
        {!subject.totalEpisodesKnown ? <div className="free-backlog-manual-complete"><span>总集数未知</span><button type="button" className="secondary" disabled={disabled} aria-busy={busyAction === `complete-${subject.id}`}
          onClick={() => void onAction(`complete-${subject.id}`, () => completeBacklog(subject.id), `已将《${title}》标为看过`)}>手动完成</button></div> : null}
      </div></div>
    </section>
  );
}

function compareSubjects(a: DashboardSubject, b: DashboardSubject, sort: SortOrder): number {
  if (sort === 'remaining') {
    const remainingA = a.totalEpisodesKnown && a.eps > 0 ? Math.max(0, a.eps - a.epStatus) : Infinity;
    const remainingB = b.totalEpisodesKnown && b.eps > 0 ? Math.max(0, b.eps - b.epStatus) : Infinity;
    if (remainingA !== remainingB) return remainingA - remainingB;
  }
  if (sort === 'recent') {
    const aTime = a.lastWatchedAt ? Date.parse(a.lastWatchedAt) : 0;
    const bTime = b.lastWatchedAt ? Date.parse(b.lastWatchedAt) : 0;
    const difference = (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    if (difference) return difference;
  }
  return displaySubjectName(a.name, a.nameCn).localeCompare(displaySubjectName(b.name, b.nameCn), 'zh-CN', { numeric: true }) || a.id - b.id;
}
