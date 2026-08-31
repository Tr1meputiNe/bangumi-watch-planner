import { useEffect, useRef, useState } from 'react';
import { addUpcomingToWishlist, getUpcomingSeason } from '../api.js';
import type { SyncStatus, UpcomingSeasonData, UpcomingSeasonItem } from '../../server/types.js';
import { displaySubjectName } from '../../shared/format.js';
import { commitWithMotion, MotionValue, motionStyle } from '../motion.js';

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
  const requestSequence = useRef(0);

  useEffect(() => {
    void loadUpcoming();

    async function loadUpcoming() {
      const sequence = ++requestSequence.current;
      setLoading(true);
      try {
        const result = await getUpcomingSeason();
        if (sequence === requestSequence.current) commitWithMotion(() => setData(result));
      } catch (error) {
        if (sequence === requestSequence.current) onError(error instanceof Error ? error.message : String(error));
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }
  }, [onError, refreshVersion]);

  async function schedule(item: UpcomingSeasonItem) {
    if (!item.action) return;
    const previous = item;
    commitWithMotion(() => setData((current) => ({
      ...current,
      items: current.items.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        collectionType: 1,
        action: null,
        actionLabel: '已安排开季在看',
        autoWatch: true
      } : candidate)
    })));

    try {
      onSyncStarted(await addUpcomingToWishlist(item.id));
    } catch (error) {
      commitWithMotion(() => setData((current) => ({
        ...current,
        items: current.items.map((candidate) => candidate.id === item.id ? previous : candidate)
      })));
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="wishlist-panel upcoming-season-panel" aria-label="下季新番">
      <header className="wishlist-hero">
        <div>
          <span className="panel-eyebrow">Yuc 新番站 · Bangumi 已确认</span>
          <h1>{seasonLabel(data.seasonKey)}新番</h1>
        </div>
        <strong aria-live="polite">
          <MotionValue value={data.items.length} className="wishlist-count">{data.items.length} 部</MotionValue>
        </strong>
      </header>

      {loading && data.items.length === 0 ? <div className="empty">正在核对下季度新番。</div> : null}
      {!loading && !data.available ? <div className="empty">Yuc 新番列表暂时不可用，请稍后重试。</div> : null}
      {!loading && data.available && data.items.length === 0 ? <div className="empty">暂时没有由 Bangumi 确认的下季度新番。</div> : null}
      {data.items.length > 0 ? (
        <div className="wishlist-list">
          {data.items.map((item, index) => (
            <article key={item.id} className="wishlist-item motion-item" style={motionStyle(index, `upcoming-subject-${item.id}`)}>
              <a className="wishlist-cover" href={item.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(item.name, item.nameCn)}>
                {item.image ? <img src={item.image} alt="" referrerPolicy="no-referrer" /> : <span>暂无封面</span>}
              </a>
              <div className="wishlist-details">
                <a className="wishlist-title" href={item.url} target="_blank" rel="noreferrer">{displaySubjectName(item.name, item.nameCn)}</a>
                <p className="wishlist-meta">
                  <span className="wishlist-season is-current">{item.sourceType || '类型未定'}</span>
                  <span>Bangumi 已确认</span>
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
      ) : null}
    </section>
  );
}

function seasonLabel(seasonKey: string): string {
  const [, year, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  if (!year || !quarter) return '下季度';
  return `${year} ${['冬', '春', '夏', '秋'][Number(quarter) - 1]}季`;
}
