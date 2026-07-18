# Bangumi Backlog Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate backlog planner and Bangumi wishlist to the existing local app, automatically classify seasonal versus older watching anime, and generate a fair seven-day viewing plan without mixing backlog titles into the seasonal reminder view.

**Architecture:** Keep Bangumi as the source of truth for collection and episode status, while SQLite stores classification, season metadata, generated backlog tasks, and day-specific planner overrides. Parse the current and previous ACG Secrets quarter pages into one normalized `SeasonWindow`, then feed only normalized dates and repository rows into a pure round-robin planner. The Fastify service owns remote writes and replanning transactions; React consumes three focused read models (`DashboardData`, `BacklogData`, and `WishlistData`) plus the existing calendar.

**Tech Stack:** Node.js 24, TypeScript 5.9, Fastify 5, React 19, Vite 7, SQLite via `better-sqlite3`, Vitest 4, Testing Library, `node-cron`, macOS `osascript` notifications.

## Global Constraints

- Use `Asia/Shanghai` for every date boundary, reminder, season-window, and plan calculation.
- Keep the top-level navigation in this exact order: `追番提醒`, `补番计划`, `想看`, `每日放送`.
- Seasonal watching anime and backlog anime must never be mixed in the same list.
- A Bangumi collection with type `3` is seasonal only when its subject is in the active `SeasonWindow`; other type `3` anime enter the backlog automatically.
- Bangumi type `1` entries stay wishlist-only until the user explicitly starts them. Starting a current-season title sets type `3` and enters seasonal watching; starting an older title sets type `3` and enters backlog.
- Pausing or cancelling a backlog title sets Bangumi type `4` (`搁置`) and preserves episode progress; resuming sets type `3` and returns it to backlog.
- Completing all main episodes automatically sets Bangumi type `2` only when the API supplied a positive total, the fetched main-episode count reaches that total, and every fetched main episode is watched.
- SP, OVA, OP, ED, and every episode whose `episode.type !== 0` do not consume backlog slots and do not participate in automatic completion.
- Unknown totals never auto-complete. Expose a manual completion action for them.
- Count only the user's seasonal anime episodes that newly air on each plan date. Do not count the whole public timetable or historical unwatched accumulation.
- Normalize broadcasts at `25:00` or later to the following Shanghai calendar date before calculating daily load. A known date with an unknown time still counts on that date.
- Daily backlog capacity is exact: seasonal load `0-1` gives `2` backlog episodes, load `2-4` gives `1`, and load above `4` gives `0`.
- Schedule multiple backlog titles in fair round-robin order. When a date has two slots and at least two eligible titles, use two different titles.
- Keep today's generated tasks locked during automatic replanning. Rebuild tomorrow through the following six dates. Only the explicit `重新规划今天` action may replace today's tasks.
- An unfinished past task does not become overdue. Return its episode to the queue and place it in the next eligible plan.
- Support `换一部`, `今天跳过`, and `重新规划今天` without permanently discarding episode progress.
- Do not infer viewing habits or assign hard deadlines. Show only a dynamically calculated estimated completion date.
- The backlog queue starts at each title's first unwatched main episode after its existing Bangumi progress.
- Determine the new-quarter anchor from the earliest `anime-type-new` normal premiere on ACG Secrets. Ignore advance screenings, advance streams, and previews.
- Keep old and new quarter schedules active together for 14 natural days beginning on the anchor date. On day 15, a still-watching title absent from the new schedule becomes backlog. `anime-type-continue` titles stay seasonal.
- If no valid normal premiere can be parsed, use the first day of the quarter's first month as the anchor.
- Fetch and store Bangumi type `1`, `3`, and `4` collections. Keep locally managed type `2` subjects so the backlog completed section survives later syncs.
- Wishlist filtering must support a name query plus `全部年份`, each known year, and `年份未知`.
- Keep the existing daily `20:00` single-summary notification and daily deduplication. Its body has `今日新番待看` and, only when non-empty, `今日补番计划`.
- Preserve existing OAuth, LAN access, local API-token protection, watched/unwatched actions, calendar, notification setting, and LaunchAgent behavior.
- Never persist or commit the user's Bangumi password, OAuth client secret, access token, refresh token, or local API token. Continue to use Keychain/settings behavior already present.
- Do not add a new runtime dependency for season parsing or scheduling; keep the implementation in focused TypeScript modules and use existing test infrastructure.

---

## File Map

- Modify `src/server/types.ts`: shared collection, season, backlog, wishlist, task, service, and client contracts.
- Modify `src/server/db.ts`: additive SQLite migration and repository operations for classification, tasks, skips, exclusions, and filtered read models.
- Modify `src/server/bangumi-client.ts`: generic paginated collection reads and collection-type writes.
- Modify `src/server/broadcast-schedule.ts`: retain broadcast-time fallbacks while exposing normalized ACG quarter entries.
- Create `src/server/season-window.ts`: quarter arithmetic, 14-day overlap, active-subject classification, and fallback anchor.
- Create `src/server/backlog-planner.ts`: pure daily-capacity, fair rotation, locked-task, and completion-estimate logic.
- Modify `src/server/sync.ts`: synchronize types `1/3/4`, classify rows, preserve local completed rows, and trigger future replanning.
- Modify `src/server/dashboard.ts`: orchestrate collection changes, episode progress, safe auto-completion, and planner actions.
- Modify `src/server/reminders.ts`: separate seasonal and backlog notification sections.
- Modify `src/server/scheduler.ts`: sync, plan, and send one combined daily notification.
- Modify `src/server/app.ts`: expose backlog, wishlist, start, pause, resume, complete, swap, skip, and replan routes.
- Modify `src/server/index.ts`: pass the clock and planner dependencies through the composition root.
- Modify `src/client/api.ts`: typed client calls for the new read models and actions.
- Modify `src/client/App.tsx`: four-view shell, shared refresh behavior, and settings placement.
- Create `src/client/views/WatchingView.tsx`: seasonal pending and watched/unwatched controls.
- Create `src/client/views/BacklogView.tsx`: today, seven-day plan, active, held, and completed sections.
- Create `src/client/views/WishlistView.tsx`: name/year filters and context-sensitive start actions.
- Create `src/client/views/CalendarView.tsx`: move the existing calendar panel without changing behavior.
- Modify `src/client/styles.css`: stable responsive layouts for the four views and planner controls.
- Modify existing server/client tests and create focused tests listed in each task.
- Modify `README.md`: explain classification, season overlap, planner rules, controls, and verification.

### Task 1: Extend Domain Types and SQLite Repository

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/db.ts`
- Modify: `tests/server/db.test.ts`

**Interfaces:**
- Consumes: existing `SubjectRow`, `EpisodeRow`, `DashboardSubject`, and `Repository` behavior.
- Produces: `BangumiCollectionType`, `PlannerMode`, `SeasonKind`, `BacklogTaskRow`, `BacklogData`, `WishlistData`, and the repository methods used by Tasks 4-9.

- [ ] **Step 1: Add failing migration and repository tests**

Add cases that open a database created with the old schema, run `createRepository`, and prove that existing subjects receive safe defaults. Add a second case that stores seasonal, backlog, held, wishlist, and completed rows and verifies filtered reads. Add a third case for atomic task replacement, locked-today preservation, skipped days, and date/episode exclusions.

```ts
it('migrates old subjects without losing progress', async () => {
  const repository = createRepository(dbPath);
  const subject = await repository.getSubject(1);
  expect(subject).toMatchObject({
    id: 1,
    collectionType: 3,
    plannerMode: 'seasonal',
    seasonKey: null,
    seasonKind: null,
    airYear: null,
    totalEpisodesKnown: false,
    completedAt: null
  });
});

it('replaces only unlocked tasks in the requested range', async () => {
  await repository.replaceBacklogTasks({
    fromDate: '2026-07-20',
    throughDate: '2026-07-25',
    preserveLocked: true,
    tasks: [task({ episodeId: 21, plannedDate: '2026-07-20', slot: 0, locked: false })]
  });
  expect(await repository.listBacklogTasks('2026-07-19', '2026-07-25')).toEqual([
    expect.objectContaining({ episodeId: 11, plannedDate: '2026-07-19', locked: true }),
    expect.objectContaining({ episodeId: 21, plannedDate: '2026-07-20', locked: false })
  ]);
});

it('stores planner overrides by Shanghai date', async () => {
  await repository.skipBacklogDate('2026-07-19');
  await repository.excludeEpisodeOnDate('2026-07-20', 21);
  expect(await repository.listSkippedBacklogDates('2026-07-19', '2026-07-25')).toEqual(['2026-07-19']);
  expect(await repository.listBacklogExclusions('2026-07-19', '2026-07-25')).toEqual([
    { plannedDate: '2026-07-20', episodeId: 21 }
  ]);
});
```

- [ ] **Step 2: Run the focused test and confirm the new contract is missing**

Run: `npm test -- tests/server/db.test.ts`

Expected: FAIL with TypeScript/runtime errors for `getSubject`, `replaceBacklogTasks`, and planner override methods.

- [ ] **Step 3: Add exact shared domain types**

Extend `SubjectRow` and add these contracts in `src/server/types.ts`:

```ts
export type BangumiCollectionType = 1 | 2 | 3 | 4 | 5;
export type PlannerMode = 'seasonal' | 'backlog' | null;
export type SeasonKind = 'new' | 'continuing';

export type SubjectRow = {
  id: number;
  name: string;
  nameCn: string;
  eps: number;
  epStatus: number;
  image: string | null;
  url: string;
  collectionType: BangumiCollectionType;
  plannerMode: PlannerMode;
  seasonKey: string | null;
  seasonKind: SeasonKind | null;
  airYear: number | null;
  totalEpisodesKnown: boolean;
  completedAt: string | null;
};

export type BacklogTaskRow = {
  id: number;
  episodeId: number;
  subjectId: number;
  plannedDate: string;
  slot: number;
  locked: boolean;
  episode: EpisodeRow;
};

export type BacklogData = {
  today: string;
  todayTasks: BacklogTaskRow[];
  futureDays: Array<{ date: string; seasonalLoad: number; capacity: number; tasks: BacklogTaskRow[] }>;
  active: DashboardSubject[];
  held: DashboardSubject[];
  completed: DashboardSubject[];
  estimatedCompletionDate: string | null;
};

export type WishlistData = {
  items: Array<SubjectRow & { isCurrentSeason: boolean }>;
  years: number[];
};
```

Existing rows receive `seasonal` during migration. New wishlist rows store `plannerMode: null`, and every seasonal/backlog query must also filter collection types so wishlist rows cannot enter either watching list.

- [ ] **Step 4: Add the additive SQLite migration and repository methods**

Add columns with `addColumnIfMissing` and create planner tables. Use integer `0/1` conversion for booleans at the repository boundary.

```sql
alter table subjects add column collection_type integer not null default 3;
alter table subjects add column planner_mode text default 'seasonal';
alter table subjects add column season_key text;
alter table subjects add column season_kind text;
alter table subjects add column air_year integer;
alter table subjects add column total_episodes_known integer not null default 0;
alter table subjects add column completed_at text;

create table if not exists backlog_tasks (
  id integer primary key autoincrement,
  episode_id integer not null unique,
  subject_id integer not null,
  planned_date text not null,
  slot integer not null,
  locked integer not null default 0,
  created_at text not null,
  foreign key(episode_id) references episodes(id) on delete cascade,
  foreign key(subject_id) references subjects(id) on delete cascade,
  unique(planned_date, slot)
);

create table if not exists backlog_skipped_days (
  planned_date text primary key,
  created_at text not null
);

create table if not exists backlog_exclusions (
  planned_date text not null,
  episode_id integer not null,
  created_at text not null,
  primary key(planned_date, episode_id),
  foreign key(episode_id) references episodes(id) on delete cascade
);
```

Expose these exact repository signatures:

```ts
getSubject(subjectId: number): Promise<SubjectRow | null>;
listSubjectsByCollection(types: BangumiCollectionType[]): Promise<DashboardSubject[]>;
listSubjectsByMode(mode: Exclude<PlannerMode, null>, types: BangumiCollectionType[]): Promise<DashboardSubject[]>;
setSubjectState(subjectId: number, state: Pick<SubjectRow, 'collectionType' | 'plannerMode' | 'completedAt'>): Promise<void>;
listWishlist(query: string, year: number | null | 'unknown'): Promise<WishlistData>;
listBacklogTasks(fromDate: string, throughDate: string): Promise<BacklogTaskRow[]>;
replaceBacklogTasks(input: { fromDate: string; throughDate: string; preserveLocked: boolean; tasks: Array<Omit<BacklogTaskRow, 'id' | 'episode'>> }): Promise<void>;
deleteBacklogTask(episodeId: number): Promise<void>;
lockBacklogDate(date: string): Promise<void>;
skipBacklogDate(date: string): Promise<void>;
clearBacklogDateOverrides(date: string): Promise<void>;
excludeEpisodeOnDate(date: string, episodeId: number): Promise<void>;
listSkippedBacklogDates(fromDate: string, throughDate: string): Promise<string[]>;
listBacklogExclusions(fromDate: string, throughDate: string): Promise<Array<{ plannedDate: string; episodeId: number }>>;
prunePlannerState(beforeDate: string): Promise<void>;
```

`replaceBacklogTasks` must run one transaction: delete unlocked tasks in range, insert the supplied rows, and leave rows with `locked = 1` untouched when `preserveLocked` is true. `listWishlist` must filter with `coalesce(nullif(name_cn, ''), name)` and return descending unique years from all wishlist rows, not just the filtered result.

- [ ] **Step 5: Run repository and full server type checks**

Run: `npm test -- tests/server/db.test.ts && npx tsc -p tsconfig.server.json --noEmit`

Expected: PASS for `tests/server/db.test.ts`; TypeScript exits `0`.

- [ ] **Step 6: Commit the domain and migration change**

```bash
git add src/server/types.ts src/server/db.ts tests/server/db.test.ts
git commit -m "feat: add backlog planner storage"
```

### Task 2: Generalize Bangumi Collection Reads and Writes

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/bangumi-client.ts`
- Modify: `tests/server/bangumi-client.test.ts`

**Interfaces:**
- Consumes: `BangumiCollectionType` from Task 1 and existing authenticated request/retry behavior.
- Produces: `getAnimeCollections(username, type, limit, offset)` and `setSubjectCollectionType(subjectId, type)` for Tasks 5-6.

- [ ] **Step 1: Add failing client request-shape tests**

```ts
it.each([1, 3, 4] as const)('loads anime collection type %s with pagination', async (type) => {
  const client = createBangumiClient(deps(fetchMock));
  await client.getAnimeCollections('sai', type, 50, 100);
  expect(fetchMock).toHaveBeenCalledWith(
    `https://api.bgm.tv/v0/users/sai/collections?subject_type=2&type=${type}&limit=50&offset=100`,
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) })
  );
});

it.each([2, 3, 4] as const)('writes collection type %s with PATCH', async (type) => {
  const client = createBangumiClient(deps(fetchMock));
  await client.setSubjectCollectionType(456, type);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.bgm.tv/v0/users/-/collections/456',
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ type }) })
  );
});
```

Also assert that `BangumiSubjectCollection.subject.date` maps through untouched and that the existing episode PATCH bodies remain `{ episode_id: [id], type: 2 }` and `{ episode_id: [id], type: 0 }`.

- [ ] **Step 2: Run the focused test and verify the methods are absent**

Run: `npm test -- tests/server/bangumi-client.test.ts`

Expected: FAIL because `getAnimeCollections` and `setSubjectCollectionType` are not defined.

- [ ] **Step 3: Replace the watching-only contract with a generic collection contract**

```ts
export type BangumiClient = {
  getMe(): Promise<BangumiUser>;
  getCalendar(): Promise<CalendarDay[]>;
  getAnimeCollections(username: string, type: 1 | 3 | 4, limit: number, offset: number): Promise<BangumiCollectionPage>;
  getSubjectEpisodes(subjectId: number, limit?: number, offset?: number): Promise<BangumiEpisodePage>;
  getBroadcastCatalog?(): Promise<BroadcastCatalog>;
  markEpisodesWatched(subjectId: number, episodeIds: number[]): Promise<void>;
  markEpisodesUnwatched(subjectId: number, episodeIds: number[]): Promise<void>;
  setSubjectCollectionType(subjectId: number, type: 2 | 3 | 4): Promise<void>;
  searchAnimeSubjects(keyword: string): Promise<AnimeSearchResult[]>;
};
```

Add `date?: string` to `BangumiSubjectCollection.subject`. Delete `getWatchingAnime` and `addSubjectToWatching` only after all tests and call sites in later tasks have moved to the generic methods.

- [ ] **Step 4: Implement exact query and PATCH behavior**

```ts
getAnimeCollections(username, type, limit, offset) {
  const params = new URLSearchParams({
    subject_type: '2',
    type: String(type),
    limit: String(limit),
    offset: String(offset)
  });
  return request<BangumiCollectionPage>(`/v0/users/${encodeURIComponent(username)}/collections?${params}`);
},

async setSubjectCollectionType(subjectId, type) {
  await request<void>(`/v0/users/-/collections/${subjectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type })
  });
}
```

Do not add password-based login or expose OAuth secrets to the browser.

- [ ] **Step 5: Run client tests**

Run: `npm test -- tests/server/bangumi-client.test.ts`

Expected: PASS, including retry, calendar, collection, episode-write, and search cases.

- [ ] **Step 6: Commit the API client change**

```bash
git add src/server/types.ts src/server/bangumi-client.ts tests/server/bangumi-client.test.ts
git commit -m "feat: support Bangumi collection states"
```

### Task 3: Parse Quarter Metadata and Build the 14-Day Season Window

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/broadcast-schedule.ts`
- Create: `src/server/season-window.ts`
- Modify: `tests/server/broadcast-schedule.test.ts`
- Create: `tests/server/season-window.test.ts`

**Interfaces:**
- Consumes: ACG Secrets card attributes and existing fallback schedule sources.
- Produces: `BroadcastCatalog`, `SeasonEntry`, `SeasonWindow`, and `buildSeasonWindow(today, current, previous)` for Tasks 4-6.

- [ ] **Step 1: Add failing parser tests with new, continuing, and 25:00 cards**

Use minimal HTML cards with matching detail blocks and assert all normalized fields.

```ts
const html = `
  <div class="CV-search acgs-card anime-type-new" acgs-bangumi-data-id="anime-1"
    onairtime="1783177200000" weektoday="六" weektomorrow="日" datetoday="7月4日" weekairtime="00000"></div>
  <div class="CV-search acgs-card anime-type-continue" acgs-bangumi-data-id="anime-2"
    onairtime="1784298600000" weektoday="五" weektomorrow="五" datetoday="7月17日" weekairtime="52330"></div>
  <div acgs-bangumi-anime-id="anime-1"><a href="https://bangumi.tv/subject/101">Bangumi</a></div>
  <div acgs-bangumi-anime-id="anime-2"><a href="https://bangumi.tv/subject/202">Bangumi</a></div>
`;

expect(parseAcgSecretsSeason(html, '2026Q3').entries.get(101)).toEqual({
  subjectId: 101,
  seasonKey: '2026Q3',
  seasonKind: 'new',
  normalPremiereDate: '2026-07-05',
  airTime: '00:00',
  dayOffset: 1
});
```

Retain the existing assertions for `花枝和才女的侍从`, `猫与龙`, late-night index entries, ACG override precedence, and one-week episode offset. The new parser test must prove that `weektoday` versus the timestamp's Shanghai weekday, not string arithmetic on `weekairtime`, determines `dayOffset`.

- [ ] **Step 2: Add failing season-window boundary tests**

```ts
it('keeps old and new quarters for fourteen natural days', () => {
  const current = catalog('2026Q3', [entry(101, 'new', '2026-07-04'), entry(202, 'continuing', '2026-07-06')]);
  const previous = catalog('2026Q2', [entry(303, 'new', '2026-04-02')]);
  expect([...buildSeasonWindow('2026-07-04', current, previous).activeSubjectIds]).toEqual([101, 202, 303]);
  expect([...buildSeasonWindow('2026-07-17', current, previous).activeSubjectIds]).toEqual([101, 202, 303]);
  expect([...buildSeasonWindow('2026-07-18', current, previous).activeSubjectIds]).toEqual([101, 202]);
});

it('falls back to quarter start when no normal premiere exists', () => {
  const window = buildSeasonWindow('2026-07-10', catalog('2026Q3', []), catalog('2026Q2', []));
  expect(window.anchorDate).toBe('2026-07-01');
  expect(window.overlapThrough).toBe('2026-07-14');
});
```

- [ ] **Step 3: Run both focused suites and confirm missing exports**

Run: `npm test -- tests/server/broadcast-schedule.test.ts tests/server/season-window.test.ts`

Expected: FAIL for missing `parseAcgSecretsSeason` and `buildSeasonWindow`.

- [ ] **Step 4: Add normalized season contracts**

```ts
export type SeasonEntry = {
  subjectId: number;
  seasonKey: string;
  seasonKind: SeasonKind;
  normalPremiereDate: string;
  airTime: string;
  dayOffset: number;
};

export type SeasonCatalog = {
  seasonKey: string;
  entries: Map<number, SeasonEntry>;
};

export type SeasonWindow = {
  currentSeasonKey: string;
  previousSeasonKey: string;
  anchorDate: string;
  overlapThrough: string;
  activeSubjectIds: Set<number>;
  entries: Map<number, SeasonEntry>;
};

export type BroadcastCatalog = {
  schedules: Map<number, BroadcastSchedule>;
  seasonWindow: SeasonWindow;
};
```

- [ ] **Step 5: Implement quarter fetch and pure boundary arithmetic**

Export `seasonKeyForDate`, `previousSeasonKey`, `acgSecretsUrlForSeason`, `parseAcgSecretsSeason`, and `buildSeasonWindow`. `fetchBroadcastCatalog(fetchImpl, userAgent, now)` must fetch the current and previous ACG pages plus existing Bangumi fallbacks. ACG still wins for schedule time; the season window uses only ACG entries.

```ts
export function buildSeasonWindow(today: string, current: SeasonCatalog, previous: SeasonCatalog): SeasonWindow {
  const normalDates = [...current.entries.values()]
    .filter((item) => item.seasonKind === 'new' && isValidDateString(item.normalPremiereDate))
    .map((item) => item.normalPremiereDate)
    .sort();
  const anchorDate = normalDates[0] ?? firstDateOfSeason(current.seasonKey);
  const overlapThrough = shiftAirDate(anchorDate, 13);
  const entries = new Map(current.entries);
  if (today <= overlapThrough) {
    for (const [subjectId, entry] of previous.entries) {
      if (!entries.has(subjectId)) entries.set(subjectId, entry);
    }
  }
  return {
    currentSeasonKey: current.seasonKey,
    previousSeasonKey: previous.seasonKey,
    anchorDate,
    overlapThrough,
    activeSubjectIds: new Set(entries.keys()),
    entries
  };
}
```

Parse `anime-type-new` as `new`, `anime-type-continue` as `continuing`, and ignore cards without a valid Bangumi subject link. Treat the `onairtime` Shanghai date as the normal premiere because ACG Secrets separates advance broadcasts from the regular card schedule. Calculate `dayOffset` as `1` only when normalized Shanghai weekday is the day after `weektoday`; otherwise `0`.

- [ ] **Step 6: Run season and legacy broadcast tests**

Run: `npm test -- tests/server/broadcast-schedule.test.ts tests/server/season-window.test.ts tests/server/sync.test.ts`

Expected: PASS; existing schedule offsets remain unchanged.

- [ ] **Step 7: Commit season metadata support**

```bash
git add src/server/types.ts src/server/broadcast-schedule.ts src/server/season-window.ts tests/server/broadcast-schedule.test.ts tests/server/season-window.test.ts
git commit -m "feat: classify active anime seasons"
```

### Task 4: Build the Pure Fair-Rotation Backlog Planner

**Files:**
- Create: `src/server/backlog-planner.ts`
- Create: `tests/server/backlog-planner.test.ts`

**Interfaces:**
- Consumes: `DashboardSubject`, `EpisodeRow`, current-season episode dates, saved fixed tasks, day skips, and episode exclusions.
- Produces: `capacityForSeasonalLoad`, `buildBacklogPlan`, and `estimateBacklogCompletionDate` for Tasks 5-8.

- [ ] **Step 1: Add failing capacity and daily-load tests**

```ts
it.each([
  [0, 2], [1, 2], [2, 1], [4, 1], [5, 0], [8, 0]
])('maps seasonal load %s to backlog capacity %s', (load, capacity) => {
  expect(capacityForSeasonalLoad(load)).toBe(capacity);
});

it('counts only exact-date seasonal main episodes regardless of watched state', () => {
  expect(countSeasonalLoad([
    episode({ airdate: '2026-07-20', episodeType: 0, collectionType: 2 }),
    episode({ airdate: '2026-07-20', episodeType: 0, collectionType: 0 }),
    episode({ airdate: '2026-07-20', episodeType: 1 }),
    episode({ airdate: '2026-07-19', episodeType: 0 })
  ], '2026-07-20')).toBe(2);
});
```

- [ ] **Step 2: Add failing rotation, lock, skip, and estimate tests**

Use queues `A1,A2,A3`, `B1,B2`, and `C1`. Assert the exact output `A1,B1,C1,A2,B2,A3` across available slots. Add cases proving two same-day slots use different subjects, cursor `A` starts at `B`, a fixed locked task stays today, past tasks return to the queue, skipped dates have no tasks, an exclusion applies to one date only, and future tasks are deterministic after repeated calls.

```ts
const result = buildBacklogPlan({
  today: '2026-07-19',
  throughDate: '2026-07-25',
  seasonalLoadByDate: new Map([
    ['2026-07-19', 0], ['2026-07-20', 2], ['2026-07-21', 5]
  ]),
  subjects: [queue('A', [11, 12, 13]), queue('B', [21, 22]), queue('C', [31])],
  fixedTasks: [],
  skippedDates: new Set(),
  exclusions: new Map(),
  rotationCursorSubjectId: null
});

expect(result.tasks.map((task) => task.episodeId)).toEqual([11, 21, 31, 12, 22, 13]);
expect(result.days.find((day) => day.date === '2026-07-21')?.tasks).toEqual([]);
```

- [ ] **Step 3: Run the suite and verify the planner module is absent**

Run: `npm test -- tests/server/backlog-planner.test.ts`

Expected: FAIL with module-not-found for `src/server/backlog-planner.ts`.

- [ ] **Step 4: Implement the exact pure input/output contract**

```ts
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
```

Algorithm requirements:

1. Sort each queue by `Number(ep ?? sort)` and discard watched or non-main episodes.
2. Remove episodes already present in `fixedTasks` from all queues.
3. Rotate subject queues so the first subject follows `rotationCursorSubjectId`; if the cursor is absent, preserve repository order.
4. Walk plan dates in ascending order. Subtract fixed-task slots from `capacityForSeasonalLoad`.
5. During the first pass for a date, take at most one episode per subject. Only start a second pass when free slots remain and every eligible subject already contributed once.
6. After assigning an episode, move that subject to the end of the queue and update the cursor.
7. A date exclusion blocks only that episode on that date. A skipped date blocks all generated tasks on that date.
8. Never mutate input arrays, maps, sets, episodes, or tasks.

`estimateBacklogCompletionDate` must simulate remaining episodes using the seven supplied daily loads repeated by weekday, cap the simulation at 1,826 days, and return `null` when every repeated day has zero capacity or no backlog episodes remain. It does not create a deadline or persist simulated tasks.

- [ ] **Step 5: Run focused tests plus lint**

Run: `npm test -- tests/server/backlog-planner.test.ts && npm run lint`

Expected: PASS; ESLint exits `0`.

- [ ] **Step 6: Commit the pure planner**

```bash
git add src/server/backlog-planner.ts tests/server/backlog-planner.test.ts
git commit -m "feat: generate fair backlog plans"
```

### Task 5: Synchronize Wishlist, Watching, Held, and Automatic Classification

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/sync.ts`
- Modify: `src/server/db.ts`
- Modify: `tests/server/sync.test.ts`
- Create: `tests/server/sync-integration.test.ts`

**Interfaces:**
- Consumes: generic collection reads from Task 2, `BroadcastCatalog` from Task 3, repository methods from Task 1, and planner from Task 4.
- Produces: `syncAnimeCollections`, `rebuildBacklogPlan`, and safe subject classification for the dashboard service.

- [ ] **Step 1: Replace watching-only tests with three-collection pagination tests**

Assert independent offsets for type `1`, `3`, and `4`, and verify that wishlist rows do not call `getSubjectEpisodes` while watching and held rows do. Verify `airYear` comes from valid `subject.date`, with `null` for missing/invalid dates.

```ts
expect(getAnimeCollections.mock.calls).toEqual([
  ['sai', 1, 50, 0],
  ['sai', 3, 50, 0],
  ['sai', 3, 50, 50],
  ['sai', 4, 50, 0]
]);
expect(getSubjectEpisodes).not.toHaveBeenCalledWith(wishlistSubjectId, expect.anything(), expect.anything());
```

- [ ] **Step 2: Add classification and completion-safety integration tests**

Use a temporary SQLite database and mocked client. Cover these exact cases:

- Current-quarter `new` type `3` becomes `plannerMode: 'seasonal'`.
- Current-quarter `continuing` type `3` remains seasonal after overlap.
- Previous-quarter type `3` remains seasonal on overlap day 14 and becomes backlog on day 15.
- An unrelated type `3` becomes backlog immediately.
- Type `1` remains type `1` and never changes remotely.
- Type `4` appears in backlog held.
- A locally completed type `2` row is not deleted when absent from the `1/3/4` pages.
- API `eps = 0` with twelve fetched main episodes displays twelve but has `totalEpisodesKnown: false`.
- API `eps = 10` with twelve fetched main episodes stores display total twelve and `totalEpisodesKnown: true`.
- SP/OVA rows do not increase display total or affect completion eligibility.

- [ ] **Step 3: Run sync suites and verify old assumptions fail**

Run: `npm test -- tests/server/sync.test.ts tests/server/sync-integration.test.ts`

Expected: FAIL because sync still reads only type `3` and cannot persist classification fields.

- [ ] **Step 4: Implement collection mapping and classification**

Rename the entry point and inject the local date for deterministic tests:

```ts
export async function syncAnimeCollections(input: {
  username: string;
  client: BangumiClient;
  repository: SyncRepository;
  today?: string;
  pageSize?: number;
}): Promise<SyncResult>;
```

Map rows with these rules:

```ts
function classifySubject(
  collectionType: 1 | 3 | 4,
  subjectId: number,
  seasonWindow: SeasonWindow
): Pick<SubjectRow, 'collectionType' | 'plannerMode' | 'seasonKey' | 'seasonKind'> {
  const season = seasonWindow.entries.get(subjectId);
  if (collectionType === 1) {
    return { collectionType, plannerMode: null, seasonKey: season?.seasonKey ?? null, seasonKind: season?.seasonKind ?? null };
  }
  if (collectionType === 4) {
    return { collectionType, plannerMode: 'backlog', seasonKey: season?.seasonKey ?? null, seasonKind: season?.seasonKind ?? null };
  }
  return {
    collectionType,
    plannerMode: seasonWindow.activeSubjectIds.has(subjectId) ? 'seasonal' : 'backlog',
    seasonKey: season?.seasonKey ?? null,
    seasonKind: season?.seasonKind ?? null
  };
}
```

For wishlist rows, retain basic subject metadata and skip episode replacement. For type `3/4`, fetch all episode pages, keep the existing ACG date normalization and one-week correction, and set:

```ts
const apiTotal = collection.subject.eps ?? 0;
const fetchedMainCount = episodes.filter((episode) => episode.episodeType === 0).length;
const highestMainNumber = highestMainEpisodeNumber(episodes);
const eps = Math.max(apiTotal, collection.ep_status, fetchedMainCount, highestMainNumber);
const totalEpisodesKnown = apiTotal > 0;
```

Never delete a subject merely because it is absent from the three active collection pages. This preserves app-completed rows and avoids data loss during partial API failures.

- [ ] **Step 5: Implement `rebuildBacklogPlan` as the repository/planner adapter**

```ts
export async function rebuildBacklogPlan(input: {
  repository: Repository;
  today: string;
  includeToday: boolean;
}): Promise<void>;
```

It must prune overrides before today, lock today's current tasks, load seasonal main episodes for exactly seven dates, load active backlog subjects, return past unfinished tasks to queue by replacing future tasks, preserve today's locked tasks when `includeToday` is false, call `buildBacklogPlan`, persist tomorrow through day six, and save `backlog_rotation_cursor` only after a successful transaction. Automatic sync calls it with `includeToday: false`.

- [ ] **Step 6: Run sync, planner, and repository suites**

Run: `npm test -- tests/server/sync.test.ts tests/server/sync-integration.test.ts tests/server/backlog-planner.test.ts tests/server/db.test.ts`

Expected: PASS with no network access.

- [ ] **Step 7: Commit synchronized classification**

```bash
git add src/server/types.ts src/server/sync.ts src/server/db.ts tests/server/sync.test.ts tests/server/sync-integration.test.ts
git commit -m "feat: sync and classify anime collections"
```

### Task 6: Add Planner Service Actions, Safe Auto-Completion, and HTTP Routes

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/dashboard.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`
- Modify: `tests/server/dashboard.test.ts`
- Modify: `tests/server/app.test.ts`

**Interfaces:**
- Consumes: `syncAnimeCollections`, `rebuildBacklogPlan`, repository read models, and generic collection writes.
- Produces: complete `DashboardService` methods and Fastify routes consumed by Task 8.

- [ ] **Step 1: Add failing dashboard service tests for collection transitions**

Add exact cases for:

- Starting a wishlist title calls `setSubjectCollectionType(id, 3)`, synchronizes, and results in seasonal or backlog based on `SeasonWindow`.
- No sync path writes type `3` for an old wishlist without an explicit `startSubject` call.
- Pausing calls type `4`, updates local state, removes future tasks, and replans.
- Resuming calls type `3`, keeps `plannerMode: 'backlog'`, and replans.
- Marking the final main episode calls episode PATCH first, local episode update second, then type `2` only when the known-total predicate passes.
- Unknown total, too few fetched main episodes, one unwatched main episode, or any remote write failure does not mark complete.
- Marking an episode unwatched on a completed title restores type `3` and its existing planner mode.
- Manual completion is accepted only when `totalEpisodesKnown === false` and calls type `2`.
- Swap excludes the selected episode for today and rebuilds today plus future.
- Skip today removes all today's backlog tasks and sets a day skip.
- Replan today clears today's skip/exclusions/tasks and rebuilds all seven dates.

```ts
expect(canAutoComplete(subject, episodes)).toBe(true);
expect(client.setSubjectCollectionType).toHaveBeenCalledWith(subject.id, 2);
expect(repository.setSubjectState).toHaveBeenCalledWith(subject.id, {
  collectionType: 2,
  plannerMode: 'backlog',
  completedAt: expect.any(String)
});
```

- [ ] **Step 2: Add failing HTTP contract tests**

Test response codes, parsed positive IDs, local-token protection, and service calls for:

```text
GET  /api/backlog
GET  /api/wishlist?q=title&year=2024
GET  /api/wishlist?q=title&year=unknown
POST /api/subjects/:subjectId/start
POST /api/backlog/:subjectId/pause
POST /api/backlog/:subjectId/resume
POST /api/backlog/:subjectId/complete
POST /api/backlog/tasks/:episodeId/swap
POST /api/backlog/today/skip
POST /api/backlog/today/replan
```

Invalid years return `400`; valid GET routes do not require the write token; every POST route does.

- [ ] **Step 3: Run service and route suites and verify missing methods**

Run: `npm test -- tests/server/dashboard.test.ts tests/server/app.test.ts`

Expected: FAIL for missing planner service methods and routes.

- [ ] **Step 4: Implement completion predicates and service orchestration**

Export and test this predicate in `dashboard.ts`:

```ts
export function canAutoComplete(subject: SubjectRow, episodes: EpisodeRow[]): boolean {
  if (!subject.totalEpisodesKnown || subject.eps <= 0) return false;
  const main = episodes.filter((episode) => episode.episodeType === 0);
  return main.length >= subject.eps && main.every((episode) => episode.collectionType === 2);
}
```

Extend `DashboardService` with:

```ts
getBacklog(): Promise<BacklogData>;
getWishlist(query: string, year: number | null | 'unknown'): Promise<WishlistData>;
startSubject(subjectId: number): Promise<SyncResult>;
pauseBacklogSubject(subjectId: number): Promise<void>;
resumeBacklogSubject(subjectId: number): Promise<void>;
completeBacklogSubject(subjectId: number): Promise<void>;
swapBacklogTask(episodeId: number): Promise<void>;
skipBacklogToday(): Promise<void>;
replanBacklogToday(): Promise<void>;
```

Keep one `syncInFlight` promise. After every successful episode or subject state mutation, call `rebuildBacklogPlan` once. Remote Bangumi writes happen before local writes so a rejected API request leaves SQLite unchanged. Use `todayInShanghai(clock())`, with `clock` defaulting to `() => new Date()`, rather than reading `new Date()` throughout service methods.

- [ ] **Step 5: Implement routes with strict query parsing**

Parse wishlist year as follows:

```ts
function parseWishlistYear(value: string | undefined): number | null | 'unknown' {
  if (!value || value === 'all') return null;
  if (value === 'unknown') return 'unknown';
  if (!/^\d{4}$/.test(value)) {
    throw Object.assign(new Error('Year must be all, unknown, or a four-digit year'), { statusCode: 400 });
  }
  return Number(value);
}
```

Return `204` for pause, resume, completion, swap, skip, and replan. `startSubject` returns `SyncResult`. Preserve all existing episode, OAuth, calendar, search, static-file, error-handler, and API-token routes.

- [ ] **Step 6: Run all server tests and type checks**

Run: `npm test -- tests/server/dashboard.test.ts tests/server/app.test.ts tests/server/sync-integration.test.ts && npx tsc -p tsconfig.server.json --noEmit`

Expected: PASS; TypeScript exits `0`.

- [ ] **Step 7: Commit service and routes**

```bash
git add src/server/types.ts src/server/dashboard.ts src/server/app.ts src/server/index.ts tests/server/dashboard.test.ts tests/server/app.test.ts
git commit -m "feat: expose backlog planner actions"
```

### Task 7: Combine Seasonal and Backlog Daily Notifications

**Files:**
- Modify: `src/server/reminders.ts`
- Modify: `src/server/scheduler.ts`
- Modify: `tests/server/reminders.test.ts`
- Create: `tests/server/scheduler.test.ts`

**Interfaces:**
- Consumes: seasonal reminder candidates, today's `BacklogTaskRow[]`, existing notifier, and `last_notification_date` setting.
- Produces: `createDailyNotificationSummary` and one deduplicated `20:00` notification.

- [ ] **Step 1: Add failing notification copy and omission tests**

```ts
it('builds two labeled sections when both kinds have tasks', () => {
  expect(createDailyNotificationSummary([seasonalEpisode], [backlogTask])).toEqual({
    title: '今日追番计划',
    body: '今日新番待看：测试新番 第 3 集\n今日补番计划：旧番 第 2 集'
  });
});

it('omits the backlog section when today has no backlog task', () => {
  expect(createDailyNotificationSummary([seasonalEpisode], [])?.body).toBe('今日新番待看：测试新番 第 3 集');
});

it('returns null when both sections are empty', () => {
  expect(createDailyNotificationSummary([], [])).toBeNull();
});
```

Add scheduler tests proving sync and plan rebuild happen before reading data, notifications remain one per Shanghai date, a no-task day does not consume the dedup marker, and disabled notifications do nothing.

- [ ] **Step 2: Run reminder and scheduler tests and verify the old summary fails**

Run: `npm test -- tests/server/reminders.test.ts tests/server/scheduler.test.ts`

Expected: FAIL because only the old single-list summary exists.

- [ ] **Step 3: Implement the combined summary**

```ts
export function createDailyNotificationSummary(
  seasonalEpisodes: EpisodeRow[],
  backlogTasks: BacklogTaskRow[]
): { title: string; body: string } | null {
  const sections: string[] = [];
  if (seasonalEpisodes.length > 0) {
    sections.push(`今日新番待看：${formatEpisodes(seasonalEpisodes)}`);
  }
  if (backlogTasks.length > 0) {
    sections.push(`今日补番计划：${formatEpisodes(backlogTasks.map((task) => task.episode))}`);
  }
  return sections.length === 0 ? null : { title: '今日追番计划', body: sections.join('\n') };
}
```

Limit each section preview to three titles and append `等 N 部` when needed so the macOS notification stays readable. Seasonal candidates must come only from `plannerMode === 'seasonal'` subjects and already-aired main episodes. Backlog tasks must have `plannedDate === today`.

- [ ] **Step 4: Update scheduler ordering without changing cron configuration**

`runReminderCheck` must execute: notification enabled check, deduplicated sync, automatic future replan, load dashboard/backlog, build summary, check daily marker, notify, save marker. Keep `timezone: 'Asia/Shanghai'` and the configured `20:00` cron expression.

- [ ] **Step 5: Run reminder, scheduler, and regression suites**

Run: `npm test -- tests/server/reminders.test.ts tests/server/scheduler.test.ts tests/server/dashboard.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit notification integration**

```bash
git add src/server/reminders.ts src/server/scheduler.ts tests/server/reminders.test.ts tests/server/scheduler.test.ts
git commit -m "feat: combine daily anime reminders"
```

### Task 8: Build Four Focused React Views

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/styles.css`
- Create: `src/client/views/WatchingView.tsx`
- Create: `src/client/views/BacklogView.tsx`
- Create: `src/client/views/WishlistView.tsx`
- Create: `src/client/views/CalendarView.tsx`
- Modify: `tests/client/App.test.tsx`
- Create: `tests/client/BacklogView.test.tsx`
- Create: `tests/client/WishlistView.test.tsx`

**Interfaces:**
- Consumes: new HTTP routes and read models from Task 6 while preserving existing auth/dashboard/calendar APIs.
- Produces: the final four-tab user experience and immediate refresh after every action.

- [ ] **Step 1: Add failing shell navigation tests**

Assert exact accessible tab order and lazy view loading:

```ts
expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
  '追番提醒',
  '补番计划',
  '想看',
  '每日放送'
]);
```

Verify seasonal cards never render a known backlog title and backlog cards never render a known seasonal title. Preserve current login, OAuth setup, manual sync, watched/unwatched, watched-through, error, and calendar tests.

- [ ] **Step 2: Add failing backlog interaction tests**

Cover today task count, future seven-day grouping, seasonal load/capacity labels, estimated completion date, active/held/completed sections, unknown total copy, and these requests:

```text
POST /api/episodes/11/watched
POST /api/backlog/tasks/11/swap
POST /api/backlog/today/skip
POST /api/backlog/today/replan
POST /api/backlog/101/pause
POST /api/backlog/101/resume
POST /api/backlog/101/complete
```

Each successful action must refetch `/api/backlog` and `/api/dashboard`; failed actions must leave the item visible and show the returned error.

- [ ] **Step 3: Add failing wishlist filtering tests**

Assert `GET /api/wishlist?q=%E6%B5%8B%E8%AF%95&year=2024`, `year=all`, and `year=unknown`. Verify the year menu contains descending years plus `全部年份` and `年份未知`. A current-season card displays `本季度` and `开始追番`; an older card displays `旧番` and `加入补番`. Clicking either sends `POST /api/subjects/:id/start`, with no other automatic POST during initial render or filter changes.

- [ ] **Step 4: Run client tests and confirm the two new views are absent**

Run: `npm test -- tests/client/App.test.tsx tests/client/BacklogView.test.tsx tests/client/WishlistView.test.tsx`

Expected: FAIL for missing tabs, modules, API calls, and controls.

- [ ] **Step 5: Add typed client API functions**

```ts
export function getBacklog(): Promise<BacklogData>;
export function getWishlist(query: string, year: number | null | 'unknown'): Promise<WishlistData>;
export function startSubject(subjectId: number): Promise<SyncResult>;
export function pauseBacklog(subjectId: number): Promise<void>;
export function resumeBacklog(subjectId: number): Promise<void>;
export function completeBacklog(subjectId: number): Promise<void>;
export function swapBacklogTask(episodeId: number): Promise<void>;
export function skipBacklogToday(): Promise<void>;
export function replanBacklogToday(): Promise<void>;
```

Use the existing `api<T>` helper so write-token refresh behavior remains centralized.

- [ ] **Step 6: Split `App.tsx` and implement the four views**

`App.tsx` owns auth, active tab, global sync, global errors, and refresh callbacks. It must not duplicate backlog or wishlist rendering. Use these component contracts:

```ts
type WatchingViewProps = {
  dashboard: DashboardData;
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

type BacklogViewProps = {
  data: BacklogData;
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};

type WishlistViewProps = {
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
};
```

Backlog layout order is exact: `今日任务`, `未来 7 天`, `进行中`, `搁置`, `已完成`. Today controls are visible commands beside the task list; subject pause/resume/manual-complete controls stay with their own row. Show `预计完成 YYYY-MM-DD` or `当前负载下无法估算`; do not present it as a deadline.

Wishlist uses a text search input and a native/select menu for year. Debounce name changes by 250 ms, cancel stale responses with a request sequence number, and never mutate Bangumi state during filtering.

Move the existing calendar JSX to `CalendarView.tsx` without changing ranking, image, time, or grouping behavior. Keep settings under the seasonal view after the watching list so the top-level navigation remains exactly four items.

- [ ] **Step 7: Add stable responsive CSS**

Use existing color tokens and `6px` or smaller control radii. Define fixed task index/action tracks so text and buttons cannot resize rows. At widths below `760px`, stack task content and actions, allow title wrapping, and keep every button label inside its parent. Do not add gradients, decorative floating shapes, nested cards, or viewport-scaled font sizes.

- [ ] **Step 8: Run client tests, build, and lint**

Run: `npm test -- tests/client/App.test.tsx tests/client/BacklogView.test.tsx tests/client/WishlistView.test.tsx && npm run build && npm run lint`

Expected: PASS; production client/server build completes; ESLint exits `0`.

- [ ] **Step 9: Commit the UI**

```bash
git add src/client/App.tsx src/client/api.ts src/client/styles.css src/client/views tests/client
git commit -m "feat: add backlog and wishlist views"
```

### Task 9: End-to-End Regression, Real Sync Safety, and Documentation

**Files:**
- Modify: `README.md`
- Modify: `tests/server/oauth-flow.test.ts`
- Modify: `tests/server/sync-integration.test.ts`
- Modify: `tests/client/App.test.tsx`

**Interfaces:**
- Consumes: all completed server and client behavior.
- Produces: documented operation, full regression evidence, and a release-ready branch.

- [ ] **Step 1: Add one full mocked user-flow test**

Build a temporary SQLite repository with mocked Bangumi/ACG responses and run this sequence through Fastify injection:

1. OAuth callback stores user and performs initial sync.
2. Type `3` current anime appears only in `/api/dashboard`.
3. Type `3` old anime appears only in `/api/backlog` with a generated task.
4. Type `1` old anime appears only in `/api/wishlist`.
5. Starting the wishlist title writes type `3`, syncs it into backlog, and replans with fair title rotation.
6. Marking today's task watched updates SQLite and replaces its plan slot.
7. Pausing the title writes type `4` and moves it to held.
8. Resuming writes type `3` and restores it to active backlog.
9. Marking every known main episode watched writes type `2` and moves it to completed.
10. Reopening one episode writes type `0` for the episode, restores subject type `3`, and puts the episode back in planning.

- [ ] **Step 2: Run the full automated bug suite**

Run: `npm test`

Expected: every Vitest suite passes with zero unhandled errors.

Run: `npm run build && npm run lint`

Expected: both commands exit `0`.

- [ ] **Step 3: Document behavior and local operation**

Update `README.md` with:

- Four-view navigation and the exact collection-state mapping.
- The daily capacity table and round-robin example `A1, B1, C1, A2`.
- Today lock, unfinished-task recycling, swap, skip, and manual replan behavior.
- Known-total auto-completion and unknown-total manual completion.
- ACG Secrets normal-premiere anchor, 14-day overlap, cross-season handling, and `25:00` next-day normalization.
- Wishlist name/year filters and explicit-start rule.
- The unchanged `npm run dev`, `npm run build && npm start`, LaunchAgent, LAN URL, OAuth callback, and `20:00` notification instructions.
- A privacy note that credentials stay in Keychain/local settings and are never committed.

- [ ] **Step 4: Run a real local smoke test without entering credentials in source or logs**

With the already configured Keychain/OAuth session, run:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:3777`, trigger `立即同步`, and verify:

- No subject appears in both seasonal and backlog views.
- Today's broadcast dates/times match ACG Secrets, including Sunday placement and `25:00` next-day entries.
- The backlog day capacities match the visible seasonal episodes for all seven dates.
- Two-slot days choose different titles when possible.
- Refreshing the page preserves the same locked today tasks.
- Swap, skip, replan, pause, resume, manual completion, watched, and unwatched all survive a page refresh.
- Wishlist year filters include known years and unknown year.
- Browser console and server log contain no unhandled errors and no secrets.

Stop the foreground process after verification. Do not clear the existing Keychain tokens or SQLite database.

- [ ] **Step 5: Commit documentation and final regressions**

```bash
git add README.md tests/server/oauth-flow.test.ts tests/server/sync-integration.test.ts tests/client/App.test.tsx
git commit -m "test: cover backlog planner workflow"
```

- [ ] **Step 6: Verify the final diff and push**

Run: `git status --short && git log --oneline --decorate -10`

Expected: clean working tree and the task commits listed in order.

Run: `git push origin main`

Expected: remote `origin/main` advances successfully.

---

## Requirement Trace

| Requirement | Implemented and verified in |
| --- | --- |
| Seasonal/backlog separation | Tasks 3, 5, 8, 9 |
| Wishlist sync and explicit start | Tasks 2, 5, 6, 8, 9 |
| Old watching anime enters backlog | Tasks 3, 5, 9 |
| Pause to held, resume, completed | Tasks 1, 6, 8, 9 |
| Known-total completion safety and manual unknown completion | Tasks 5, 6, 9 |
| SP/OVA exclusion | Tasks 4, 5, 6 |
| Daily load thresholds and 25:00 handling | Tasks 3, 4, 9 |
| Fair multi-title rotation | Tasks 4, 5, 8, 9 |
| Today lock and future automatic reorder | Tasks 1, 4, 5, 6, 9 |
| Swap, skip, and replan today | Tasks 1, 4, 6, 8, 9 |
| Dynamic estimate without deadline | Tasks 4, 8 |
| 14-day quarter overlap and continuing anime | Tasks 3, 5, 9 |
| Name/year wishlist filters | Tasks 1, 6, 8, 9 |
| Combined 20:00 notification | Task 7 |
| Four-view navigation | Task 8 |
| OAuth, LAN, calendar, and existing regressions | Tasks 6, 8, 9 |
