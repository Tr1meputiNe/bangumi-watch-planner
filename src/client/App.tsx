import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  addSubjectToWatching,
  dismissReminder,
  getAuthStatus,
  getDashboard,
  markWatched,
  markWatchedThrough,
  saveOAuthConfig,
  searchAnime,
  setApiToken,
  syncNow
} from './api.js';
import type { AnimeSearchResult, AuthStatus, DashboardData, DashboardSubject, EpisodeRow } from '../server/types.js';
import { displayEpisodeTitle, displaySubjectName, formatDateTime } from '../shared/format.js';

type LoadState = {
  auth: AuthStatus | null;
  dashboard: DashboardData | null;
  error: string | null;
};

const emptyState: LoadState = { auth: null, dashboard: null, error: null };

export default function App() {
  const [state, setState] = useState<LoadState>(emptyState);
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
      setApiToken(auth.apiToken);
      setState({ auth, dashboard, error: null });
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
                  onWatched={() => runAction(() => markWatched(episode.id))}
                  onWatchedThrough={() => runAction(() => markWatchedThrough(episode.subjectId, episode.id))}
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
                <SubjectItem key={subject.id} subject={subject} pendingCount={pendingBySubject.get(subject.id) ?? 0} />
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
    </main>
  );
}

function SubjectItem({ subject, pendingCount }: { subject: DashboardSubject; pendingCount: number }) {
  const progressText = `${subject.epStatus} / ${subject.eps || '?'}`;
  const progressPercent = subject.eps > 0 ? Math.min(100, Math.round((subject.epStatus / subject.eps) * 100)) : 0;
  const unwatchedCount = subject.unwatchedMainEpisodeCount ?? pendingCount;
  return (
    <article className="subject-row">
      <a className="subject-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={displaySubjectName(subject.name, subject.nameCn)}>
        {subject.image ? <img src={subject.image} alt="" /> : <span>{subject.nameCn || subject.name}</span>}
      </a>
      <div className="subject-detail">
        <div className="subject-heading">
          <a href={subject.url} target="_blank" rel="noreferrer">
            {displaySubjectName(subject.name, subject.nameCn)}
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
          <p>最近未看：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)}</p>
        ) : (
          <p>暂无未看的本篇集数</p>
        )}
      </div>
    </article>
  );
}

function EpisodeItem({
  episode,
  disabled,
  onWatched,
  onWatchedThrough,
  onDismiss
}: {
  episode: EpisodeRow;
  disabled: boolean;
  onWatched: () => void;
  onWatchedThrough: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className="episode-row">
      <div className="episode-index">
        <span>{episode.airdate.slice(5) || '--'}</span>
        <strong>第 {episode.sort} 集</strong>
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
        <button type="button" className="secondary" onClick={onWatchedThrough} disabled={disabled}>
          看到这里
        </button>
        <button type="button" onClick={onWatched} disabled={disabled}>
          标记看过
        </button>
        <button type="button" className="ghost" onClick={onDismiss} disabled={disabled}>
          忽略
        </button>
      </div>
    </article>
  );
}
