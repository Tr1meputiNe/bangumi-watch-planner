import type { CalendarDay, CalendarSubject } from '../../server/types.js';
import { displaySubjectName } from '../../shared/format.js';

export type CalendarViewState = {
  days: CalendarDay[] | null;
  error: string | null;
  loading: boolean;
};

export default function CalendarView({ state, onRetry }: { state: CalendarViewState; onRetry: () => void }) {
  const rawDays = state.days ?? [];
  const todayWeekdayId = getShanghaiWeekdayId();
  const days = orderCalendarDaysFromToday(rawDays, todayWeekdayId);
  const today = days.find((day) => day.weekday.id === todayWeekdayId);
  const totalCount = days.reduce((sum, day) => sum + day.items.length, 0);
  const featuredItems = days.flatMap((day) => day.items).filter((item) => item.image).slice(0, 6);

  return (
    <section className="calendar-panel" aria-label="每日放送">
      <header className="calendar-overview">
        {featuredItems.length > 0 ? (
          <div className="calendar-overview-covers" aria-hidden="true">
            {featuredItems.map((item) => <img key={item.id} src={item.image} alt="" />)}
          </div>
        ) : null}
        <div>
          <span className="panel-eyebrow">放送日历</span>
          <h1>每日放送</h1>
          <p>{formatShanghaiToday()} · 本周 {totalCount} 部，今日 {today?.items.length ?? 0} 部</p>
        </div>
        <div className="calendar-overview-actions">
          <span><strong>{today?.items.length ?? 0}</strong> 今日放送</span>
          <button type="button" className="secondary" onClick={onRetry} disabled={state.loading}>刷新</button>
        </div>
      </header>

      {state.error ? <div className="notice error calendar-notice">{state.error}</div> : null}
      {state.loading && days.length === 0 ? <div className="empty">正在加载每日放送。</div> : null}
      {!state.loading && days.length === 0 && !state.error ? <div className="empty">暂无每日放送数据。</div> : null}

      {days.length > 0 ? (
        <div className="calendar-grid">
          {days.map((day) => (
            <section
              key={day.weekday.id}
              className={day.weekday.id === todayWeekdayId ? 'calendar-day is-today' : 'calendar-day'}
              aria-label={`${day.weekday.cn} ${day.items.length} 部`}
            >
              <header className="calendar-day-header">
                <div className="calendar-day-heading"><span>{day.weekday.en}</span><h2>{day.weekday.cn}</h2></div>
                <div className="calendar-day-summary">
                  {day.weekday.id === todayWeekdayId ? <span className="calendar-today-label">今天</span> : null}
                  <strong>{day.items.length} 部</strong>
                </div>
              </header>
              <div className="calendar-items">
                {orderCalendarItemsByBroadcastTime(day.items).map((item) => <CalendarSubjectItem key={item.id} item={item} />)}
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

function CalendarSubjectItem({ item }: { item: CalendarSubject }) {
  const stats = calendarSubjectStats(item);
  const dateTime = item.airDate ? `${item.airDate}${item.airTime ? `T${item.airTime}` : ''}` : undefined;

  return (
    <article className="calendar-subject">
      <time className="calendar-air" dateTime={dateTime} aria-label={formatCalendarAirDateTime(item.airDate, item.airTime)}>
        <strong>{item.airTime || '待定'}</strong>
        <span>{item.airDate || '日期待定'}</span>
      </time>
      <a className="calendar-cover" href={item.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(item.name, item.nameCn)}>
        {item.image ? <img src={item.image} alt="" /> : <span>{item.nameCn || item.name}</span>}
      </a>
      <div className="calendar-subject-main">
        <a href={item.url} target="_blank" rel="noreferrer">{displaySubjectName(item.name, item.nameCn)}</a>
        {stats ? <p>{stats}</p> : null}
      </div>
    </article>
  );
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
