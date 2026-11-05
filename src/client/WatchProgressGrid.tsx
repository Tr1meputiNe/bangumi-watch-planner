import type { EpisodeRow } from '../server/types.js';
import { displayEpisodeTitle, episodeProgress } from '../shared/format.js';
import { motionStyle } from './motion.js';
import { todayInShanghai } from '../shared/date.js';

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

export default function WatchProgressGrid({ subjectTitle, episodes, totalEpisodes, disabled, motionKey, onWatchedThrough, onWatched, onUnwatched }: Props) {
  const slots = buildProgressSlots(episodes, totalEpisodes);

  return (
    <div className="watch-progress-grid" aria-label={`${subjectTitle}集数进度`}>
      {slots.map(({ progress, episode }, index) => {
        const watched = episode?.collectionType === 2;
        const aired = episode ? hasAired(episode.airdate) : false;
        const state = !episode ? 'is-missing' : watched ? 'is-watched' : aired ? 'is-aired' : 'is-unaired';
        const episodeLabel = `${subjectTitle}${episode && episode.episodeType !== 0 ? ' 特别篇' : ''} 第 ${progress} 集`;
        return (
          <button
            key={episode?.id ?? `missing-${progress}`}
            type="button"
            className={['watch-episode-button', 'motion-item', state].join(' ')}
            style={motionStyle(index, `${motionKey}-${episode?.id ?? progress}`)}
            onClick={() => {
              if (!episode || disabled) return;
              // 保留原来的集数点击方式：本篇看到这里，特别篇单集记录。
              if (watched) onUnwatched(episode.id);
              else if (episode.episodeType === 0) onWatchedThrough(episode.id);
              else onWatched(episode.id);
            }}
            disabled={disabled || !episode}
            aria-label={`${episodeLabel} ${!episode ? '尚未同步' : watched ? '取消看过' : '标为看过'}`}
            aria-pressed={episode ? watched : undefined}
            title={!episode ? `第 ${progress} 集 · 尚未同步` : `${displayEpisodeTitle(episode.name, episode.nameCn, episode.sort)}${episode.airdate ? ` · ${episode.airdate}` : ''}`}
          >
            {episode && episode.episodeType !== 0 ? 'SP ' : ''}{formatEpisodeProgress(progress)}
          </button>
        );
      })}
    </div>
  );
}

function buildProgressSlots(episodes: EpisodeRow[], totalEpisodes: number) {
  const uniqueEpisodes = [...new Map(episodes.map((episode) => [episode.id, episode])).values()].sort(compareProgress);
  if (!Number.isFinite(totalEpisodes) || totalEpisodes <= 0) {
    return uniqueEpisodes.map((episode) => ({ progress: episodeProgress(episode), episode }));
  }
  const episodesByProgress = new Map<number, EpisodeRow>();
  for (const episode of uniqueEpisodes) {
    const progress = episodeProgress(episode);
    if (!Number.isInteger(progress) || progress <= 0 || progress > totalEpisodes) continue;
    const existing = episodesByProgress.get(progress);
    if (!existing || (existing.episodeType !== 0 && episode.episodeType === 0)) episodesByProgress.set(progress, episode);
  }
  const slottedIds = new Set([...episodesByProgress.values()].map((episode) => episode.id));
  const slots: Array<{ progress: number; episode: EpisodeRow | undefined }> = Array.from({ length: Math.floor(totalEpisodes) }, (_, index) => ({ progress: index + 1, episode: episodesByProgress.get(index + 1) }));
  for (const episode of uniqueEpisodes) {
    if (!slottedIds.has(episode.id)) slots.push({ progress: episodeProgress(episode), episode });
  }
  return slots.sort((a, b) => a.progress - b.progress || (a.episode?.episodeType ?? 0) - (b.episode?.episodeType ?? 0));
}

function compareProgress(a: EpisodeRow, b: EpisodeRow): number {
  return episodeProgress(a) - episodeProgress(b) || a.episodeType - b.episodeType || a.id - b.id;
}

function hasAired(airdate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(airdate) && airdate <= todayInShanghai();
}

function formatEpisodeProgress(progress: number): string {
  if (!Number.isFinite(progress)) return '?';
  return Number.isInteger(progress) ? String(progress).padStart(2, '0') : String(progress);
}
