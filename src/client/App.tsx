import { useCallback, useEffect, useState } from 'react';
import {
  addSubjectToWatching,
  getAuthStatus,
  getBacklog,
  getCalendar,
  getDashboard,
  getSyncStatus,
  resumeBacklog,
  saveOAuthConfig,
  searchAnime,
  startSync,
  startSubject
} from './api.js';
import type { AnimeSearchResult, AuthStatus, BacklogData, DashboardData, SyncStatus } from '../server/types.js';
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
type PendingAction = 'search' | 'oauth';

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
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [animeSearch, setAnimeSearch] = useState<{ error: string | null; keyword: string; results: AnimeSearchResult[] }>({
    error: null,
    keyword: '',
    results: []
  });
  const isPending = pendingAction !== null;
  const isSyncing = syncStatus?.state === 'running';

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
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [activeView]);

  useEffect(() => {
    if (activeView === 'backlog' && !backlogState.data && !backlogState.loading) void loadBacklog();
  }, [activeView, backlogState.data, backlogState.loading, loadBacklog]);

  useEffect(() => {
    if (activeView === 'calendar' && !calendarState.days && !calendarState.loading) void loadCalendar();
  }, [activeView, calendarState.days, calendarState.loading, loadCalendar]);

  useEffect(() => {
    if (!isSyncing) return;
    let polling = false;
    const interval = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void getSyncStatus()
        .then(async (nextStatus) => {
          setSyncStatus(nextStatus);
          if (nextStatus.state === 'running') return;
          if (nextStatus.state === 'error') {
            showError(nextStatus.error ?? '同步失败，请稍后再试。');
            return;
          }
          const result = nextStatus.result;
          setSyncNotice(result
            ? `同步完成：${result.subjectsSynced} 部番剧，${result.episodesSynced} 集分集`
            : '同步完成');
          if (activeView === 'backlog') await refreshBacklogAndDashboard();
          else await load();
        })
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          polling = false;
        });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [activeView, isSyncing, load, refreshBacklogAndDashboard, showError]);

  async function runAction(name: PendingAction, action: () => Promise<unknown>) {
    setPendingAction(name);
    try {
      await action();
      if (activeView === 'backlog') await refreshBacklogAndDashboard();
      else await load();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function runAnimeSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = animeSearch.keyword.trim();
    if (!keyword) {
      setAnimeSearch((current) => ({ ...current, error: null, results: [] }));
      return;
    }
    setPendingAction('search');
    try {
      const results = await searchAnime(keyword);
      setAnimeSearch((current) => ({ ...current, error: null, results }));
    } catch (error) {
      setAnimeSearch((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
        results: []
      }));
    } finally {
      setPendingAction(null);
    }
  }

  async function runAnimeWatchAction(result: AnimeSearchResult) {
    if (!result.watchAction) return;
    setAddingSubjectId(result.id);
    try {
      if (result.watchAction === 'add') await addSubjectToWatching(result.id);
      if (result.watchAction === 'start') await startSubject(result.id);
      if (result.watchAction === 'resume') await resumeBacklog(result.id);
      await load();
      setAnimeSearch((current) => ({
        ...current,
        error: null,
        results: current.results.map((item) => item.id === result.id
          ? { ...item, collectionType: 3, watchAction: null, watchActionLabel: '已在看' }
          : item)
      }));
    } catch (error) {
      setAnimeSearch((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setAddingSubjectId(null);
    }
  }

  async function saveOAuthSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction('oauth', () => saveOAuthConfig(oauthForm.clientId, oauthForm.clientSecret));
  }

  async function startManualSync() {
    setSyncNotice(null);
    try {
      setSyncStatus(await startSync());
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  const pendingEpisodes = state.dashboard?.pendingEpisodes ?? [];
  const subjects = state.dashboard?.subjects ?? [];
  const featuredSubjects = subjects.filter((subject) => subject.image).slice(0, 4);
  const accountLabel = state.auth?.authenticated ? state.auth.nickname || state.auth.username : '未连接';
  const syncTime = formatDateTime(state.dashboard?.lastSyncAt ?? state.auth?.lastSyncAt ?? null);

  return (
    <main className="app-shell hallmark-workbench">
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
          {featuredSubjects.length > 0 ? (
            <div className="sidebar-covers" aria-label="近期在看">
              <span>近期在看</span>
              <div className="sidebar-cover-list">
                {featuredSubjects.map((subject) => (
                  <a
                    key={subject.id}
                    href={subject.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={displaySubjectName(subject.name, subject.nameCn)}
                  >
                    <img src={subject.image} alt="" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <div className="topbar-actions">
            <button
              type="button"
              onClick={() => void startManualSync()}
              disabled={isSyncing || !state.auth?.authenticated}
              aria-busy={isSyncing}
            >
              {isSyncing
                ? syncStatus.totalSubjects > 0
                  ? `同步中 ${syncStatus.processedSubjects}/${syncStatus.totalSubjects}`
                  : '同步中'
                : '立即同步'}
            </button>
          </div>
        </header>

        <div className="page-tabs" role="tablist" aria-label="视图">
          <Tab mark="追" active={activeView === 'watching'} onClick={() => setActiveView('watching')}>追番提醒</Tab>
          <Tab mark="补" active={activeView === 'backlog'} onClick={() => setActiveView('backlog')}>补番计划</Tab>
          <Tab mark="想" active={activeView === 'wishlist'} onClick={() => setActiveView('wishlist')}>想看</Tab>
          <Tab mark="播" active={activeView === 'calendar'} onClick={() => setActiveView('calendar')}>每日放送</Tab>
        </div>

        <footer className="app-footer">
          <span>Bangumi Planner</span>
          <span>2026</span>
        </footer>
      </aside>

      <div className="app-content">
        {state.error ? <div className="notice error">{state.error}</div> : null}
        {syncNotice ? <div className="notice" role="status">{syncNotice}</div> : null}
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
              pendingAction={pendingAction}
              onSearch={runAnimeSearch}
              onAction={runAnimeWatchAction}
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

        <div className="page-ambient-ornament" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </main>
  );
}

function Tab({ mark, active, onClick, children }: { mark: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}>
      <span className="tab-mark" data-mark={mark} aria-hidden="true" />
      <span className="tab-label">{children}</span>
    </button>
  );
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
  pendingAction,
  onSearch,
  onAction,
  onSaveOAuth
}: {
  auth: AuthStatus | null;
  disabled: boolean;
  oauthForm: { clientId: string; clientSecret: string };
  setOauthForm: React.Dispatch<React.SetStateAction<{ clientId: string; clientSecret: string }>>;
  animeSearch: SearchState;
  setAnimeSearch: React.Dispatch<React.SetStateAction<SearchState>>;
  addingSubjectId: number | null;
  pendingAction: PendingAction | null;
  onSearch(event: React.FormEvent<HTMLFormElement>): Promise<void>;
  onAction(result: AnimeSearchResult): Promise<void>;
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
          <button
            type="submit"
            disabled={!auth?.authenticated || disabled || !animeSearch.keyword.trim()}
            aria-busy={pendingAction === 'search'}
          >
            {pendingAction === 'search' ? '搜索中' : '搜索'}
          </button>
        </form>
        {animeSearch.error ? <p className="search-error">{animeSearch.error}</p> : null}
        {animeSearch.results.length > 0 ? (
          <div className="search-results">
            {animeSearch.results.map((result) => {
              return (
                <article key={result.id} className="search-result">
                  <a href={result.url} target="_blank" rel="noreferrer">
                    {result.image ? <img src={result.image} alt="" /> : <span>{result.nameCn || result.name}</span>}
                  </a>
                  <div><strong>{displaySubjectName(result.name, result.nameCn)}</strong><p>{result.eps ? `${result.eps} 集` : '总集数未知'}</p></div>
                  <button
                    type="button"
                    onClick={() => void onAction(result)}
                    disabled={!result.watchAction || disabled || addingSubjectId === result.id}
                    aria-busy={addingSubjectId === result.id}
                  >
                    {addingSubjectId === result.id ? '处理中' : result.watchActionLabel}
                  </button>
                </article>
              );
            })}
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
            <button
              type="submit"
              disabled={disabled || !oauthForm.clientId.trim() || !oauthForm.clientSecret.trim()}
              aria-busy={pendingAction === 'oauth'}
            >
              {pendingAction === 'oauth' ? '保存中' : '保存 OAuth 配置'}
            </button>
          </form>
        </div>
      ) : null}

      <div className="settings-row"><div><strong>后台提醒</strong><p>每日 20:00；浏览器关闭后由本机服务发送通知。</p></div><span className="status-pill">{auth?.launchAgentInstalled ? '已安装' : '未安装'}</span></div>
      <div className="settings-row"><div><strong>通知</strong><p>同一天一次汇总；已忽略集数不再提醒。</p></div><span className="status-pill">{auth?.notificationsEnabled === false ? '已关闭' : '已开启'}</span></div>
    </section>
  );
}
