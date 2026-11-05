import { useEffect, useRef, useState } from 'react';
import { addUpcomingToWishlist, getUpcomingSeason } from '../api.js';
import CoverImage from '../CoverImage.js';
import type { SyncStatus, UpcomingSeasonData, UpcomingSeasonItem } from '../../server/types.js';
import { displaySubjectName } from '../../shared/format.js';
import { commitWithMotion, MotionValue, motionStyle } from '../motion.js';
import '../secondary-views.css';

type UpcomingSeasonViewProps = {
  disabled: boolean;
  refreshVersion: number;
  onSyncStarted(status: SyncStatus): void;
  onError(message: string): void;
};

const emptyData: UpcomingSeasonData = { seasonKey: '', available: true, items: [] };

export default function UpcomingSeasonView({ disabled, refreshVersion, onSyncStarted, onError }: UpcomingSeasonViewProps) {
  const [data, setData] = useState<UpcomingSeasonData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const requestSequence = useRef(0);
  const pendingMutations = useRef(new Map<number, UpcomingSeasonItem>());

  useEffect(() => {
    void loadUpcoming();

    async function loadUpcoming() {
      const sequence = ++requestSequence.current;
      setLoading(true);
      setLoadError(null);
      try {
        const result = await getUpcomingSeason();
        if (sequence === requestSequence.current) {
          commitWithMotion(() => setData({
            ...result,
            items: result.items.map((item) => pendingMutations.current.has(item.id) ? scheduledItem(item) : item)
          }));
        }
      } catch (error) {
        if (sequence === requestSequence.current) {
          const message = error instanceof Error ? error.message : String(error);
          setLoadError(message);
          onError(message);
        }
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }
    return () => { requestSequence.current += 1; };
  }, [onError, refreshVersion, retryVersion]);

  async function schedule(item: UpcomingSeasonItem) {
    if (!item.action || disabled || pendingMutations.current.has(item.id)) return;
    const previous = item;
    requestSequence.current += 1;
    pendingMutations.current.set(item.id, item);
    setLoading(false);
    commitWithMotion(() => setData((current) => ({
      ...current,
      items: current.items.map((candidate) => candidate.id === item.id ? scheduledItem(candidate) : candidate)
    })));

    try {
      onSyncStarted(await addUpcomingToWishlist(item.id));
    } catch (error) {
      if (pendingMutations.current.has(item.id)) {
        commitWithMotion(() => setData((current) => ({
          ...current,
          items: current.items.map((candidate) => candidate.id === item.id ? previous : candidate)
        })));
      }
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      pendingMutations.current.delete(item.id);
      requestSequence.current += 1;
      setLoading(false);
    }
  }

  return (
    <section className="wishlist-panel upcoming-season-panel secondary-page" aria-label="下季新番" aria-busy={loading}>
      <header className="wishlist-hero">
        <div>

          <h1>{seasonLabel(data.seasonKey)}新番</h1>
        </div>
        <strong aria-live="polite">
          <MotionValue value={data.items.length} className="wishlist-count">{data.items.length} 部</MotionValue>
        </strong>
      </header>

      {loadError ? <div className="notice error secondary-notice" role="alert"><span>{loadError}</span><button type="button" className="secondary" onClick={() => setRetryVersion((value) => value + 1)}>重试下季新番</button></div> : null}
      {loading ? <div className={data.items.length ? 'secondary-status' : 'empty'} role="status">正在核对下季度新番。</div> : null}
      {!loading && !loadError && !data.available ? <div className="empty secondary-notice"><span>Yuc 新番列表暂时不可用，请稍后重试。</span><button type="button" className="secondary" onClick={() => setRetryVersion((value) => value + 1)}>重试下季新番</button></div> : null}
      {!loading && !loadError && data.available && data.items.length === 0 ? <div className="empty">暂时没有由 Bangumi 确认的下季度新番。</div> : null}
      {data.items.length > 0 ? (
        <div className="upcoming-day-groups">
          {groupByWeekday(data.items).map((group) => (
            <section key={group.key} className="upcoming-day-group" aria-label={group.label}>
              <header className="upcoming-day-heading">
                <h2>{group.label}</h2>
                <span>{group.items.length} 部</span>
              </header>
              <div className="wishlist-list">
                {group.items.map((item, index) => (
                  <article key={item.id} className="wishlist-item motion-item" style={motionStyle(index, `upcoming-subject-${item.id}`)}>
                    <a className="wishlist-cover" href={item.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(item.name, item.nameCn)}>
                      <CoverImage src={item.image} fallback="暂无封面" />
                    </a>
                    <div className="wishlist-details">
                      <a className="wishlist-title" href={item.url} target="_blank" rel="noreferrer" title={displaySubjectName(item.name, item.nameCn)}>{displaySubjectName(item.name, item.nameCn)}</a>
                      <p className="wishlist-meta">
                        <span className="wishlist-season is-current">{item.sourceType || '类型未定'}</span>
                        <span>{formatPremiere(item)}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={disabled || item.action === null}
                      onClick={() => void schedule(item)}
                    >
                      {item.actionLabel}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const weekdayLabels = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

function scheduledItem(item: UpcomingSeasonItem): UpcomingSeasonItem {
  return { ...item, collectionType: 1, action: null, actionLabel: '已安排开季在看', autoWatch: true };
}

function groupByWeekday(items: UpcomingSeasonItem[]) {
  const groups = new Map<number, UpcomingSeasonItem[]>();
  for (const item of items) {
    const key = item.airWeekday && item.airWeekday >= 1 && item.airWeekday <= 7 ? item.airWeekday : 8;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, groupItems]) => ({ key, label: weekdayLabels[key - 1] ?? '时间待定', items: groupItems }));
}

function formatPremiere(item: UpcomingSeasonItem): string {
  const [, month, day] = item.normalPremiereDate.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
  if (!month || !day) return item.airTime ? `首播日期待定 · ${item.airTime}` : '常规播出时间待定';
  return `首播 ${Number(month)}月${Number(day)}日 · ${item.airTime || '时间待定'}`;
}

function seasonLabel(seasonKey: string): string {
  const [, year, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  if (!year || !quarter) return '下季度';
  return `${year} ${['冬', '春', '夏', '秋'][Number(quarter) - 1]}季`;
}
