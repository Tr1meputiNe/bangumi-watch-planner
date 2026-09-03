import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarCheck2,
  CirclePause,
  HeartPlus,
  LibraryBig,
  ListVideo,
  RadioTower,
  Telescope,
  TvMinimalPlay,
  type LucideIcon
} from 'lucide-react';
import {
  addSubjectToWishlist,
  addSubjectToWatching,
  getAuthStatus,
  getBacklog,
  getCalendar,
  getDashboard,
  getHeldSubjects,
  getSyncStatus,
  retryOperation,
  resumeHeldSubject,
  saveOAuthConfig,
  searchAnime,
  startSync,
  startFullSync,
  startSubject
} from './api.js';
import type { AnimeSearchResult, AuthStatus, BacklogData, DashboardData, DashboardEvent, DashboardSubject, SyncDiagnostics, SyncStatus } from '../server/types.js';
import { displaySubjectName, formatDateTime } from '../shared/format.js';
import BacklogView from './views/BacklogView.js';
import CalendarView, { type CalendarViewState } from './views/CalendarView.js';
import WatchingView from './views/WatchingView.js';
import HeldView from './views/HeldView.js';
import WishlistView from './views/WishlistView.js';
import UpcomingSeasonView from './views/UpcomingSeasonView.js';
import { commitWithMotion, MotionValue, motionStyle } from './motion.js';

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

type ActiveView = 'today' | 'watching' | 'backlog' | 'held' | 'wishlist' | 'upcoming' | 'calendar';
type PendingAction = 'search' | 'oauth';
type SearchDestination = 'backlog' | 'wishlist';

const emptyState: LoadState = { auth: null, dashboard: null, error: null };
const emptyBacklogState: BacklogState = { data: null, loading: false, error: null };
const emptyCalendarState: CalendarViewState = { days: null, error: null, loading: false };
const emptyHeldState = { data: null as DashboardSubject[] | null, loading: false, error: null as string | null };

export default function App() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [activeView, setActiveView] = useState<ActiveView>('today');
  const [backlogState, setBacklogState] = useState<BacklogState>(emptyBacklogState);
  const [calendarState, setCalendarState] = useState<CalendarViewState>(emptyCalendarState);
  const [heldState, setHeldState] = useState(emptyHeldState);
  const [oauthForm, setOauthForm] = useState({ clientId: '', clientSecret: '' });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [collectionRefreshVersion, setCollectionRefreshVersion] = useState(0);
  const [subjectRefresh, setSubjectRefresh] = useState({ version: 0, ids: [] as number[] });
  const syncHandoffStarted = useRef(false);
  const activeViewRef = useRef<ActiveView>('today');
  const syncRequestVersion = useRef(0);
  const submittedSearchKeyword = useRef('');
  const [animeSearch, setAnimeSearch] = useState<{ error: string | null; keyword: string; results: AnimeSearchResult[] }>({
    error: null,
    keyword: '',
    results: []
  });
  const isPending = pendingAction !== null;
  const isSyncing = syncStatus?.state === 'running';

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  const showError = useCallback((message: string) => {
    setState((current) => ({ ...current, error: message }));
  }, []);

  const acceptSyncStarted = useCallback((status: SyncStatus) => {
    syncRequestVersion.current += 1;
    setSyncStatus(status);
  }, []);

  const load = useCallback(async () => {
    try {
      const auth = await getAuthStatus();
      if (!auth.authenticated) {
        commitWithMotion(() => setState({ auth, dashboard: null, error: null }));
        return;
      }
      const dashboard = await getDashboard();
      commitWithMotion(() => setState({ auth, dashboard, error: null }));
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [showError]);

  const loadDashboardOnly = useCallback(async () => {
    try {
      const dashboard = await getDashboard();
      commitWithMotion(() => setState((current) => ({ ...current, dashboard, error: null })));
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [showError]);

  const loadBacklog = useCallback(async () => {
    setBacklogState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getBacklog();
      commitWithMotion(() => setBacklogState({ data, loading: false, error: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBacklogState((current) => ({ ...current, loading: false, error: message }));
      showError(message);
    }
  }, [showError]);

  const refreshBacklogAndDashboard = useCallback(async () => {
    try {
      const dashboard = await getDashboard();
      commitWithMotion(() => setState((current) => ({ ...current, dashboard, error: null })));
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      const backlog = await getBacklog();
      commitWithMotion(() => setBacklogState({ data: backlog, loading: false, error: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBacklogState((current) => ({ ...current, loading: false, error: message }));
      showError(message);
    }
  }, [showError]);

  const loadCalendar = useCallback(async () => {
    setCalendarState((current) => ({ ...current, loading: true, error: null }));
    try {
      const days = await getCalendar();
      commitWithMotion(() => setCalendarState({ days, error: null, loading: false }));
    } catch (error) {
      setCalendarState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }, []);

  const loadHeld = useCallback(async () => {
    setHeldState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getHeldSubjects();
      commitWithMotion(() => setHeldState({ data, loading: false, error: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHeldState((current) => ({ ...current, loading: false, error: message }));
      showError(message);
    }
  }, [showError]);

  const refreshHeldAndPlanning = useCallback(async () => {
    await Promise.all([loadHeld(), refreshBacklogAndDashboard()]);
  }, [loadHeld, refreshBacklogAndDashboard]);

  const refreshAnimeSearch = useCallback(async () => {
    const keyword = submittedSearchKeyword.current;
    if (!keyword) return;
    try {
      const results = await searchAnime(keyword);
      commitWithMotion(() => setAnimeSearch((current) => ({ ...current, error: null, results })));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAnimeSearch((current) => ({ ...current, error: message }));
      showError(message);
    }
  }, [showError]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!state.auth?.authenticated || typeof window.EventSource !== 'function') return;
    const events = new EventSource('/api/events');
    events.onmessage = (message) => {
      let event: DashboardEvent;
      try {
        event = JSON.parse(message.data) as DashboardEvent;
      } catch {
        return;
      }
      if (event.type === 'error') {
        showError(event.error ?? '后台同步失败，请稍后重试。');
        return;
      }
      const view = activeViewRef.current;
      if (event.scopes?.length && !eventMatchesView(event, view)) return;
      setSubjectRefresh((current) => ({ version: current.version + 1, ids: event.subjectIds }));
      if (view === 'calendar') {
        void loadCalendar();
        return;
      }
      if (view === 'wishlist' || view === 'upcoming') {
        setCollectionRefreshVersion((version) => version + 1);
        void loadDashboardOnly();
        return;
      }
      if (view === 'today' || view === 'backlog') {
        void refreshBacklogAndDashboard();
        if (view === 'backlog') void refreshAnimeSearch();
      } else if (view === 'held') {
        void refreshHeldAndPlanning();
      } else {
        void loadDashboardOnly();
      }
    };
    return () => events.close();
  }, [loadCalendar, loadDashboardOnly, refreshAnimeSearch, refreshBacklogAndDashboard, refreshHeldAndPlanning, showError, state.auth?.authenticated]);

  useEffect(() => {
    if (!state.auth?.authenticated || syncHandoffStarted.current) return;
    syncHandoffStarted.current = true;
    const requestVersion = syncRequestVersion.current;
    void getSyncStatus()
      .then((nextStatus) => {
        if (syncRequestVersion.current !== requestVersion) return;
        setSyncStatus(nextStatus);
        if (nextStatus.state === 'error') {
          showError(`${nextStatus.error ?? '同步失败，请稍后再试。'} 可点击“立即同步”重试。`);
        }
      })
      .catch((error) => {
        if (syncRequestVersion.current !== requestVersion) return;
        showError(error instanceof Error ? error.message : String(error));
      });
  }, [state.auth?.authenticated, showError]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [activeView]);

  useEffect(() => {
    if (
      state.auth?.authenticated
      && (activeView === 'today' || activeView === 'backlog')
      && !backlogState.data
      && !backlogState.loading
      && !backlogState.error
    ) void loadBacklog();
  }, [activeView, backlogState.data, backlogState.error, backlogState.loading, loadBacklog, state.auth?.authenticated]);

  useEffect(() => {
    if (activeView === 'calendar' && !calendarState.days && !calendarState.loading && !calendarState.error) void loadCalendar();
  }, [activeView, calendarState.days, calendarState.error, calendarState.loading, loadCalendar]);

  useEffect(() => {
    if (activeView === 'held' && !heldState.data && !heldState.loading && !heldState.error) void loadHeld();
  }, [activeView, heldState.data, heldState.error, heldState.loading, loadHeld]);

  useEffect(() => {
    if (!isSyncing) return;
    let polling = false;
    const interval = window.setInterval(() => {
      if (polling) return;
      polling = true;
      const requestVersion = syncRequestVersion.current;
      void getSyncStatus()
        .then(async (nextStatus) => {
          if (syncRequestVersion.current !== requestVersion) return;
          setSyncStatus(nextStatus);
          if (nextStatus.state === 'running') return;
          const syncError = nextStatus.state === 'error'
            ? nextStatus.error ?? '同步失败，请稍后再试。'
            : null;
          if (!syncError) {
            const result = nextStatus.result;
            const noChanges = result?.changedSubjectIds?.length === 0 && !result.subjectsFailed;
            setSyncNotice(noChanges ? null : result
              ? `同步完成：${result.subjectsSynced} 部番剧，${result.episodesSynced} 集分集${result.subjectsFailed ? `；${result.subjectsFailed} 部保留旧缓存` : ''}`
              : '同步完成');
          }
          setCollectionRefreshVersion((version) => version + 1);
          if (activeView === 'today' || activeView === 'backlog') await refreshBacklogAndDashboard();
          else if (activeView === 'held') await refreshHeldAndPlanning();
          else await load();
          if (activeView === 'backlog') await refreshAnimeSearch();
          if (syncError) showError(syncError);
        })
        .catch((error) => {
          if (syncRequestVersion.current === requestVersion) showError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          polling = false;
        });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [activeView, isSyncing, load, refreshAnimeSearch, refreshBacklogAndDashboard, refreshHeldAndPlanning, showError]);

  async function runAction(name: PendingAction, action: () => Promise<unknown>) {
    setPendingAction(name);
    try {
      await action();
      await load();
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
      submittedSearchKeyword.current = '';
      setAnimeSearch((current) => ({ ...current, error: null, results: [] }));
      return;
    }
    setPendingAction('search');
    try {
      const results = await searchAnime(keyword);
      submittedSearchKeyword.current = keyword;
      commitWithMotion(() => setAnimeSearch((current) => ({ ...current, error: null, results })));
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

  async function runAnimeCollectionAction(result: AnimeSearchResult, destination: SearchDestination) {
    if (destination === 'backlog' && !result.watchAction) return;
    if (destination === 'wishlist' && !result.wishlistAction) return;
    const optimisticResult: AnimeSearchResult = destination === 'backlog'
      ? {
          ...result,
          collectionType: 3,
          watchAction: null,
          watchActionLabel: '已在看',
          wishlistAction: null,
          wishlistActionLabel: '已在看'
        }
      : {
          ...result,
          collectionType: 1,
          watchAction: null,
          wishlistAction: null,
          wishlistActionLabel: '已在想看'
        };
    commitWithMotion(() => setAnimeSearch((current) => ({
      ...current,
      error: null,
      results: current.results.map((item) => item.id === result.id ? optimisticResult : item)
    })));

    try {
      let backgroundStatus: SyncStatus | null = null;
      if (destination === 'wishlist') {
        backgroundStatus = await addSubjectToWishlist(result.id);
        setAnimeSearch((current) => ({
          ...current,
          results: current.results.map((item) => item.id === result.id
            ? {
                ...item,
                watchAction: result.watchAction === 'add' ? 'start' : result.watchAction,
                watchActionLabel: result.watchAction === 'add' ? '加入补番' : result.watchActionLabel
              }
            : item)
        }));
      } else {
        if (result.watchAction === 'add') backgroundStatus = await addSubjectToWatching(result.id);
        if (result.watchAction === 'start') backgroundStatus = await startSubject(result.id);
        if (result.watchAction === 'resume') await resumeHeldSubject(result.id);
      }
      if (backgroundStatus) {
        acceptSyncStarted(backgroundStatus);
        return;
      }
      await refreshBacklogAndDashboard();
    } catch (error) {
      setAnimeSearch((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
        results: current.results.map((item) => item.id === result.id ? result : item)
      }));
    }
  }

  async function saveOAuthSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction('oauth', () => saveOAuthConfig(oauthForm.clientId, oauthForm.clientSecret));
  }

  async function startManualSync() {
    const requestVersion = ++syncRequestVersion.current;
    setSyncNotice(null);
    setState((current) => ({ ...current, error: null }));
    try {
      const status = await startSync();
      if (syncRequestVersion.current === requestVersion) setSyncStatus(status);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  async function startFullCalibration() {
    const requestVersion = ++syncRequestVersion.current;
    setSyncNotice(null);
    setState((current) => ({ ...current, error: null }));
    try {
      const status = await startFullSync();
      if (syncRequestVersion.current === requestVersion) setSyncStatus(status);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  async function retryFailedOperation(operationId: number) {
    try {
      await retryOperation(operationId);
      await load();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  if (!state.auth) {
    return <BangumiLoading error={state.error} onRetry={load} />;
  }

  if (!state.auth.authenticated) {
    return (
      <BangumiLogin
        auth={state.auth}
        error={state.error}
        disabled={isPending}
        oauthForm={oauthForm}
        setOauthForm={setOauthForm}
        pendingAction={pendingAction}
        onSaveOAuth={saveOAuthSettings}
      />
    );
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
            <span className="brand-mark" aria-hidden="true"><ListVideo /></span>
            <div><p>Bangumi Watch Planner</p><strong>{accountLabel}</strong></div>
          </div>
          <div className="topbar-stats" aria-live="polite">
            <span><MotionValue value={pendingEpisodes.length}>{pendingEpisodes.length} 集待补</MotionValue></span>
            <span><MotionValue value={subjects.length}>{subjects.length} 部在看</MotionValue></span>
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
          <Tab icon={CalendarCheck2} active={activeView === 'today'} onClick={() => setActiveView('today')}>今日</Tab>
          <Tab icon={TvMinimalPlay} active={activeView === 'watching'} onClick={() => setActiveView('watching')}>追番</Tab>
          <Tab icon={LibraryBig} active={activeView === 'backlog'} onClick={() => setActiveView('backlog')}>补番计划</Tab>
          <Tab icon={CirclePause} active={activeView === 'held'} onClick={() => setActiveView('held')}>搁置</Tab>
          <Tab icon={HeartPlus} active={activeView === 'wishlist'} onClick={() => setActiveView('wishlist')}>想看</Tab>
          <Tab icon={Telescope} active={activeView === 'upcoming'} onClick={() => setActiveView('upcoming')}>下季新番</Tab>
          <Tab icon={RadioTower} active={activeView === 'calendar'} onClick={() => setActiveView('calendar')}>每日放送</Tab>
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

        <div key={activeView} className="view-motion" data-view={activeView}>
          {activeView === 'today' ? (
            state.dashboard ? (
              <WatchingView
                mode="today"
                dashboard={state.dashboard}
                backlog={backlogState.data}
                disabled={isPending || backlogState.loading}
                changedSubjectIds={subjectRefresh.ids}
                refreshVersion={subjectRefresh.version}
                onChanged={refreshBacklogAndDashboard}
                onError={showError}
              />
            ) : <div className="empty">正在加载今日安排。</div>
          ) : null}

          {activeView === 'watching' ? (
            <>
              {state.dashboard ? (
                <WatchingView
                  mode="watching"
                  dashboard={state.dashboard}
                  disabled={isPending}
                  changedSubjectIds={subjectRefresh.ids}
                  refreshVersion={subjectRefresh.version}
                  onChanged={refreshBacklogAndDashboard}
                  onError={showError}
                />
              ) : <div className="empty">正在加载追番。</div>}
              <SettingsPanel
                auth={state.auth}
                diagnostics={state.dashboard?.syncDiagnostics}
                disabled={isSyncing}
                onFullSync={startFullCalibration}
                onRetryOperation={retryFailedOperation}
              />
            </>
          ) : null}

          {activeView === 'backlog' ? (
            <>
              <AnimeSearchPanel
                authenticated={Boolean(state.auth?.authenticated)}
                disabled={isPending}
                search={animeSearch}
                setSearch={setAnimeSearch}
                pendingAction={pendingAction}
                onSearch={runAnimeSearch}
                onAction={runAnimeCollectionAction}
              />
              {backlogState.data ? (
                <BacklogView
                  data={backlogState.data}
                  disabled={isPending || backlogState.loading}
                  onChanged={refreshBacklogAndDashboard}
                  onError={showError}
                />
              ) : (
                <div className={backlogState.error ? 'empty retryable' : 'empty'}>
                  <span>{backlogState.error || '正在加载补番计划。'}</span>
                  {backlogState.error ? <button type="button" className="secondary" onClick={() => void loadBacklog()}>重试补番计划</button> : null}
                </div>
              )}
            </>
          ) : null}

          {activeView === 'wishlist' ? (
            <WishlistView
              disabled={isPending}
              refreshVersion={collectionRefreshVersion}
              onSyncStarted={acceptSyncStarted}
              onError={showError}
            />
          ) : null}
          {activeView === 'upcoming' ? (
            <UpcomingSeasonView
              disabled={isPending}
              refreshVersion={collectionRefreshVersion}
              onSyncStarted={acceptSyncStarted}
              onError={showError}
            />
          ) : null}
          {activeView === 'held' ? (
            heldState.data ? (
              <HeldView
                subjects={heldState.data}
                disabled={isPending || heldState.loading}
                onChanged={refreshHeldAndPlanning}
                onError={showError}
              />
            ) : (
              <div className={heldState.error ? 'empty retryable' : 'empty'}>
                <span>{heldState.error || '正在加载搁置动画。'}</span>
                {heldState.error ? <button type="button" className="secondary" onClick={() => void loadHeld()}>重试搁置列表</button> : null}
              </div>
            )
          ) : null}
          {activeView === 'calendar' ? (
            <CalendarView state={calendarState} onRetry={loadCalendar} onError={showError} />
          ) : null}
        </div>

        <div className="page-ambient-ornament" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </main>
  );
}

function Tab({ icon: Icon, active, onClick, children }: {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}>
      <span className="tab-mark" aria-hidden="true"><Icon /></span>
      <span className="tab-label">{children}</span>
    </button>
  );
}

type SearchState = { error: string | null; keyword: string; results: AnimeSearchResult[] };

function BangumiLoading({ error, onRetry }: { error: string | null; onRetry(): Promise<void> }) {
  return (
    <main className="bangumi-login-shell">
      <section className="panel bangumi-login-card" aria-label="正在连接">
        <span className="bangumi-login-mark" aria-hidden="true">番</span>
        <div>
          <span className="panel-eyebrow">Bangumi Watch Planner</span>
          <h1>{error ? '无法连接' : '正在连接'}</h1>
          <p>{error || '正在检查 Bangumi 登录状态。'}</p>
        </div>
        {error ? <button type="button" onClick={() => void onRetry()}>重试</button> : null}
      </section>
    </main>
  );
}

function BangumiLogin({
  auth,
  error,
  disabled,
  oauthForm,
  setOauthForm,
  pendingAction,
  onSaveOAuth
}: {
  auth: AuthStatus;
  error: string | null;
  disabled: boolean;
  oauthForm: { clientId: string; clientSecret: string };
  setOauthForm: React.Dispatch<React.SetStateAction<{ clientId: string; clientSecret: string }>>;
  pendingAction: PendingAction | null;
  onSaveOAuth(event: React.FormEvent<HTMLFormElement>): Promise<void>;
}) {
  return (
    <main className="bangumi-login-shell">
      <section className="panel bangumi-login-card" aria-label="Bangumi 登录">
        <header className="bangumi-login-header">
          <span className="bangumi-login-mark" aria-hidden="true">番</span>
          <div>
            <span className="panel-eyebrow">Bangumi Watch Planner</span>
            <h1>{auth.configured === false ? '配置 Bangumi 登录' : '登录 Bangumi'}</h1>
          </div>
        </header>
        <p className="bangumi-login-description">
          {auth.configured === false
            ? '先填写 Bangumi 开发者应用信息，再使用你的 Bangumi 账号授权。'
            : '使用 Bangumi 账号授权后进入追番计划。'}
        </p>
        {error ? <p className="search-error" role="alert">{error}</p> : null}
        {auth.configured === false ? (
          <>
            <div className="oauth-guide">
              <a href="https://bgm.tv/dev" target="_blank" rel="noreferrer">打开 Bangumi 开发者平台</a>
              <p>创建应用时把回调地址填为：</p>
              <code>{auth.callbackUrl ?? 'http://127.0.0.1:3777/auth/callback'}</code>
            </div>
            <form className="oauth-form" onSubmit={(event) => void onSaveOAuth(event)}>
              <label>
                <span>Bangumi App ID</span>
                <input
                  value={oauthForm.clientId}
                  onChange={(event) => setOauthForm((current) => ({ ...current, clientId: event.target.value }))}
                  placeholder="App ID"
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
              <button
                type="submit"
                disabled={disabled || !oauthForm.clientId.trim() || !oauthForm.clientSecret.trim()}
                aria-busy={pendingAction === 'oauth'}
              >
                {pendingAction === 'oauth' ? '保存中' : '保存 OAuth 配置'}
              </button>
            </form>
          </>
        ) : (
          <a className="button-link bangumi-login-action" href="/auth/login">使用 Bangumi 登录</a>
        )}
      </section>
    </main>
  );
}

function AnimeSearchPanel({
  authenticated,
  disabled,
  search,
  setSearch,
  pendingAction,
  onSearch,
  onAction
}: {
  authenticated: boolean;
  disabled: boolean;
  search: SearchState;
  setSearch: React.Dispatch<React.SetStateAction<SearchState>>;
  pendingAction: PendingAction | null;
  onSearch(event: React.FormEvent<HTMLFormElement>): Promise<void>;
  onAction(result: AnimeSearchResult, destination: SearchDestination): Promise<void>;
}) {
  return (
    <section className="panel anime-search-panel" aria-label="添加动画">
      <div className="panel-title compact">
        <div><span className="panel-eyebrow">Bangumi 全站</span><h2>搜索动画</h2></div>
        <strong><MotionValue value={search.results.length}>{search.results.length > 0 ? `${search.results.length} 个结果` : '全部动画'}</MotionValue></strong>
      </div>
      <div className="add-subject">
        <form className="anime-search-form" onSubmit={(event) => void onSearch(event)}>
          <label>
            <span>搜索动画</span>
            <input
              value={search.keyword}
              onChange={(event) => setSearch((current) => ({ ...current, keyword: event.target.value }))}
              placeholder="番名、中文名或原名"
              disabled={!authenticated || disabled}
            />
          </label>
          <button
            type="submit"
            disabled={!authenticated || disabled || !search.keyword.trim()}
            aria-busy={pendingAction === 'search'}
          >
            {pendingAction === 'search' ? '搜索中' : '搜索'}
          </button>
        </form>
        {search.error ? <p className="search-error">{search.error}</p> : null}
        {search.results.length > 0 ? (
          <div className="search-results">
            {search.results.map((result, index) => (
              <article key={result.id} className="search-result motion-item" style={motionStyle(index, `search-result-${result.id}`)}>
                <a href={result.url} target="_blank" rel="noreferrer">
                  {result.image ? <img src={result.image} alt="" /> : <span>{result.nameCn || result.name}</span>}
                </a>
                <div>
                  <strong>{displaySubjectName(result.name, result.nameCn)}</strong>
                  <p>{result.eps ? `${result.eps} 集` : '总集数未知'}</p>
                </div>
                <div className="search-result-actions">
                  <button
                    type="button"
                    onClick={() => void onAction(result, 'backlog')}
                    disabled={!result.watchAction || disabled}
                  >
                    {result.watchActionLabel}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void onAction(result, 'wishlist')}
                    disabled={!result.wishlistAction || disabled}
                  >
                    {result.wishlistActionLabel}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SettingsPanel({ auth, diagnostics, disabled, onFullSync, onRetryOperation }: {
  auth: AuthStatus;
  diagnostics?: SyncDiagnostics;
  disabled: boolean;
  onFullSync(): Promise<void>;
  onRetryOperation(operationId: number): Promise<void>;
}) {
  const platform = auth.runtimePlatform ?? 'macOS';
  const backgroundDescription = platform === 'Windows'
    ? '每日 20:00；安装 Windows 启动项后，关闭浏览器也会继续提醒。'
    : platform === 'macOS'
      ? '每日 20:00；安装 LaunchAgent 后，关闭浏览器也会继续提醒。'
      : '每日 20:00；需要由系统服务保持应用运行。';

  return (
    <section className="panel settings-panel" aria-label="设置">
      <div className="panel-title compact">
        <div><span className="panel-eyebrow">偏好与连接</span><h2>设置</h2></div>
        <strong>{auth?.authenticated ? auth.username : '未连接'}</strong>
      </div>

      <div className="settings-row">
        <div>
          <strong>Bangumi</strong>
          <p>{`已连接 ${auth.nickname || auth.username}`}</p>
        </div>
        <span className="status-pill">已连接</span>
      </div>

      <div className="settings-row"><div><strong>后台提醒</strong><p>{backgroundDescription}</p></div><span className="status-pill">{auth?.launchAgentInstalled ? '已启用' : '未启用'}</span></div>
      <div className="settings-row"><div><strong>通知</strong><p>同一天一次汇总；已忽略集数不再提醒。</p></div><span className="status-pill">{auth?.notificationsEnabled === false ? '已关闭' : '已开启'}</span></div>
      <div className="settings-row">
        <div><strong>增量同步</strong><p>{formatSyncDiagnostic(diagnostics?.incremental)}</p></div>
        <span className="status-pill">{diagnostics?.pendingOperations ?? 0} 项待处理</span>
      </div>
      <div className="settings-row">
        <div><strong>完整校准</strong><p>{formatSyncDiagnostic(diagnostics?.full)}</p></div>
        <button type="button" className="secondary" disabled={disabled} onClick={() => void onFullSync()}>立即校准</button>
      </div>
      {diagnostics?.failedOperations.map((operation) => (
        <div className="settings-row" key={operation.id}>
          <div><strong>操作 #{operation.id} 失败</strong><p>{operation.error}</p></div>
          <button type="button" className="secondary" onClick={() => void onRetryOperation(operation.id)}>重试</button>
        </div>
      ))}
    </section>
  );
}

function formatSyncDiagnostic(diagnostic: SyncDiagnostics['incremental'] | undefined): string {
  if (!diagnostic) return '尚未运行';
  const duration = diagnostic.durationMs < 1_000
    ? `${diagnostic.durationMs} ms`
    : `${(diagnostic.durationMs / 1_000).toFixed(1)} 秒`;
  return `${formatDateTime(diagnostic.completedAt)} · ${duration} · ${diagnostic.changedSubjects} 部变化${diagnostic.failedSubjects ? ` · ${diagnostic.failedSubjects} 部失败` : ''}`;
}

function eventMatchesView(event: DashboardEvent, view: ActiveView): boolean {
  const scopes = new Set(event.scopes);
  if (view === 'calendar') return scopes.has('calendar');
  if (view === 'today') return scopes.has('dashboard') || scopes.has('backlog');
  if (view === 'watching') return scopes.has('dashboard');
  if (view === 'backlog') return scopes.has('backlog') || scopes.has('search');
  if (view === 'held') return scopes.has('held') || scopes.has('backlog');
  return scopes.has('wishlist');
}
