import type { EpisodeRow } from '../server/types.js';
import { displayEpisodeTitle, episodeProgress } from '../shared/format.js';
import { motionStyle } from './motion.js';

type Props = {
  subjectTitle: string;
  episodes: EpisodeRow[];
  totalEpisodes: number;
  disabled: boolean;
  motionKey: string;
  onWatchedThrough(episodeId: number): void;
  onWatched(episodeId: number): void;
  onUnwatched(episodeId: number): void;
};

export default function WatchProgressGrid({
  subjectTitle,
  episodes,
  totalEpisodes,
  disabled,
  motionKey,
  onWatchedThrough,
  onWatched,
  onUnwatched
}: Props) {
  const slots = buildProgressSlots(episodes, totalEpisodes);
  return (
    <div className="watch-progress-grid" aria-label={`${subjectTitle}集数进度`}>
      {slots.map(({ progress, episode }, index) => {
        const watched = episode?.collectionType === 2;
        const aired = episode ? hasAired(episode.airdate) : false;
        const state = !episode ? 'is-missing' : watched ? 'is-watched' : aired ? 'is-aired' : 'is-unaired';
        return (
          <button
            key={episode?.id ?? `missing-${progress}`}
            type="button"
            className={['watch-episode-button', 'motion-item', state].join(' ')}
            style={motionStyle(index, `${motionKey}-${episode?.id ?? progress}`)}
            onClick={() => {
              if (!episode) return;
              if (watched) onUnwatched(episode.id);
              else if (episode.episodeType === 0) onWatchedThrough(episode.id);
              else onWatched(episode.id);
            }}
            disabled={disabled || !episode}
            aria-label={!episode
              ? `${subjectTitle} 第 ${progress} 集 尚未同步`
              : watched
                ? `${subjectTitle} 第 ${progress} 集 取消看过`
                : `${subjectTitle} 第 ${progress} 集 标为看过`}
            title={!episode
              ? `第 ${progress} 集 · 尚未同步`
              : `${displayEpisodeTitle(episode.name, episode.nameCn, episode.sort)}${episode.airdate ? ` · ${episode.airdate}` : ''}`}
          >
            {formatEpisodeProgress(progress)}
          </button>
        );
      })}
    </div>
  );
}

function buildProgressSlots(episodes: EpisodeRow[], totalEpisodes: number) {
  if (totalEpisodes <= 0) {
    return episodes.map((episode) => ({ progress: episodeProgress(episode), episode }));
  }
  const episodesByProgress = new Map(
    episodes
      .map((episode) => [episodeProgress(episode), episode] as const)
      .filter(([progress]) => Number.isInteger(progress) && progress > 0 && progress <= totalEpisodes)
  );
  return Array.from({ length: totalEpisodes }, (_, index) => ({
    progress: index + 1,
    episode: episodesByProgress.get(index + 1) ?? null
  }));
}

function hasAired(airdate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(airdate) && airdate <= todayInShanghai();
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatEpisodeProgress(progress: number): string {
  if (!Number.isFinite(progress)) return '?';
  return Number.isInteger(progress) ? String(progress).padStart(2, '0') : String(progress);
}
