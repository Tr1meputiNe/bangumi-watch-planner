import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  addSubjectToWatching,
  dismissReminder,
  getAuthStatus,
  getCalendar,
  getDashboard,
  markUnwatched,
  markWatchedThrough,
  saveOAuthConfig,
  searchAnime,
  syncNow
} from './api.js';
import type { AnimeSearchResult, AuthStatus, CalendarDay, CalendarSubject, DashboardData, DashboardSubject, EpisodeRow } from '../server/types.js';
import { displayEpisodeTitle, displaySubjectName, formatDateTime } from '../shared/format.js';

type LoadState = {
  auth: AuthStatus | null;
  dashboard: DashboardData | null;
  error: string | null;
};

type CalendarState = {
  days: CalendarDay[] | null;
  error: string | null;
  loading: boolean;
};

type ActiveView = 'planner' | 'calendar';

const emptyState: LoadState = { auth: null, dashboard: null, error: null };
const emptyCalendarState: CalendarState = { days: null, error: null, loading: false };

export default function App() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [activeView, setActiveView] = useState<ActiveView>('planner');
  const [calendarState, setCalendarState] = useState<CalendarState>(emptyCalendarState);
  const [oauthForm, setOauthForm] = useState({ clientId: '', clientSecret: '' });
  const [animeSearch, setAnimeSearch] = useState<{ error: string | null; keyword: string; results: AnimeSearchResult[] }>({
    error: null,
    keyword: '',
    results: []
  });
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const [auth, dashboard] = await Promise.all([getAuthStatus(), getDashboard()]);
      setState({ auth, dashboard, error: null });
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalendarState((current) => ({ ...current, loading: true, error: null }));
    try {
      const days = await getCalendar();
      setCalendarState({ days, error: null, loading: false });
    } catch (error) {
      setCalendarState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeView === 'calendar' && !calendarState.days && !calendarState.loading) {
      void loadCalendar();
    }
  }, [activeView, calendarState.days, calendarState.loading, loadCalendar]);

  const pendingEpisodes = state.dashboard?.pendingEpisodes ?? [];
  const subjects = state.dashboard?.subjects ?? [];

  const pendingBySubject = useMemo(() => {
    const map = new Map<number, number>();
    for (const episode of pendingEpisodes) {
      map.set(episode.subjectId, (map.get(episode.subjectId) ?? 0) + 1);
    }
    return map;
  }, [pendingEpisodes]);

  async function runAction(action: () => Promise<unknown>) {
    startTransition(() => {
      void action()
        .then(load)
        .catch((error) => {
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
        });
    });
  }

  async function runAnimeSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = animeSearch.keyword.trim();
    if (!keyword) {
      setAnimeSearch((current) => ({ ...current, error: null, results: [] }));
      return;
    }
    startTransition(() => {
      void searchAnime(keyword)
        .then((results) => setAnimeSearch((current) => ({ ...current, error: null, results })))
        .catch((error) => {
          setAnimeSearch((current) => ({ ...current, error: error instanceof Error ? error.message : String(error), results: [] }));
        });
    });
  }

  async function saveOAuthSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(() => saveOAuthConfig(oauthForm.clientId, oauthForm.clientSecret));
  }

  const accountLabel = state.auth?.authenticated ? state.auth.nickname || state.auth.username : '未连接';
  const syncTime = formatDateTime(state.dashboard?.lastSyncAt ?? state.auth?.lastSyncAt ?? null);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            bgm
          </span>
          <div>
            <p>Bangumi Watch Planner</p>
            <strong>{accountLabel}</strong>
          </div>
        </div>
        <div className="topbar-stats" aria-live="polite">
          <span>{pendingEpisodes.length} 集待补</span>
          <span>{subjects.length} 部在看</span>
          <span>{syncTime}</span>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => void runAction(syncNow)} disabled={isPending || !state.auth?.authenticated}>
            立即同步
          </button>
        </div>
      </header>

      {state.error ? <div className="notice error">{state.error}</div> : null}
      {state.dashboard?.lastError ? <div className="notice warning">同步错误：{state.dashboard.lastError}</div> : null}

      <div className="page-tabs" role="tablist" aria-label="视图">
        <button type="button" role="tab" aria-selected={activeView === 'planner'} onClick={() => setActiveView('planner')}>
          追番提醒
        </button>
        <button type="button" role="tab" aria-selected={activeView === 'calendar'} onClick={() => setActiveView('calendar')}>
          每日放送
        </button>
      </div>

      {activeView === 'planner' ? (
        <div className="workspace">
          <section className="panel backlog-panel" aria-label="待补新集">
            <div className="panel-title">
              <div>
                <span className="panel-eyebrow">Queue</span>
                <h1>待补新集</h1>
              </div>
              <strong>{pendingEpisodes.length}</strong>
            </div>

            {pendingEpisodes.length > 0 ? (
              <div className="episode-list">
                {pendingEpisodes.map((episode) => (
                  <EpisodeItem
                    key={episode.id}
                    episode={episode}
                    disabled={isPending}
                    onDismiss={() => runAction(() => dismissReminder(episode.id))}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">没有已播出且未看的本篇集数。</div>
            )}
          </section>

          <div className="side-column">
            <section className="panel watching-panel" aria-label="在看动画">
              <div className="panel-title compact">
                <div>
                  <span className="panel-eyebrow">Watching</span>
                  <h2>在看动画</h2>
                </div>
                <strong>{subjects.length}</strong>
              </div>
              <div className="subject-list">
                {subjects.map((subject) => (
                  <SubjectItem
                    key={subject.id}
                    subject={subject}
                    pendingCount={pendingBySubject.get(subject.id) ?? 0}
                    disabled={isPending}
                    onWatchedThrough={(episodeId) => runAction(() => markWatchedThrough(subject.id, episodeId))}
                    onUnwatched={(episodeId) => runAction(() => markUnwatched(episodeId))}
                  />
                ))}
              </div>
            </section>

            <section className="panel settings-panel" aria-label="设置">
              <div className="panel-title compact">
                <div>
                  <span className="panel-eyebrow">Settings</span>
                  <h2>设置</h2>
                </div>
                <strong>{state.auth?.authenticated ? state.auth.username : '未连接'}</strong>
              </div>

            <div className="add-subject">
              <form className="anime-search-form" onSubmit={(event) => void runAnimeSearch(event)}>
                <label>
                  <span>搜索动画</span>
                  <input
                    value={animeSearch.keyword}
                    onChange={(event) => setAnimeSearch((current) => ({ ...current, keyword: event.target.value }))}
                    placeholder="番名、中文名或原名"
                    disabled={!state.auth?.authenticated || isPending}
                  />
                </label>
                <button type="submit" disabled={!state.auth?.authenticated || isPending || !animeSearch.keyword.trim()}>
                  搜索
                </button>
              </form>
              {animeSearch.error ? <p className="search-error">{animeSearch.error}</p> : null}
              {animeSearch.results.length > 0 ? (
                <div className="search-results">
                  {animeSearch.results.map((result) => (
                    <article key={result.id} className="search-result">
                      <a href={result.url} target="_blank" rel="noreferrer">
                        {result.image ? <img src={result.image} alt="" /> : <span>{result.nameCn || result.name}</span>}
                      </a>
                      <div>
                        <strong>{displaySubjectName(result.name, result.nameCn)}</strong>
                        <p>{result.eps ? `${result.eps} 集` : '总集数未知'}</p>
                      </div>
                      <button type="button" onClick={() => void runAction(() => addSubjectToWatching(result.id))} disabled={isPending}>
                        加入在看
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="settings-row">
              <div>
                <strong>Bangumi</strong>
                <p>
                  {state.auth?.authenticated
                    ? `已连接 ${state.auth.nickname || state.auth.username}`
                    : state.auth?.configured === false
                      ? '填写 Bangumi 开发者应用信息后，用你的 Bangumi 账号登录。'
                      : '连接后才能同步你的在看列表。'}
                </p>
              </div>
              {state.auth?.authenticated ? (
                <span className="status-pill">已连接</span>
              ) : state.auth?.configured === false ? (
                <span className="status-pill muted">待配置</span>
              ) : (
                <a className="button-link" href="/auth/login">
                  连接 Bangumi
                </a>
              )}
            </div>
            {!state.auth?.authenticated && state.auth?.configured === false ? (
              <div className="oauth-setup">
                <div className="oauth-guide">
                  <a href="https://bgm.tv/dev" target="_blank" rel="noreferrer">
                    打开 Bangumi 开发者平台
                  </a>
                  <p>创建应用时把回调地址填为：</p>
                  <code>{state.auth.callbackUrl ?? 'http://127.0.0.1:3777/auth/callback'}</code>
                </div>
                <form className="oauth-form" onSubmit={(event) => void saveOAuthSettings(event)}>
                  <label>
                    <span>Bangumi App ID</span>
                    <input
                      value={oauthForm.clientId}
                      onChange={(event) => setOauthForm((current) => ({ ...current, clientId: event.target.value }))}
                      placeholder={state.auth.oauthClientId ?? 'App ID'}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>Bangumi App Secret</span>
                    <input
                      value={oauthForm.clientSecret}
                      onChange={(event) => setOauthForm((current) => ({ ...current, clientSecret: event.target.value }))}
                      placeholder="App Secret"
                      type="password"
                      autoComplete="off"
                    />
                  </label>
                  <button type="submit" disabled={isPending || !oauthForm.clientId.trim() || !oauthForm.clientSecret.trim()}>
                    保存 OAuth 配置
                  </button>
                </form>
              </div>
            ) : null}
            <div className="settings-row">
              <div>
                <strong>后台提醒</strong>
                <p>每日 20:00；浏览器关闭后由本机服务发送通知。</p>
              </div>
              <span className="status-pill">{state.auth?.launchAgentInstalled ? '已安装' : '未安装'}</span>
            </div>
            <div className="settings-row">
              <div>
                <strong>通知</strong>
                <p>同一天一次汇总；已忽略集数不再提醒。</p>
              </div>
              <span className="status-pill">{state.auth?.notificationsEnabled === false ? '已关闭' : '已开启'}</span>
            </div>
            </section>
          </div>
        </div>
      ) : (
        <CalendarPanel state={calendarState} onRetry={() => void loadCalendar()} />
      )}
    </main>
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
          <a href={subject.url} target="_blank" rel="noreferrer">
            {subjectTitle}
          </a>
          <span>{unwatchedCount > 0 ? `${unwatchedCount} 集未看` : '已同步'}</span>
        </div>
        <div className="progress-row">
          <span>{progressText}</span>
          <div className="progress-track" aria-hidden="true">
            <i style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        {subject.nextEpisode ? (
          <p>
            下一集：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)} ·{' '}
            {formatEpisodeAirdate(subject.nextEpisode.airdate, subject.nextEpisode.airTime)}
          </p>
        ) : (
          <p>暂无未看的本篇集数</p>
        )}
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
        const progress = episodeProgress(episode);
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

function episodeProgress(episode: EpisodeRow): number {
  return Number(episode.ep ?? episode.sort);
}

function formatEpisodeProgress(progress: number): string {
  if (!Number.isFinite(progress)) return '?';
  if (!Number.isInteger(progress)) return String(progress);
  return String(progress).padStart(2, '0');
}

function hasAired(airdate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(airdate)) return false;
  return airdate <= todayInShanghai();
}

function formatEpisodeAirdate(airdate: string, airTime = ''): string {
  if (airdate && airTime) return `播出时间：${airdate} ${airTime}`;
  if (airdate) return `播出日期：${airdate} · 具体时间未知`;
  return '播出时间未知';
}

function formatEpisodeIndexPrimary(airdate: string, airTime = ''): string {
  return airTime || airdate.slice(5) || '--';
}

function formatEpisodeIndexMeta(episode: EpisodeRow): string {
  const date = episode.airTime && episode.airdate ? `${episode.airdate.slice(5)} · ` : '';
  return `${date}第 ${episode.sort} 集`;
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function EpisodeItem({
  episode,
  disabled,
  onDismiss
}: {
  episode: EpisodeRow;
  disabled: boolean;
  onDismiss: () => void;
}) {
  return (
    <article className="episode-row">
      <div className="episode-index" title={formatEpisodeAirdate(episode.airdate, episode.airTime)}>
        <span>{formatEpisodeIndexPrimary(episode.airdate, episode.airTime)}</span>
        <strong>{formatEpisodeIndexMeta(episode)}</strong>
      </div>
      <div className="episode-main">
        <a className="episode-subject" href={episode.subjectUrl} target="_blank" rel="noreferrer">
          {displaySubjectName(episode.subjectName, episode.subjectNameCn)}
        </a>
        <h3>{displayEpisodeTitle(episode.name, episode.nameCn, episode.sort)}</h3>
        <a href={episode.subjectUrl} target="_blank" rel="noreferrer">
          打开 Bangumi
        </a>
      </div>
      <div className="episode-actions">
        <button type="button" className="ghost" onClick={onDismiss} disabled={disabled}>
          忽略
        </button>
      </div>
    </article>
  );
}

function CalendarPanel({ state, onRetry }: { state: CalendarState; onRetry: () => void }) {
  const rawDays = state.days ?? [];
  const todayWeekdayId = getShanghaiWeekdayId();
  const days = orderCalendarDaysFromToday(rawDays, todayWeekdayId);
  const today = days.find((day) => day.weekday.id === todayWeekdayId);
  const totalCount = days.reduce((sum, day) => sum + day.items.length, 0);

  return (
    <section className="panel calendar-panel" aria-label="每日放送">
      <div className="panel-title calendar-title">
        <div>
          <span className="panel-eyebrow">Calendar</span>
          <h1>每日放送</h1>
          <p>
            {formatShanghaiToday()} · 本周 {totalCount} 部，今日 {today?.items.length ?? 0} 部
          </p>
        </div>
        <button type="button" className="secondary" onClick={onRetry} disabled={state.loading}>
          刷新
        </button>
      </div>

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
              <header>
                <div>
                  <span>{day.weekday.en}</span>
                  <h2>{day.weekday.cn}</h2>
                </div>
                <strong>{day.items.length}</strong>
              </header>
              <div className="calendar-items">
                {orderCalendarItemsByBroadcastTime(day.items).map((item) => (
                  <CalendarSubjectItem key={item.id} item={item} />
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
  if (todayWeekdayId < 0) {
    return days;
  }
  return [...days].sort((a, b) => weekdayDistanceFromToday(a.weekday.id, todayWeekdayId) - weekdayDistanceFromToday(b.weekday.id, todayWeekdayId));
}

function weekdayDistanceFromToday(weekdayId: number, todayWeekdayId: number): number {
  if (weekdayId < 0 || weekdayId > 6) {
    return Number.MAX_SAFE_INTEGER;
  }
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
  return (
    <article className="calendar-subject">
      <a className="calendar-cover" href={item.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(item.name, item.nameCn)}>
        {item.image ? <img src={item.image} alt="" /> : <span>{item.nameCn || item.name}</span>}
      </a>
      <div>
        <a href={item.url} target="_blank" rel="noreferrer">
          {displaySubjectName(item.name, item.nameCn)}
        </a>
        <p>{calendarSubjectMeta(item)}</p>
      </div>
    </article>
  );
}

function calendarSubjectMeta(item: CalendarSubject): string {
  const parts = [formatCalendarAirDateTime(item.airDate, item.airTime)];
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
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}年${values.month}月${values.day}日 ${values.weekday}`;
}

function getShanghaiWeekdayId(): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short'
  }).format(new Date());
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? -1;
}
