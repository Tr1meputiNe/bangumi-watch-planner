import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { dismissReminder, getAuthStatus, getDashboard, markWatched, saveOAuthConfig, setApiToken, syncNow } from './api.js';
import type { AuthStatus, DashboardData, EpisodeRow } from '../server/types.js';
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

  async function runAction(action: () => Promise<void>) {
    startTransition(() => {
      void action()
        .then(load)
        .catch((error) => {
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
        });
    });
  }

  async function saveOAuthSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(() => saveOAuthConfig(oauthForm.clientId, oauthForm.clientSecret));
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="kicker">Bangumi Watch Planner</p>
          <h1>今晚要补哪几集，一眼看清。</h1>
        </div>
        <div className="sync-panel" aria-live="polite">
          <span>上次同步</span>
          <strong>{formatDateTime(state.dashboard?.lastSyncAt ?? state.auth?.lastSyncAt ?? null)}</strong>
          <button type="button" onClick={() => void runAction(syncNow)} disabled={isPending || !state.auth?.authenticated}>
            立即同步
          </button>
        </div>
      </header>

      {state.error ? <div className="notice error">{state.error}</div> : null}
      {state.dashboard?.lastError ? <div className="notice warning">同步错误：{state.dashboard.lastError}</div> : null}

      <section className="workbench" aria-label="待补新集">
        <div className="section-heading">
          <h2>待补新集</h2>
          <span>{pendingEpisodes.length} 集</span>
        </div>

        {pendingEpisodes.length > 0 ? (
          <div className="episode-list">
            {pendingEpisodes.map((episode) => (
              <EpisodeItem
                key={episode.id}
                episode={episode}
                disabled={isPending}
                onWatched={() => runAction(() => markWatched(episode.id))}
                onDismiss={() => runAction(() => dismissReminder(episode.id))}
              />
            ))}
          </div>
        ) : (
          <div className="empty">没有已播出且未看的本篇集数。</div>
        )}
      </section>

      <section className="library" aria-label="在看动画">
        <div className="section-heading">
          <h2>在看动画</h2>
          <span>{subjects.length} 部</span>
        </div>
        <div className="subject-grid">
          {subjects.map((subject) => (
            <article key={subject.id} className="subject-tile">
              <div className="cover">{subject.image ? <img src={subject.image} alt="" /> : <span>{subject.nameCn || subject.name}</span>}</div>
              <div className="subject-copy">
                <h3>{displaySubjectName(subject.name, subject.nameCn)}</h3>
                <p>
                  进度 {subject.epStatus} / {subject.eps || '?'}
                </p>
                <p>{pendingBySubject.get(subject.id) ?? 0} 集待补</p>
                {subject.nextEpisode ? <small>下一集：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)}</small> : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="settings" aria-label="设置">
        <div className="section-heading">
          <h2>设置</h2>
          <span>{state.auth?.authenticated ? state.auth.username : '未连接'}</span>
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
            <p>每日 20:00 检查新集；浏览器关闭时由本机服务发送 macOS 通知。</p>
          </div>
          <span className="status-pill">{state.auth?.launchAgentInstalled ? '已安装' : '未安装'}</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>通知</strong>
            <p>同一天只发送一次汇总通知，忽略的集数不会再提醒。</p>
          </div>
          <span className="status-pill">{state.auth?.notificationsEnabled === false ? '已关闭' : '已开启'}</span>
        </div>
      </section>
    </main>
  );
}

function EpisodeItem({
  episode,
  disabled,
  onWatched,
  onDismiss
}: {
  episode: EpisodeRow;
  disabled: boolean;
  onWatched: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className="episode-row">
      <div className="episode-date">
        <span>{episode.airdate.slice(5) || '--'}</span>
        <small>第 {episode.sort} 集</small>
      </div>
      <div className="episode-main">
        <h3>{displaySubjectName(episode.subjectName, episode.subjectNameCn)}</h3>
        <p>{displayEpisodeTitle(episode.name, episode.nameCn, episode.sort)}</p>
        <a href={episode.subjectUrl} target="_blank" rel="noreferrer">
          打开 Bangumi
        </a>
      </div>
      <div className="episode-actions">
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
