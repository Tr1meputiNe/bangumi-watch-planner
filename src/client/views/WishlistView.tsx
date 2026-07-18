import { useEffect, useRef, useState } from 'react';
import { getWishlist, startSubject } from '../api.js';
import type { WishlistData } from '../../server/types.js';
import { displaySubjectName } from '../../shared/format.js';

type WishlistViewProps = {
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

const emptyWishlist: WishlistData = { items: [], years: [] };

export default function WishlistView({ disabled, onChanged, onError }: WishlistViewProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [year, setYear] = useState<number | null | 'unknown'>(null);
  const [data, setData] = useState<WishlistData>(emptyWishlist);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<number | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void loadWishlist();

    async function loadWishlist() {
      const sequence = ++requestSequence.current;
      setLoading(true);
      try {
        const result = await getWishlist(debouncedQuery, year);
        if (sequence === requestSequence.current) {
          setData(result);
        }
      } catch (error) {
        if (sequence === requestSequence.current) {
          onError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
        }
      }
    }
  }, [debouncedQuery, onError, year]);

  async function start(subjectId: number) {
    setStartingId(subjectId);
    try {
      await startSubject(subjectId);
      await onChanged();
      const sequence = ++requestSequence.current;
      const result = await getWishlist(debouncedQuery, year);
      if (sequence === requestSequence.current) setData(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingId(null);
    }
  }

  return (
    <section className="panel wishlist-panel" aria-label="想看">
      <div className="panel-title">
        <div>
          <span className="panel-eyebrow">Wishlist</span>
          <h1>想看</h1>
        </div>
        <strong>{data.items.length}</strong>
      </div>

      <div className="wishlist-filters">
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

      {loading && data.items.length === 0 ? <div className="empty">正在加载想看列表。</div> : null}
      {!loading && data.items.length === 0 ? <div className="empty">没有符合条件的想看动画。</div> : null}
      {data.items.length > 0 ? (
        <div className="wishlist-list">
          {data.items.map((subject) => (
            <article key={subject.id} className="wishlist-row">
              <a className="wishlist-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(subject.name, subject.nameCn)}>
                {subject.image ? <img src={subject.image} alt="" /> : <span>{subject.nameCn || subject.name}</span>}
              </a>
              <div>
                <div className="wishlist-heading">
                  <a href={subject.url} target="_blank" rel="noreferrer">{displaySubjectName(subject.name, subject.nameCn)}</a>
                  <span className={subject.isCurrentSeason ? 'status-pill' : 'status-pill muted'}>
                    {subject.isCurrentSeason ? '本季度' : '旧番'}
                  </span>
                </div>
                <p>{subject.airYear ?? '年份未知'} · {subject.totalEpisodesKnown ? `${subject.eps} 集` : '总集数未知'}</p>
              </div>
              <button
                type="button"
                disabled={disabled || startingId === subject.id}
                onClick={() => void start(subject.id)}
              >
                {subject.isCurrentSeason ? '开始追番' : '加入补番'}
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
