import { useCallback, useEffect, useRef, useState } from 'react';
import CoverImage from './CoverImage.js';
import {
  CalendarCheck2,
  ChevronDown,
  CirclePause,
  HeartPlus,
  LibraryBig,
  ListVideo,
  MoreHorizontal,
  RadioTower,
  Telescope,
  TvMinimalPlay,
  X,
  type LucideIcon
} from 'lucide-react';
import {
  addSubjectToWishlist,
  addSubjectToWatching,
  dismissFailedOperation,
  getAuthStatus,
  getBacklog,
  getCalendar,
  getDashboard,
  getHeldSubjects,
  getSyncStatus,
  retryOperation,
  resumeHeldSubject,
  saveOAuthConfig,
  savePersonalAccessToken,
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
type PendingAction = 'search' | 'oauth' | 'token';
type SearchDestination = 'backlog' | 'wishlist';

const secondaryViewLabels: Partial<Record<ActiveView, string>> = {
  held: '搁置',
  wishlist: '想看',
  upcoming: '下季新番',
  calendar: '每日放送'
};

const emptyState: LoadState = { auth: null, dashboard: null, error: null };
const emptyBacklogState: BacklogState = { data: null, loading: false, error: null };
const emptyCalendarState: CalendarViewState = { days: null, error: null, loading: false };
const emptyHeldState = { data: null as DashboardSubject[] | null, loading: false, error: null as string | null };

export default function App() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [activeView, setActiveView] = useState<ActiveView>('today');
  const [moreOpen, setMoreOpen] = useState(false);
  const [backlogState, setBacklogState] = useState<BacklogState>(emptyBacklogState);
  const [calendarState, setCalendarState] = useState<CalendarViewState>(emptyCalendarState);
  const [heldState, setHeldState] = useState(emptyHeldState);
  const [oauthForm, setOauthForm] = useState({ clientId: '', clientSecret: '' });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [dismissedLastError, setDismissedLastError] = useState<string | null>(null);
  const [resolvingOperationId, setResolvingOperationId] = useState<number | null>(null);
  const [collectionRefreshVersion, setCollectionRefreshVersion] = useState(0);
  const [subjectRefreshVersion, setSubjectRefreshVersion] = useState(0);
  const syncHandoffStarted = useRef(false);
  const activeViewRef = useRef<ActiveView>('today');
  const firstMoreTabRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const syncRequestVersion = useRef(0);
  const loadVersions = useRef({ auth: 0, dashboard: 0, backlog: 0, calendar: 0, held: 0, search: 0 });
  const searchActions = useRef(new Set<number>());
  const searchPending = useRef(false);
  const [pendingSearchIds, setPendingSearchIds] = useState<Set<number>>(new Set());
  const [syncStarting, setSyncStarting] = useState(false);
  const syncStartingRef = useRef(false);
  const submittedSearchKeyword = useRef('');
  const [animeSearch, setAnimeSearch] = useState<SearchState>({
    error: null,
    keyword: '',
    resultKeyword: null,
    results: []
  });
  const isPending = pendingAction === 'oauth' || pendingAction === 'token';
  const isSyncing = syncStatus?.state === 'running';

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    if (moreOpen) firstMoreTabRef.current?.focus();
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.app-sidebar')) setMoreOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [moreOpen]);

  const showError = useCallback((message: string) => {
    setState((current) => ({ ...current, error: message }));
  }, []);

  useEffect(() => {
    if (!state.error) return;
    const timer = window.setTimeout(() => {
      setState((current) => current.error === state.error ? { ...current, error: null } : current);
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [state.error]);

  const acceptSyncStarted = useCallback((status: SyncStatus) => {
    syncRequestVersion.current += 1;
    setSyncStatus(status);
  }, []);

  const load = useCallback(async () => {
    const version = ++loadVersions.current.auth;
    try {
      const auth = await getAuthStatus();
      if (version !== loadVersions.current.auth) return;
      if (!auth.authenticated) {
        commitWithMotion(() => setState({ auth, dashboard: null, error: null }));
        return;
      }
      const dashboardVersion = ++loadVersions.current.dashboard;
      const dashboard = await getDashboard();
      if (version !== loadVersions.current.auth || dashboardVersion !== loadVersions.current.dashboard) return;
      commitWithMotion(() => setState({ auth, dashboard, error: null }));
    } catch (error) {
      if (version === loadVersions.current.auth) showError(error instanceof Error ? error.message : String(error));
    }
  }, [showError]);

  const loadDashboardOnly = useCallback(async () => {
    const version = ++loadVersions.current.dashboard;
    try {
      const dashboard = await getDashboard();
      if (version !== loadVersions.current.dashboard) return;
      commitWithMotion(() => setState((current) => ({ ...current, dashboard, error: null })));
    } catch (error) {
      if (version === loadVersions.current.dashboard) showError(error instanceof Error ? error.message : String(error));
    }
  }, [showError]);

  const loadBacklog = useCallback(async () => {
    const version = ++loadVersions.current.backlog;
    setBacklogState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getBacklog();
      if (version !== loadVersions.current.backlog) return;
      commitWithMotion(() => setBacklogState({ data, loading: false, error: null }));
    } catch (error) {
      if (version !== loadVersions.current.backlog) return;
      const message = error instanceof Error ? error.message : String(error);
      setBacklogState((current) => ({ ...current, loading: false, error: message }));
      showError(message);
    }
  }, [showError]);

  const refreshBacklogAndDashboard = useCallback(async () => {
    await Promise.all([loadDashboardOnly(), loadBacklog()]);
  }, [loadDashboardOnly, loadBacklog]);

  const loadCalendar = useCallback(async () => {
    const version = ++loadVersions.current.calendar;
    setCalendarState((current) => ({ ...current, loading: true, error: null }));
    try {
      const days = await getCalendar();
      if (version !== loadVersions.current.calendar) return;
      commitWithMotion(() => setCalendarState({ days, error: null, loading: false }));
    } catch (error) {
      if (version !== loadVersions.current.calendar) return;
      setCalendarState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }, []);

  const loadHeld = useCallback(async () => {
    const version = ++loadVersions.current.held;
    setHeldState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getHeldSubjects();
      if (version !== loadVersions.current.held) return;
      commitWithMotion(() => setHeldState({ data, loading: false, error: null }));
    } catch (error) {
      if (version !== loadVersions.current.held) return;
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
    if (!keyword || searchPending.current || searchActions.current.size) return;
    const version = ++loadVersions.current.search;
    try {
      const results = await searchAnime(keyword);
      if (version !== loadVersions.current.search) return;
      commitWithMotion(() => setAnimeSearch((current) => ({ ...current, error: null, resultKeyword: keyword, results })));
    } catch (error) {
      if (version !== loadVersions.current.search) return;
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
      setSubjectRefreshVersion((version) => version + 1);
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
          const view = activeViewRef.current;
          if (view === 'today' || view === 'backlog') await refreshBacklogAndDashboard();
          else if (view === 'held') await refreshHeldAndPlanning();
          else {
            await load();
            if (view === 'calendar') await loadCalendar();
          }
          if (view === 'backlog') await refreshAnimeSearch();
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
  }, [isSyncing, load, loadCalendar, refreshAnimeSearch, refreshBacklogAndDashboard, refreshHeldAndPlanning, showError]);

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
    if (pendingAction === 'search' && submittedSearchKeyword.current === keyword) return;
    const version = ++loadVersions.current.search;
    submittedSearchKeyword.current = keyword;
    if (!keyword) {
      searchPending.current = false;
      setPendingAction(null);
      setAnimeSearch((current) => ({ ...current, error: null, resultKeyword: null, results: [] }));
      return;
    }
    searchPending.current = true;
    setPendingAction('search');
    setAnimeSearch((current) => ({ ...current, error: null }));
    try {
      const results = await searchAnime(keyword);
      if (version !== loadVersions.current.search) return;
      commitWithMotion(() => setAnimeSearch((current) => ({ ...current, error: null, resultKeyword: keyword, results })));
    } catch (error) {
      if (version !== loadVersions.current.search) return;
      setAnimeSearch((current) => ({
        ...current,
        resultKeyword: keyword,
        error: error instanceof Error ? error.message : String(error),
        results: []
      }));
    } finally {
      if (version === loadVersions.current.search) {
        searchPending.current = false;
        setPendingAction(null);
      }
    }
  }

  async function runAnimeCollectionAction(result: AnimeSearchResult, destination: SearchDestination) {
    if (searchPending.current || searchActions.current.has(result.id)) return;
    if (destination === 'backlog' && !result.watchAction) return;
    if (destination === 'wishlist' && !result.wishlistAction) return;
    searchActions.current.add(result.id);
    setPendingSearchIds(new Set(searchActions.current));
    const keyword = submittedSearchKeyword.current;
    loadVersions.current.search += 1;
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
      if (keyword === submittedSearchKeyword.current) {
        setAnimeSearch((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
          results: current.results.map((item) => item.id === result.id ? result : item)
        }));
      } else showError(error instanceof Error ? error.message : String(error));
    } finally {
      searchActions.current.delete(result.id);
      setPendingSearchIds(new Set(searchActions.current));
    }
  }

  async function saveOAuthSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction('oauth', () => saveOAuthConfig(oauthForm.clientId, oauthForm.clientSecret));
  }

  async function connectPersonalToken(accessToken: string) {
    if (isPending) return;
    await runAction('token', () => savePersonalAccessToken(accessToken));
  }

  async function startManualSync(full = false) {
    if (syncStartingRef.current || isSyncing) return;
    syncStartingRef.current = true;
    setSyncStarting(true);
    const requestVersion = ++syncRequestVersion.current;
    setSyncNotice(null);
    setState((current) => ({ ...current, error: null }));
    try {
      const status = await (full ? startFullSync() : startSync());
      if (syncRequestVersion.current === requestVersion) setSyncStatus(status);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      syncStartingRef.current = false;
      setSyncStarting(false);
    }
  }

  async function resolveFailedOperation(operationId: number, action: (id: number) => Promise<void>) {
    if (resolvingOperationId !== null) return;
    setResolvingOperationId(operationId);
    try {
      await action(operationId);
      await loadDashboardOnly();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setResolvingOperationId(null);
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
        onSaveToken={connectPersonalToken}
      />
    );
  }

  const pendingEpisodes = state.dashboard?.pendingEpisodes ?? [];
  const subjects = state.dashboard?.subjects ?? [];
  const accountLabel = state.auth?.authenticated ? state.auth.nickname || state.auth.username : '未连接';
  const syncTime = formatDateTime(state.dashboard?.lastSyncAt ?? state.auth?.lastSyncAt ?? null);
  const secondaryViewLabel = secondaryViewLabels[activeView];

  function selectView(view: ActiveView) {
    if (activeView !== view) {
      if (view === 'calendar' && calendarState.days) void loadCalendar();
      if (view === 'held' && heldState.data) void loadHeld();
      if ((view === 'today' || view === 'backlog') && backlogState.data) void refreshBacklogAndDashboard();
      if (view === 'backlog') void refreshAnimeSearch();
      if (view === 'watching') void loadDashboardOnly();
    }
    activeViewRef.current = view;
    setActiveView(view);
    if (moreOpen && secondaryViewLabels[view]) moreButtonRef.current?.focus();
    setMoreOpen(false);
  }

  return (
    <main className="app-shell hallmark-workbench layout-refresh">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true"><ListVideo /></span>
            <div><p>Bangumi Watch Planner</p><strong>{accountLabel}</strong></div>
          </div>
          <div className="topbar-stats" aria-live="polite">
            <span><MotionValue value={pendingEpisodes.length}>{pendingEpisodes.length} 集新番待看</MotionValue></span>
            <span><MotionValue value={subjects.length}>{subjects.length} 部追番</MotionValue></span>
          </div>
          <div className="topbar-actions">
            <div className="sync-stamp"><span>上次同步</span><time dateTime={state.dashboard?.lastSyncAt ?? state.auth?.lastSyncAt ?? undefined}>{syncTime}</time></div>
            <button
              type="button"
              onClick={() => void startManualSync()}
              disabled={isSyncing || syncStarting || !state.auth?.authenticated}
              aria-busy={isSyncing || syncStarting}
            >
              {isSyncing
                ? syncStatus.totalSubjects > 0
                  ? `同步中 ${syncStatus.processedSubjects}/${syncStatus.totalSubjects}`
                  : '同步中'
                : syncStarting ? '正在连接' : '立即同步'}
            </button>
          </div>
        </header>

      <aside className="app-sidebar" aria-label="应用导航">
        <div className="rail-brand" aria-hidden="true"><ListVideo /><span>Bangumi Planner</span></div>
        <div className={`page-tabs${moreOpen ? ' more-open' : ''}`} role="tablist" aria-label="视图" onKeyDown={(event) => {
          if (event.key === 'Escape' && moreOpen) {
            setMoreOpen(false);
            moreButtonRef.current?.focus();
          }
        }}>
          <Tab icon={CalendarCheck2} active={activeView === 'today'} onClick={() => selectView('today')}>今日</Tab>
          <Tab icon={TvMinimalPlay} active={activeView === 'watching'} onClick={() => selectView('watching')}>追番</Tab>
          <Tab icon={LibraryBig} active={activeView === 'backlog'} onClick={() => selectView('backlog')}>补番</Tab>
          <Tab buttonRef={firstMoreTabRef} icon={CirclePause} active={activeView === 'held'} onClick={() => selectView('held')}>搁置</Tab>
          <Tab icon={HeartPlus} active={activeView === 'wishlist'} onClick={() => selectView('wishlist')}>想看</Tab>
          <Tab icon={Telescope} active={activeView === 'upcoming'} onClick={() => selectView('upcoming')}>下季新番</Tab>
          <Tab icon={RadioTower} active={activeView === 'calendar'} onClick={() => selectView('calendar')}>每日放送</Tab>
        </div>
        <button ref={moreButtonRef} className="mobile-more" type="button" aria-expanded={moreOpen} aria-current={secondaryViewLabel ? 'page' : undefined} aria-label="更多页面" onClick={() => setMoreOpen(!moreOpen)}><MoreHorizontal aria-hidden="true" /><span>{secondaryViewLabel ?? '更多'}</span></button>

        <footer className="app-footer">
          <span>Bangumi Planner</span>
          <span>2026</span>
        </footer>
      </aside>

      <div className="app-content">
        {state.error ? <div className="notice error notice-dismissible" role="alert">
          <span>{state.error}</span>
          <button type="button" className="notice-close" aria-label="关闭错误提示" title="关闭错误提示" onClick={() => setState((current) => ({ ...current, error: null }))}><X size={16} /></button>
        </div> : null}
        {syncNotice ? <div className="notice" role="status">{syncNotice}</div> : null}
        {state.dashboard?.lastError && state.dashboard.lastError !== dismissedLastError ? <div className="notice warning notice-dismissible">
          <span>同步错误：{state.dashboard.lastError}</span>
          <button type="button" className="notice-close" aria-label="关闭同步错误" title="关闭同步错误" onClick={() => setDismissedLastError(state.dashboard?.lastError ?? null)}><X size={16} /></button>
        </div> : null}
        <div key={activeView} className="view-motion" data-view={activeView}>
          {activeView === 'today' ? (
            state.dashboard ? (
              <WatchingView
                mode="today"
                dashboard={state.dashboard}
                backlog={backlogState.data}
                backlogError={backlogState.error}
                onRetryBacklog={loadBacklog}
                disabled={isPending}
                refreshVersion={subjectRefreshVersion}
                onChanged={refreshBacklogAndDashboard}
                onError={showError}
                onOpenBacklog={() => selectView('backlog')}
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
                  refreshVersion={subjectRefreshVersion}
                  onChanged={refreshBacklogAndDashboard}
                  onError={showError}
                />
              ) : <div className="empty">正在加载追番。</div>}
              <SettingsPanel
                auth={state.auth}
                diagnostics={state.dashboard?.syncDiagnostics}
                disabled={isSyncing || syncStarting}
                onFullSync={() => startManualSync(true)}
              />
            </>
          ) : null}

          {activeView === 'backlog' ? (
            <>
              {backlogState.data && backlogState.error ? (
                <div className="notice error retryable" role="alert">
                  <span>刷新失败，正在显示上次的片库：{backlogState.error}</span>
                  <button type="button" className="secondary" disabled={backlogState.loading} onClick={() => void loadBacklog()}>重试</button>
                </div>
              ) : null}
              {backlogState.data ? (
                <BacklogView
                  data={backlogState.data}
                  disabled={isPending}
                  onChanged={refreshBacklogAndDashboard}
                  onError={showError}
                />
              ) : (
                <div className={backlogState.error ? 'empty retryable' : 'empty'}>
                  <span>{backlogState.error || '正在加载补番片库。'}</span>
                  {backlogState.error ? <button type="button" className="secondary" onClick={() => void loadBacklog()}>重试补番片库</button> : null}
                </div>
              )}
              <details className="add-anime-details" open>
                <summary>添加动画 <span>搜索 Bangumi 全站</span><ChevronDown size={16} aria-hidden="true" /></summary>
                <AnimeSearchPanel
                  authenticated={Boolean(state.auth?.authenticated)}
                  disabled={isPending}
                  search={animeSearch}
                  setSearch={setAnimeSearch}
                  pendingAction={pendingAction}
                  pendingIds={pendingSearchIds}
                  onSearch={runAnimeSearch}
                  onAction={runAnimeCollectionAction}
                />
              </details>
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

        {state.dashboard?.syncDiagnostics?.failedOperations.length ? (
          <details className="notice error operation-failures">
            <summary><strong>{state.dashboard.syncDiagnostics.failedOperations.length} 项操作失败</strong><span>查看并处理 <ChevronDown size={16} aria-hidden="true" /></span></summary>
            <div className="operation-failures-list">
              {state.dashboard.syncDiagnostics.failedOperations.map((operation) => (
                <div className="operation-failure" key={operation.id}>
                  <div><strong>操作 #{operation.id} 失败</strong><p>{operation.error}</p></div>
                  <div className="operation-failure-actions">
                    <button type="button" className="secondary" disabled={resolvingOperationId !== null} aria-busy={resolvingOperationId === operation.id} onClick={() => void resolveFailedOperation(operation.id, retryOperation)}>重试</button>
                    <button type="button" className="secondary" disabled={resolvingOperationId !== null} onClick={() => void resolveFailedOperation(operation.id, dismissFailedOperation)}>忽略记录</button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

      </div>
    </main>
  );
}

function Tab({ buttonRef, icon: Icon, active, onClick, children }: {
  buttonRef?: React.Ref<HTMLButtonElement>;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button ref={buttonRef} type="button" role="tab" aria-selected={active} onClick={onClick}>
      <span className="tab-mark" aria-hidden="true"><Icon /></span>
      <span className="tab-label">{children}</span>
    </button>
  );
}

type SearchState = { error: string | null; keyword: string; resultKeyword: string | null; results: AnimeSearchResult[] };

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
  onSaveOAuth,
  onSaveToken
}: {
  auth: AuthStatus;
  error: string | null;
  disabled: boolean;
  oauthForm: { clientId: string; clientSecret: string };
  setOauthForm: React.Dispatch<React.SetStateAction<{ clientId: string; clientSecret: string }>>;
  pendingAction: PendingAction | null;
  onSaveOAuth(event: React.FormEvent<HTMLFormElement>): Promise<void>;
  onSaveToken(accessToken: string): Promise<void>;
}) {
  const [personalToken, setPersonalToken] = useState('');
  return (
    <main className="bangumi-login-shell">
      <section className="panel bangumi-login-card" aria-label="Bangumi 登录">
        <header className="bangumi-login-header">
          <span className="bangumi-login-mark" aria-hidden="true">番</span>
          <div>
            <span className="panel-eyebrow">Bangumi Watch Planner</span>
            <h1>连接 Bangumi</h1>
          </div>
        </header>
        <p className="bangumi-login-description">
          获取个人令牌，粘贴后即可连接。
        </p>
        {error ? <p className="search-error" role="alert">{error}</p> : null}
        <a href="https://next.bgm.tv/demo/access-token" target="_blank" rel="noreferrer">获取个人令牌</a>
        <form className="oauth-form" onSubmit={(event) => {
          event.preventDefault();
          if (disabled || !personalToken.trim()) return;
          const accessToken = personalToken.trim();
          setPersonalToken('');
          void onSaveToken(accessToken);
        }}>
          <label>
            <span>个人令牌</span>
            <input type="password" autoComplete="off" placeholder="粘贴 Access Token" value={personalToken}
              disabled={disabled} onChange={(event) => setPersonalToken(event.target.value)} />
          </label>
          <button type="submit" disabled={disabled || !personalToken.trim()} aria-busy={pendingAction === 'token'}>
            {pendingAction === 'token' ? '正在连接' : '连接'}
          </button>
        </form>
        <details className="bangumi-login-options">
          <summary>使用 OAuth 登录</summary>
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
                  disabled={disabled}
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
                  disabled={disabled}
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
        </details>
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
  pendingIds,
  onSearch,
  onAction
}: {
  authenticated: boolean;
  disabled: boolean;
  search: SearchState;
  setSearch: React.Dispatch<React.SetStateAction<SearchState>>;
  pendingAction: PendingAction | null;
  pendingIds: Set<number>;
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
            disabled={!authenticated || disabled || pendingAction === 'search' || !search.keyword.trim()}
            aria-busy={pendingAction === 'search'}
          >
            {pendingAction === 'search' ? '搜索中' : '搜索'}
          </button>
        </form>
        {search.error ? <p className="search-error" role="alert">{search.error}</p> : null}
        {!search.error && pendingAction !== 'search' && search.resultKeyword !== null && search.results.length === 0 ? (
          <p className="empty" role="status">没有找到“{search.resultKeyword}”，试试其他名称。</p>
        ) : null}
        {search.results.length > 0 ? (
          <div className="search-results">
            {search.results.map((result, index) => (
              <article key={result.id} className="search-result motion-item" style={motionStyle(index, `search-result-${result.id}`)}>
                <a href={result.url} target="_blank" rel="noreferrer">
                  <CoverImage src={result.image} fallback={result.nameCn || result.name} />
                </a>
                <div>
                  <strong>{displaySubjectName(result.name, result.nameCn)}</strong>
                  <p>{result.eps ? `${result.eps} 集` : '总集数未知'}</p>
                </div>
                <div className="search-result-actions">
                  <button
                    type="button"
                    onClick={() => void onAction(result, 'backlog')}
                    disabled={!result.watchAction || disabled || pendingAction === 'search' || pendingIds.has(result.id)}
                    aria-busy={pendingIds.has(result.id)}
                  >
                    {result.watchActionLabel}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void onAction(result, 'wishlist')}
                    disabled={!result.wishlistAction || disabled || pendingAction === 'search' || pendingIds.has(result.id)}
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

function SettingsPanel({ auth, diagnostics, disabled, onFullSync }: {
  auth: AuthStatus;
  diagnostics?: SyncDiagnostics;
  disabled: boolean;
  onFullSync(): Promise<void>;
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
        <div><h2>设置</h2></div>
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
