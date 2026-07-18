import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  addSubjectToWatching,
  getAuthStatus,
  getBacklog,
  getCalendar,
  getDashboard,
  saveOAuthConfig,
  searchAnime,
  syncNow
} from './api.js';
import type { AnimeSearchResult, AuthStatus, BacklogData, DashboardData } from '../server/types.js';
import { displaySubjectName, formatDateTime } from '../shared/format.js';
import BacklogView from './views/BacklogView.js';
import CalendarView, { type CalendarViewState } from './views/CalendarView.js';
import WatchingView from './views/WatchingView.js';
import WishlistView from './views/WishlistView.js';

type LoadState = {
  auth: AuthStatus | null;
  dashboard: DashboardData | null;
  error: string | null;
};

type BacklogState = {
  data: BacklogData | null;
  loading: boolean;
  error: string | null;
};

type ActiveView = 'watching' | 'backlog' | 'wishlist' | 'calendar';

const emptyState: LoadState = { auth: null, dashboard: null, error: null };
const emptyBacklogState: BacklogState = { data: null, loading: false, error: null };
const emptyCalendarState: CalendarViewState = { days: null, error: null, loading: false };

export default function App() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [activeView, setActiveView] = useState<ActiveView>('watching');
  const [backlogState, setBacklogState] = useState<BacklogState>(emptyBacklogState);
  const [calendarState, setCalendarState] = useState<CalendarViewState>(emptyCalendarState);
  const [oauthForm, setOauthForm] = useState({ clientId: '', clientSecret: '' });
  const [addingSubjectId, setAddingSubjectId] = useState<number | null>(null);
  const [animeSearch, setAnimeSearch] = useState<{ error: string | null; keyword: string; results: AnimeSearchResult[] }>({
    error: null,
    keyword: '',
    results: []
  });
  const [isPending, startTransition] = useTransition();

  const showError = useCallback((message: string) => {
    setState((current) => ({ ...current, error: message }));
  }, []);

  const load = useCallback(async () => {
    try {
      const [auth, dashboard] = await Promise.all([getAuthStatus(), getDashboard()]);
      setState({ auth, dashboard, error: null });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [showError]);

  const loadBacklog = useCallback(async () => {
    setBacklogState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getBacklog();
      setBacklogState({ data, loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBacklogState((current) => ({ ...current, loading: false, error: message }));
      showError(message);
    }
  }, [showError]);

  const refreshBacklogAndDashboard = useCallback(async () => {
    try {
      const [auth, dashboard, backlog] = await Promise.all([getAuthStatus(), getDashboard(), getBacklog()]);
      setState({ auth, dashboard, error: null });
      setBacklogState({ data: backlog, loading: false, error: null });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [showError]);

  const loadCalendar = useCallback(async () => {
    setCalendarState((current) => ({ ...current, loading: true, error: null }));
    try {
      const days = await getCalendar();
      setCalendarState({ days, error: null, loading: false });
    } catch (error) {
      setCalendarState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (activeView === 'backlog' && !backlogState.data && !backlogState.loading) void loadBacklog();
  }, [activeView, backlogState.data, backlogState.loading, loadBacklog]);

  useEffect(() => {
    if (activeView === 'calendar' && !calendarState.days && !calendarState.loading) void loadCalendar();
  }, [activeView, calendarState.days, calendarState.loading, loadCalendar]);

  async function runAction(action: () => Promise<unknown>) {
    startTransition(() => {
      void action()
        .then(async () => {
          if (activeView === 'backlog') await refreshBacklogAndDashboard();
          else await load();
        })
        .catch((error) => showError(error instanceof Error ? error.message : String(error)));
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
        .catch((error) => setAnimeSearch((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
          results: []
        })));
    });
  }

  async function addAnimeToWatching(subjectId: number) {
    setAddingSubjectId(subjectId);
    try {
      await addSubjectToWatching(subjectId);
      await load();
      setAnimeSearch((current) => ({ ...current, error: null, results: current.results.filter((result) => result.id !== subjectId) }));
    } catch (error) {
      setAnimeSearch((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setAddingSubjectId(null);
    }
  }

  async function saveOAuthSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(() => saveOAuthConfig(oauthForm.clientId, oauthForm.clientSecret));
  }

  const pendingEpisodes = state.dashboard?.pendingEpisodes ?? [];
  const subjects = state.dashboard?.subjects ?? [];
  const accountLabel = state.auth?.authenticated ? state.auth.nickname || state.auth.username : '未连接';
  const syncTime = formatDateTime(state.dashboard?.lastSyncAt ?? state.auth?.lastSyncAt ?? null);

  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="应用导航">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">番</span>
            <div><p>Bangumi Watch Planner</p><strong>{accountLabel}</strong></div>
          </div>
          <div className="topbar-stats" aria-live="polite">
            <span>{pendingEpisodes.length} 集待补</span>
            <span>{subjects.length} 部在看</span>
            <span>{syncTime}</span>
          </div>
          <div className="topbar-actions">
            <button type="button" onClick={() => void runAction(syncNow)} disabled={isPending || !state.auth?.authenticated}>立即同步</button>
          </div>
        </header>

        <div className="page-tabs" role="tablist" aria-label="视图">
          <Tab active={activeView === 'watching'} onClick={() => setActiveView('watching')}>追番提醒</Tab>
          <Tab active={activeView === 'backlog'} onClick={() => setActiveView('backlog')}>补番计划</Tab>
          <Tab active={activeView === 'wishlist'} onClick={() => setActiveView('wishlist')}>想看</Tab>
          <Tab active={activeView === 'calendar'} onClick={() => setActiveView('calendar')}>每日放送</Tab>
        </div>
      </aside>

      <div className="app-content">
        {state.error ? <div className="notice error">{state.error}</div> : null}
        {state.dashboard?.lastError ? <div className="notice warning">同步错误：{state.dashboard.lastError}</div> : null}

        {activeView === 'watching' ? (
          <>
            {state.dashboard ? (
              <WatchingView dashboard={state.dashboard} disabled={isPending} onChanged={load} onError={showError} />
            ) : <div className="empty">正在加载追番提醒。</div>}
            <SettingsPanel
              auth={state.auth}
              disabled={isPending}
              oauthForm={oauthForm}
              setOauthForm={setOauthForm}
              animeSearch={animeSearch}
              setAnimeSearch={setAnimeSearch}
              addingSubjectId={addingSubjectId}
              onSearch={runAnimeSearch}
              onAdd={addAnimeToWatching}
              onSaveOAuth={saveOAuthSettings}
            />
          </>
        ) : null}

        {activeView === 'backlog' ? (
          backlogState.data ? (
            <BacklogView
              data={backlogState.data}
              disabled={isPending || backlogState.loading}
              onChanged={refreshBacklogAndDashboard}
              onError={showError}
            />
          ) : <div className="empty">{backlogState.error || '正在加载补番计划。'}</div>
        ) : null}

        {activeView === 'wishlist' ? <WishlistView disabled={isPending} onChanged={load} onError={showError} /> : null}
        {activeView === 'calendar' ? <CalendarView state={calendarState} onRetry={() => void loadCalendar()} /> : null}
      </div>
    </main>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick}>{children}</button>;
}

type SearchState = { error: string | null; keyword: string; results: AnimeSearchResult[] };

function SettingsPanel({
  auth,
  disabled,
  oauthForm,
  setOauthForm,
  animeSearch,
  setAnimeSearch,
  addingSubjectId,
  onSearch,
  onAdd,
  onSaveOAuth
}: {
  auth: AuthStatus | null;
  disabled: boolean;
  oauthForm: { clientId: string; clientSecret: string };
  setOauthForm: React.Dispatch<React.SetStateAction<{ clientId: string; clientSecret: string }>>;
  animeSearch: SearchState;
  setAnimeSearch: React.Dispatch<React.SetStateAction<SearchState>>;
  addingSubjectId: number | null;
  onSearch(event: React.FormEvent<HTMLFormElement>): Promise<void>;
  onAdd(subjectId: number): Promise<void>;
  onSaveOAuth(event: React.FormEvent<HTMLFormElement>): Promise<void>;
}) {
  return (
    <section className="panel settings-panel" aria-label="设置">
      <div className="panel-title compact">
        <div><span className="panel-eyebrow">偏好与连接</span><h2>设置</h2></div>
        <strong>{auth?.authenticated ? auth.username : '未连接'}</strong>
      </div>

      <div className="add-subject">
        <form className="anime-search-form" onSubmit={(event) => void onSearch(event)}>
          <label>
            <span>搜索动画</span>
            <input
              value={animeSearch.keyword}
              onChange={(event) => setAnimeSearch((current) => ({ ...current, keyword: event.target.value }))}
              placeholder="番名、中文名或原名"
              disabled={!auth?.authenticated || disabled}
            />
          </label>
          <button type="submit" disabled={!auth?.authenticated || disabled || !animeSearch.keyword.trim()}>搜索</button>
        </form>
        {animeSearch.error ? <p className="search-error">{animeSearch.error}</p> : null}
        {animeSearch.results.length > 0 ? (
          <div className="search-results">
            {animeSearch.results.map((result) => (
              <article key={result.id} className="search-result">
                <a href={result.url} target="_blank" rel="noreferrer">
                  {result.image ? <img src={result.image} alt="" /> : <span>{result.nameCn || result.name}</span>}
                </a>
                <div><strong>{displaySubjectName(result.name, result.nameCn)}</strong><p>{result.eps ? `${result.eps} 集` : '总集数未知'}</p></div>
                <button type="button" onClick={() => void onAdd(result.id)} disabled={disabled || addingSubjectId === result.id}>
                  {addingSubjectId === result.id ? '添加中' : '加入在看'}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="settings-row">
        <div>
          <strong>Bangumi</strong>
          <p>{auth?.authenticated
            ? `已连接 ${auth.nickname || auth.username}`
            : auth?.configured === false
              ? '填写 Bangumi 开发者应用信息后，用你的 Bangumi 账号登录。'
              : '连接后才能同步你的在看列表。'}</p>
        </div>
        {auth?.authenticated ? <span className="status-pill">已连接</span> : auth?.configured === false
          ? <span className="status-pill muted">待配置</span>
          : <a className="button-link" href="/auth/login">连接 Bangumi</a>}
      </div>

      {!auth?.authenticated && auth?.configured === false ? (
        <div className="oauth-setup">
          <div className="oauth-guide">
            <a href="https://bgm.tv/dev" target="_blank" rel="noreferrer">打开 Bangumi 开发者平台</a>
            <p>创建应用时把回调地址填为：</p>
            <code>{auth.callbackUrl ?? 'http://127.0.0.1:3777/auth/callback'}</code>
          </div>
          <form className="oauth-form" onSubmit={(event) => void onSaveOAuth(event)}>
            <label><span>Bangumi App ID</span><input value={oauthForm.clientId} onChange={(event) => setOauthForm((current) => ({ ...current, clientId: event.target.value }))} placeholder={auth.oauthClientId ?? 'App ID'} autoComplete="off" /></label>
            <label><span>Bangumi App Secret</span><input value={oauthForm.clientSecret} onChange={(event) => setOauthForm((current) => ({ ...current, clientSecret: event.target.value }))} placeholder="App Secret" type="password" autoComplete="off" /></label>
            <button type="submit" disabled={disabled || !oauthForm.clientId.trim() || !oauthForm.clientSecret.trim()}>保存 OAuth 配置</button>
          </form>
        </div>
      ) : null}

      <div className="settings-row"><div><strong>后台提醒</strong><p>每日 20:00；浏览器关闭后由本机服务发送通知。</p></div><span className="status-pill">{auth?.launchAgentInstalled ? '已安装' : '未安装'}</span></div>
      <div className="settings-row"><div><strong>通知</strong><p>同一天一次汇总；已忽略集数不再提醒。</p></div><span className="status-pill">{auth?.notificationsEnabled === false ? '已关闭' : '已开启'}</span></div>
    </section>
  );
}
