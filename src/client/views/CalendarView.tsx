import { useEffect, useState } from 'react';
import type { CalendarDay, CalendarSubject } from '../../server/types.js';
import { displaySubjectName } from '../../shared/format.js';
import { deleteBroadcastOverride, saveBroadcastOverride } from '../api.js';
import { MotionValue, motionStyle } from '../motion.js';

export type CalendarViewState = {
  days: CalendarDay[] | null;
  error: string | null;
  loading: boolean;
};

export default function CalendarView({
  state,
  onRetry,
  onError
}: {
  state: CalendarViewState;
  onRetry: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const rawDays = state.days ?? [];
  const todayWeekdayId = getShanghaiWeekdayId();
  const days = orderCalendarDaysFromToday(rawDays, todayWeekdayId);
  const today = days.find((day) => day.weekday.id === todayWeekdayId);
  const totalCount = days.reduce((sum, day) => sum + day.items.length, 0);

  return (
    <section className="calendar-panel" aria-label="每日放送">
      <header className="calendar-overview">
        <div>
          <span className="panel-eyebrow">放送日历</span>
          <h1>每日放送</h1>
          <p>{formatShanghaiToday()} · 本周 {totalCount} 部，今日 {today?.items.length ?? 0} 部</p>
        </div>
        <div className="calendar-overview-actions">
          <span><strong><MotionValue value={today?.items.length ?? 0} /></strong> 今日放送</span>
          <button type="button" className="secondary" onClick={() => void onRetry()} disabled={state.loading}>刷新</button>
        </div>
      </header>

      {state.error ? <div className="notice error calendar-notice">{state.error}</div> : null}
      {state.loading && days.length === 0 ? <div className="empty">正在加载每日放送。</div> : null}
      {!state.loading && days.length === 0 && !state.error ? <div className="empty">暂无每日放送数据。</div> : null}

      {days.length > 0 ? (
        <div className="calendar-grid">
          {days.map((day, dayIndex) => (
            <section
              key={day.weekday.id}
              className={day.weekday.id === todayWeekdayId ? 'calendar-day is-today motion-item' : 'calendar-day motion-item'}
              style={motionStyle(dayIndex, `calendar-day-${day.weekday.id}`)}
              aria-label={`${day.weekday.cn} ${day.items.length} 部`}
            >
              <header className="calendar-day-header">
                <div className="calendar-day-heading"><span>{day.weekday.en}</span><h2>{day.weekday.cn}</h2></div>
                <div className="calendar-day-summary">
                  {day.weekday.id === todayWeekdayId ? <span className="calendar-today-label">今天</span> : null}
                  <strong><MotionValue value={day.items.length}>{day.items.length} 部</MotionValue></strong>
                </div>
              </header>
              <div className="calendar-items">
                {orderCalendarItemsByBroadcastTime(day.items).map((item, itemIndex) => (
                  <CalendarSubjectItem key={item.id} index={itemIndex} item={item} onChanged={onRetry} onError={onError} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function orderCalendarDaysFromToday(days: CalendarDay[], todayWeekdayId: number): CalendarDay[] {
  if (todayWeekdayId < 0) return days;
  return [...days].sort((a, b) => weekdayDistanceFromToday(a.weekday.id, todayWeekdayId) - weekdayDistanceFromToday(b.weekday.id, todayWeekdayId));
}

function weekdayDistanceFromToday(weekdayId: number, todayWeekdayId: number): number {
  if (weekdayId < 1 || weekdayId > 7) return Number.MAX_SAFE_INTEGER;
  return (weekdayId - todayWeekdayId + 7) % 7;
}

function orderCalendarItemsByBroadcastTime(items: CalendarSubject[]): CalendarSubject[] {
  return [...items].sort((a, b) => {
    const byDate = a.airDate.localeCompare(b.airDate);
    if (byDate !== 0) return byDate;
    const byTime = compareAirTime(a.airTime, b.airTime);
    if (byTime !== 0) return byTime;
    return displaySubjectName(a.name, a.nameCn).localeCompare(displaySubjectName(b.name, b.nameCn), 'zh-Hans-CN');
  });
}

function compareAirTime(a: string, b: string): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function CalendarSubjectItem({
  index,
  item,
  onChanged,
  onError
}: {
  index: number;
  item: CalendarSubject;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [airDate, setAirDate] = useState(item.airDate);
  const [airTime, setAirTime] = useState(item.airTime);
  const [saving, setSaving] = useState(false);
  const stats = calendarSubjectStats(item);
  const dateTime = item.airDate ? `${item.airDate}${item.airTime ? `T${item.airTime}` : ''}` : undefined;

  useEffect(() => {
    if (!editing) {
      setAirDate(item.airDate);
      setAirTime(item.airTime);
    }
  }, [editing, item.airDate, item.airTime]);

  async function run(action: () => Promise<void>) {
    setSaving(true);
    try {
      await action();
      await onChanged();
      setEditing(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const additionalShift = differenceInDays(item.airDate, airDate);
    if (additionalShift === null) {
      onError('请输入有效的播出日期');
      return;
    }
    void run(() => saveBroadcastOverride(item.id, {
      airDate,
      airTime,
      dateShiftDays: (item.localDateShiftDays ?? 0) + additionalShift
    }));
  }

  return (
    <article className="calendar-subject motion-item" style={motionStyle(index, `calendar-subject-${item.id}`)}>
      <time className="calendar-air" dateTime={dateTime} aria-label={formatCalendarAirDateTime(item.airDate, item.airTime)}>
        <strong>{item.airTime || '待定'}</strong>
        <span>{item.airDate || '日期待定'}</span>
      </time>
      <a className="calendar-cover" href={item.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(item.name, item.nameCn)}>
        {item.image ? <img src={item.image} alt="" /> : <span>{item.nameCn || item.name}</span>}
      </a>
      <div className="calendar-subject-main">
        <a href={item.url} target="_blank" rel="noreferrer">{displaySubjectName(item.name, item.nameCn)}</a>
        <span className={item.isLocalOverride ? 'calendar-source is-local' : 'calendar-source'}>
          {item.scheduleSource ?? 'Bangumi'}
          {item.baseScheduleSource ? ` · 原 ${item.baseScheduleSource}` : ''}
        </span>
        {stats ? <p>{stats}</p> : null}
        <button type="button" className="ghost calendar-edit-button" onClick={() => setEditing((value) => !value)}>
          {editing ? '取消校正' : '校正时间'}
        </button>
        {editing ? (
          <form className="calendar-correction-form" onSubmit={submit}>
            <label>日期<input type="date" required value={airDate} onChange={(event) => setAirDate(event.target.value)} /></label>
            <label>时间<input type="time" required value={airTime} onChange={(event) => setAirTime(event.target.value)} /></label>
            <div>
              <button type="submit" disabled={saving}>保存</button>
              {item.isLocalOverride ? (
                <button type="button" className="secondary" disabled={saving} onClick={() => void run(() => deleteBroadcastOverride(item.id))}>
                  恢复来源
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function differenceInDays(from: string, to: string): number | null {
  const toTime = Date.parse(`${to}T00:00:00Z`);
  if (!to || Number.isNaN(toTime)) return null;
  if (!from) return 0;
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  if (Number.isNaN(fromTime)) return null;
  return Math.round((toTime - fromTime) / 86_400_000);
}

function calendarSubjectStats(item: CalendarSubject): string {
  const parts: string[] = [];
  if (item.ratingScore !== null) parts.push(`评分 ${item.ratingScore.toFixed(1)}`);
  if (item.rank !== null) parts.push(`Rank ${item.rank}`);
  if (item.collectionDoing !== null) parts.push(`${item.collectionDoing} 人在看`);
  return parts.join(' · ');
}

function formatCalendarAirDateTime(airDate: string, airTime: string): string {
  if (airDate && airTime) return `${airDate} ${airTime}`;
  if (airDate) return `${airDate} 具体时间未知`;
  return '播出时间未定';
}

function formatShanghaiToday(): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}年${values.month}月${values.day}日 ${values.weekday}`;
}

function getShanghaiWeekdayId(): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(new Date());
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekday] ?? -1;
}
