import { useEffect, useRef, useState } from 'react';
import { getWishlist, startSubject } from '../api.js';
import CoverImage from '../CoverImage.js';
import type { SyncStatus, WishlistData } from '../../server/types.js';
import { displaySubjectName } from '../../shared/format.js';
import { commitWithMotion, MotionValue, motionStyle } from '../motion.js';
import '../secondary-views.css';

type WishlistViewProps = {
  disabled: boolean;
  refreshVersion: number;
  onSyncStarted(status: SyncStatus): void;
  onError(message: string): void;
};

const emptyWishlist: WishlistData = { items: [], years: [] };

export default function WishlistView({ disabled, refreshVersion, onSyncStarted, onError }: WishlistViewProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [year, setYear] = useState<number | null | 'unknown'>(null);
  const [data, setData] = useState<WishlistData>(emptyWishlist);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [startingIds, setStartingIds] = useState<Set<number>>(new Set());
  const pendingStarts = useRef(new Set<number>());
  const requestSequence = useRef(0);
  const filterKey = `${debouncedQuery}\n${year ?? 'all'}`;
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void loadWishlist();

    async function loadWishlist() {
      const sequence = ++requestSequence.current;
      const startingAtRequest = new Set(pendingStarts.current);
      setLoading(true);
      setLoadError(null);
      try {
        const result = await getWishlist(debouncedQuery, year);
        if (sequence === requestSequence.current) {
          commitWithMotion(() => setData({
            ...result,
            items: result.items.filter((item) => !pendingStarts.current.has(item.id) && !startingAtRequest.has(item.id))
          }));
        }
      } catch (error) {
        if (sequence === requestSequence.current) {
          const message = error instanceof Error ? error.message : String(error);
          setLoadError(message);
          onError(message);
        }
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
        }
      }
    }
    return () => { requestSequence.current += 1; };
  }, [debouncedQuery, onError, refreshVersion, retryVersion, year]);

  async function start(subjectId: number) {
    const index = data.items.findIndex((item) => item.id === subjectId);
    const subject = data.items[index];
    if (!subject || disabled || subject.isUpcoming || pendingStarts.current.has(subjectId)) return;
    const actionFilterKey = filterKey;
    pendingStarts.current.add(subjectId);
    setStartingIds(new Set(pendingStarts.current));
    requestSequence.current += 1;
    setLoading(false);
    commitWithMotion(() => setData((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== subjectId)
    })));

    try {
      onSyncStarted(await startSubject(subjectId));
    } catch (error) {
      if (filterKeyRef.current === actionFilterKey) {
        commitWithMotion(() => setData((current) => {
          if (current.items.some((item) => item.id === subjectId)) return current;
          const items = [...current.items];
          items.splice(Math.min(index, items.length), 0, subject);
          return { ...current, items };
        }));
      } else {
        setRetryVersion((value) => value + 1);
      }
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      pendingStarts.current.delete(subjectId);
      setStartingIds(new Set(pendingStarts.current));
      if (filterKeyRef.current === actionFilterKey) {
        requestSequence.current += 1;
        setLoading(false);
      }
    }
  }

  return (
    <section className="wishlist-panel secondary-page" aria-label="想看" aria-busy={loading}>
      <header className="wishlist-hero">
        <div>

          <h1>想看</h1>
        </div>
        <strong aria-live="polite"><MotionValue value={data.items.length} className="wishlist-count">{data.items.length} 部</MotionValue></strong>
      </header>

      <div className="wishlist-filters" role="search">
        <label>
          <span>搜索想看</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按番名筛选"
          />
        </label>
        <label>
          <span>年份</span>
          <select value={year === null ? 'all' : String(year)} onChange={(event) => setYear(parseYear(event.target.value))}>
            <option value="all">全部年份</option>
            {data.years.map((value) => <option key={value} value={value}>{value}</option>)}
            <option value="unknown">年份未知</option>
          </select>
        </label>
      </div>

      {loadError ? <div className="notice error secondary-notice" role="alert"><span>{loadError}</span><button type="button" className="secondary" onClick={() => setRetryVersion((value) => value + 1)}>重试想看列表</button></div> : null}
      {loading ? <div className={data.items.length ? 'secondary-status' : 'empty'} role="status">正在加载想看列表。</div> : null}
      {!loading && !loadError && data.items.length === 0 ? <div className="empty" role={startingIds.size ? 'status' : undefined}>{startingIds.size ? '正在加入在看…' : '没有符合条件的想看动画。'}</div> : null}
      {data.items.length > 0 ? (
        <div className="wishlist-list">
          {data.items.map((subject, index) => (
            <article key={subject.id} className="wishlist-item motion-item" style={motionStyle(index, `wishlist-subject-${subject.id}`)}>
              <a className="wishlist-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(subject.name, subject.nameCn)}>
                <CoverImage src={subject.image} fallback="暂无封面" />
              </a>
              <div className="wishlist-details">
                <a className="wishlist-title" href={subject.url} target="_blank" rel="noreferrer" title={displaySubjectName(subject.name, subject.nameCn)}>{displaySubjectName(subject.name, subject.nameCn)}</a>
                <p className="wishlist-meta">
                  <span className={subject.isCurrentSeason && !subject.isUpcoming ? 'wishlist-season is-current' : 'wishlist-season'}>
                    {subject.isUpcoming ? '未播出' : subject.isCurrentSeason ? '本季度' : '旧番'}
                  </span>
                  <span>{subject.airYear ?? '年份未知'} · {subject.totalEpisodesKnown ? `${subject.eps} 集` : '总集数未知'}</span>
                </p>
              </div>
              <button
                type="button"
                disabled={disabled || subject.isUpcoming}
                onClick={() => void start(subject.id)}
              >
                {subject.isUpcoming ? '尚未播出' : subject.isCurrentSeason ? '开始追番' : '加入补番'}
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function parseYear(value: string): number | null | 'unknown' {
  if (value === 'all') return null;
  if (value === 'unknown') return 'unknown';
  return Number(value);
}
