import type { EpisodeRow } from './types.js';

export type BacklogQueue = {
  subjectId: number;
  episodes: EpisodeRow[];
};

export type BacklogPlannerInput = {
  today: string;
  throughDate: string;
  seasonalLoadByDate: Map<string, number>;
  subjects: BacklogQueue[];
  fixedTasks: Array<{ episodeId: number; subjectId: number; plannedDate: string; slot: number; locked: true }>;
  skippedDates: Set<string>;
  exclusions: Map<string, Set<number>>;
  rotationCursorSubjectId: number | null;
};

export type BacklogPlannerOutput = {
  tasks: Array<{ episodeId: number; subjectId: number; plannedDate: string; slot: number; locked: boolean }>;
  days: Array<{ date: string; seasonalLoad: number; capacity: number; tasks: Array<{ episodeId: number; subjectId: number }> }>;
  rotationCursorSubjectId: number | null;
};

type PlannerTask = BacklogPlannerOutput['tasks'][number];

export function capacityForSeasonalLoad(load: number): number {
  if (load <= 1) return 2;
  if (load <= 4) return 1;
  return 0;
}

export function countSeasonalLoad(episodes: EpisodeRow[], date: string): number {
  return episodes.filter((episode) => episode.airdate === date && episode.episodeType === 0).length;
}

export function buildBacklogPlan(input: BacklogPlannerInput): BacklogPlannerOutput {
  const dates = dateRange(input.today, input.throughDate);
  const dateSet = new Set(dates);
  const fixedTasks = input.fixedTasks
    .filter((task) => dateSet.has(task.plannedDate))
    .map((task) => ({ ...task }));
  const fixedEpisodeIds = new Set(fixedTasks.map((task) => task.episodeId));
  const queues = rotateQueues(
    input.subjects.map((subject) => ({
      subjectId: subject.subjectId,
      episodes: subject.episodes
        .filter((episode) => episode.episodeType === 0 && episode.collectionType !== 2 && !fixedEpisodeIds.has(episode.id))
        .slice()
        .sort(compareEpisodes)
    })),
    input.rotationCursorSubjectId
  );
  const tasks: PlannerTask[] = [];
  const days: BacklogPlannerOutput['days'] = [];
  let cursor = input.rotationCursorSubjectId;

  for (const date of dates) {
    const seasonalLoad = input.seasonalLoadByDate.get(date) ?? 0;
    const capacity = capacityForSeasonalLoad(seasonalLoad);
    const fixedForDate = fixedTasks.filter((task) => task.plannedDate === date).sort((a, b) => a.slot - b.slot);
    const dayTasks: PlannerTask[] = fixedForDate.map((task) => ({ ...task }));
    const occupiedSlots = new Set(fixedForDate.map((task) => task.slot));
    const freeSlots = availableSlots(Math.max(0, capacity - fixedForDate.length), occupiedSlots);

    if (!input.skippedDates.has(date)) {
      const contributed = new Set(fixedForDate.map((task) => task.subjectId));
      const excludedEpisodeIds = input.exclusions.get(date) ?? new Set<number>();

      while (freeSlots.length > 0) {
        const eligible = queues.filter((queue) => {
          const episode = queue.episodes[0];
          return episode && !excludedEpisodeIds.has(episode.id);
        });
        const queue = eligible.find((item) => !contributed.has(item.subjectId)) ?? eligible[0];
        if (!queue) break;

        const episode = queue.episodes.shift();
        if (!episode) break;
        const slot = freeSlots.shift();
        if (slot === undefined) break;

        dayTasks.push({ episodeId: episode.id, subjectId: queue.subjectId, plannedDate: date, slot, locked: false });
        contributed.add(queue.subjectId);
        cursor = queue.subjectId;
        queues.splice(queues.indexOf(queue), 1);
        queues.push(queue);
      }
    }

    dayTasks.sort((a, b) => a.slot - b.slot);
    tasks.push(...dayTasks);
    days.push({
      date,
      seasonalLoad,
      capacity,
      tasks: dayTasks.map(({ episodeId, subjectId }) => ({ episodeId, subjectId }))
    });
  }

  return { tasks, days, rotationCursorSubjectId: cursor };
}

export function estimateBacklogCompletionDate(today: string, remainingEpisodeCount: number, weeklySeasonalLoads: number[]): string | null {
  if (remainingEpisodeCount <= 0) return null;
  const capacities = Array.from({ length: 7 }, (_, index) => capacityForSeasonalLoad(weeklySeasonalLoads[index] ?? 0));
  if (capacities.every((capacity) => capacity === 0)) return null;

  let remaining = remainingEpisodeCount;
  for (let offset = 0; offset < 1826; offset += 1) {
    remaining -= capacities[(shanghaiWeekdayIndex(today) + offset) % 7];
    if (remaining <= 0) return addDays(today, offset);
  }
  return null;
}

function compareEpisodes(a: EpisodeRow, b: EpisodeRow): number {
  const byProgress = Number(a.ep ?? a.sort) - Number(b.ep ?? b.sort);
  return byProgress || a.id - b.id;
}

function rotateQueues(queues: BacklogQueue[], cursorSubjectId: number | null): BacklogQueue[] {
  const cursorIndex = queues.findIndex((queue) => queue.subjectId === cursorSubjectId);
  if (cursorIndex < 0) return queues;
  return [...queues.slice(cursorIndex + 1), ...queues.slice(0, cursorIndex + 1)];
}

function availableSlots(count: number, occupiedSlots: Set<number>): number[] {
  const slots: number[] = [];
  for (let slot = 0; slots.length < count; slot += 1) {
    if (!occupiedSlots.has(slot)) slots.push(slot);
  }
  return slots;
}

function dateRange(from: string, through: string): string[] {
  const dates: string[] = [];
  for (let offset = 0, date = from; date <= through; offset += 1, date = addDays(from, offset)) dates.push(date);
  return dates;
}

function addDays(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return value.toISOString().slice(0, 10);
}

function shanghaiWeekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
