export type AuthStatus = {
  authenticated: boolean;
  username: string | null;
  nickname: string | null;
  lastSyncAt: string | null;
  configured?: boolean;
  oauthClientId?: string | null;
  callbackUrl?: string;
  notificationsEnabled?: boolean;
  launchAgentInstalled?: boolean;
  runtimePlatform?: 'macOS' | 'Windows' | 'Linux' | 'Other';
};

export type BangumiCollectionType = 1 | 2 | 3 | 4 | 5;
export type PlannerMode = 'seasonal' | 'backlog' | null;
export type SeasonKind = 'new' | 'continuing';
export type SyncMode = 'incremental' | 'full';
export type BroadcastSource = 'Yuc Wiki' | 'Bangumi Data' | 'Bangumi Index' | 'Bangumi' | '本地修正';

export type BroadcastSchedule = {
  airDate: string;
  airTime: string;
  dayOffset: number;
  source?: BroadcastSource;
};

export type BroadcastOverride = {
  subjectId: number;
  airDate: string;
  airTime: string;
  dateShiftDays: number;
  updatedAt: string;
};

export type SeasonEntry = {
  subjectId: number;
  name?: string;
  nameCn?: string;
  image?: string | null;
  seasonKey: string;
  seasonKind: SeasonKind;
  normalPremiereDate: string;
  airTime: string;
  dayOffset: number;
  scheduleSource?: BroadcastSource;
};

export type SeasonCatalog = {
  seasonKey: string;
  entries: Map<number, SeasonEntry>;
  available?: boolean;
};

export type UpcomingSeasonCandidate = {
  subjectId: number;
  name: string;
  nameCn: string;
  image: string | null;
  seasonKey: string;
  sourceType: string;
  normalPremiereDate: string;
  airTime: string;
  airWeekday: number | null;
};

export type UpcomingSeasonCatalog = {
  seasonKey: string;
  available: boolean;
  entries: Map<number, UpcomingSeasonCandidate>;
};

export type SeasonWindow = {
  currentSeasonKey: string;
  previousSeasonKey: string;
  anchorDate: string;
  overlapThrough: string;
  authoritative: boolean;
  activeSubjectIds: Set<number>;
  entries: Map<number, SeasonEntry>;
};

export type BroadcastCatalog = {
  schedules: Map<number, BroadcastSchedule>;
  seasonWindow: SeasonWindow;
};

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
  airDate?: string | null;
  airYear: number | null;
  totalEpisodesKnown: boolean;
  completedAt: string | null;
};

export type SubjectWrite = Omit<SubjectRow, 'collectionType' | 'plannerMode' | 'seasonKey' | 'seasonKind' | 'airYear' | 'totalEpisodesKnown' | 'completedAt'>
  & Partial<Pick<SubjectRow, 'collectionType' | 'plannerMode' | 'seasonKey' | 'seasonKind' | 'airYear' | 'totalEpisodesKnown' | 'completedAt'>>;

export type EpisodeRow = {
  id: number;
  subjectId: number;
  subjectName: string;
  subjectNameCn: string;
  subjectUrl: string;
  episodeType: number;
  sort: number;
  ep: number | null;
  name: string;
  nameCn: string;
  airdate: string;
  airTime: string;
  collectionType: number;
  dismissedAt: string | null;
  snoozedUntil: string | null;
};

export type DashboardSubject = SubjectRow & {
  nextEpisode: EpisodeRow | null;
  mainEpisodes: EpisodeRow[];
  progressEpisodes: EpisodeRow[];
  unwatchedMainEpisodeCount: number;
  unwatchedProgressEpisodeCount: number;
  unwatchedMainEpisodes: EpisodeRow[];
};

export type DashboardSubjectSummary = Omit<DashboardSubject, 'mainEpisodes' | 'progressEpisodes' | 'unwatchedMainEpisodes'>;

export type DashboardData = {
  pendingEpisodes: EpisodeRow[];
  subjects: DashboardSubjectSummary[];
  lastSyncAt: string | null;
  lastError: string | null;
  syncDiagnostics?: SyncDiagnostics;
};

export type CollectionSnapshot = {
  subjectId: number;
  collectionType: BangumiCollectionType;
  remoteUpdatedAt: string | null;
  fingerprint: string;
  syncedAt: string;
};

export type SyncRunDiagnostic = {
  completedAt: string;
  durationMs: number;
  changedSubjects: number;
  failedSubjects: number;
};

export type SyncDiagnostics = {
  incremental: SyncRunDiagnostic | null;
  full: SyncRunDiagnostic | null;
  pendingOperations: number;
  failedOperations: Array<{ id: number; kind: PendingOperationKind; error: string }>;
};

export type DashboardEvent = {
  type: 'data' | 'error';
  subjectIds: number[];
  scopes?: Array<'dashboard' | 'backlog' | 'held' | 'wishlist' | 'calendar' | 'search'>;
  error?: string;
};

export type PendingOperationKind =
  | 'add_watching'
  | 'add_wishlist'
  | 'set_collection'
  | 'episodes_watched'
  | 'episodes_unwatched';

export type PendingOperation = {
  id: number;
  resourceKey: string;
  kind: PendingOperationKind;
  payload: string;
  rollback: string;
  attempts: number;
  state: 'queued' | 'running' | 'failed';
  retryUntil: string;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
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
  items: Array<SubjectRow & { isCurrentSeason: boolean; isUpcoming: boolean }>;
  years: number[];
};

export type UpcomingSeasonItem = {
  id: number;
  name: string;
  nameCn: string;
  image: string | null;
  url: string;
  seasonKey: string;
  sourceType: string;
  normalPremiereDate: string;
  airTime: string;
  airWeekday: number | null;
  collectionType: BangumiCollectionType | null;
  action: 'add' | 'schedule' | null;
  actionLabel: string;
  autoWatch: boolean;
};

export type UpcomingSeasonData = {
  seasonKey: string;
  available: boolean;
  items: UpcomingSeasonItem[];
};

export type BangumiUser = {
  id: number;
  username: string;
  nickname: string;
};

export type BangumiSubjectCollection = {
  subject_id: number;
  type: number;
  ep_status: number;
  updated_at?: number | string;
  subject: {
    id: number;
    name: string;
    name_cn?: string;
    date?: string;
    eps?: number;
    images?: {
      common?: string;
      medium?: string;
      small?: string;
      grid?: string;
      large?: string;
    } | null;
  };
};

export type BangumiCollectionPage = {
  total: number;
  limit?: number;
  offset?: number;
  data: BangumiSubjectCollection[];
};

export type BangumiEpisodeCollection = {
  type: number;
  updated_at: number;
  episode: {
    id: number;
    subject_id?: number;
    type: number;
    sort: number;
    ep?: number;
    name: string;
    name_cn?: string;
    airdate?: string;
  };
};

export type BangumiEpisodePage = {
  total?: number;
  limit?: number;
  offset?: number;
  data: BangumiEpisodeCollection[];
};

export type BangumiSearchSubject = {
  id: number;
  type: number;
  name: string;
  name_cn?: string;
  date?: string;
  eps?: number;
  images?: {
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
    large?: string;
  } | null;
};

export type BangumiSubjectSearchPage = {
  total: number;
  data: BangumiSearchSubject[];
};

export type AnimeSearchSubject = {
  id: number;
  name: string;
  nameCn: string;
  airDate: string;
  eps: number;
  image: string | null;
  url: string;
};

export type AnimeSearchResult = AnimeSearchSubject & {
  collectionType: BangumiCollectionType | null;
  watchAction: 'add' | 'start' | 'resume' | null;
  watchActionLabel: string;
  wishlistAction: 'add' | null;
  wishlistActionLabel: string;
};

export type BangumiCalendarSubject = {
  id: number;
  url?: string;
  type: number;
  name: string;
  name_cn?: string;
  air_date?: string;
  air_weekday?: number;
  rating?: {
    score?: number;
    total?: number;
  };
  rank?: number;
  images?: {
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
    large?: string;
  } | null;
  collection?: {
    doing?: number;
  };
};

export type BangumiCalendarDay = {
  weekday: {
    en: string;
    cn: string;
    ja: string;
    id: number;
  };
  items: BangumiCalendarSubject[];
};

export type CalendarSubject = {
  id: number;
  name: string;
  nameCn: string;
  url: string;
  airDate: string;
  airTime: string;
  airWeekday: number | null;
  image: string | null;
  ratingScore: number | null;
  rank: number | null;
  collectionDoing: number | null;
  scheduleSource?: BroadcastSource;
  baseScheduleSource?: BroadcastSource | null;
  isLocalOverride?: boolean;
  localDateShiftDays?: number;
};

export type CalendarDay = {
  weekday: BangumiCalendarDay['weekday'];
  items: CalendarSubject[];
};

export type BangumiClient = {
  getMe(): Promise<BangumiUser>;
  getCalendar(): Promise<CalendarDay[]>;
  getAnimeCollections(username: string, type: 1 | 3 | 4, limit: number, offset: number): Promise<BangumiCollectionPage>;
  getSubjectCollection?(subjectId: number): Promise<BangumiSubjectCollection | null>;
  getWatchingAnime(username: string, limit: number, offset: number): Promise<BangumiCollectionPage>;
  getSubjectEpisodes(subjectId: number, limit?: number, offset?: number): Promise<BangumiEpisodePage>;
  getBroadcastCatalog?(): Promise<BroadcastCatalog>;
  getUpcomingSeasonCatalog?(seasonKey: string): Promise<UpcomingSeasonCatalog>;
  getBroadcastTimes?(): Promise<Map<number, { airDate: string; airTime: string; dayOffset: number }>>;
  markEpisodesWatched(subjectId: number, episodeIds: number[]): Promise<void>;
  markEpisodesUnwatched(subjectId: number, episodeIds: number[]): Promise<void>;
  setSubjectCollectionType(subjectId: number, type: 2 | 3 | 4 | 5): Promise<void>;
  addSubjectToWatching(subjectId: number): Promise<void>;
  addSubjectToWishlist(subjectId: number): Promise<void>;
  searchAnimeSubjects(keyword: string): Promise<AnimeSearchSubject[]>;
};

export type SyncRepository = {
  upsertSubject(subject: SubjectWrite): Promise<void>;
  replaceSubjectEpisodes(subjectId: number, episodes: EpisodeRow[]): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listSubjectsByMode(mode: Exclude<PlannerMode, null>, types: BangumiCollectionType[]): Promise<DashboardSubject[]>;
  listBacklogTasks(fromDate: string, throughDate: string): Promise<BacklogTaskRow[]>;
  replaceBacklogTasks(input: {
    fromDate: string;
    throughDate: string;
    preserveLocked: boolean;
    tasks: Array<Omit<BacklogTaskRow, 'id' | 'episode'>>;
  }): Promise<void>;
  lockBacklogDate(date: string): Promise<void>;
  listSkippedBacklogDates(fromDate: string, throughDate: string): Promise<string[]>;
  listBacklogExclusions(fromDate: string, throughDate: string): Promise<Array<{ plannedDate: string; episodeId: number }>>;
  prunePlannerState(beforeDate: string): Promise<void>;
  listBroadcastOverrides(): Promise<BroadcastOverride[]>;
  listCollectionSnapshots?(): Promise<CollectionSnapshot[]>;
  upsertCollectionSnapshot?(snapshot: Omit<CollectionSnapshot, 'syncedAt'>): Promise<void>;
  deleteCollectionSnapshot?(subjectId: number): Promise<void>;
  listSubjectsByCollection?(types: BangumiCollectionType[]): Promise<DashboardSubject[]>;
  getSubject?(subjectId: number): Promise<SubjectRow | null>;
  deleteSubject?(subjectId: number): Promise<void>;
};

export type SyncResult = {
  subjectsSynced: number;
  episodesSynced: number;
  subjectsFailed?: number;
  changedSubjectIds?: number[];
  mode?: SyncMode;
  durationMs?: number;
};

export type SyncProgress = {
  processedSubjects: number;
  totalSubjects: number;
};

export type SyncStatus = SyncProgress & {
  state: 'idle' | 'running' | 'error';
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  result: SyncResult | null;
};

export type OAuthManager = {
  createAuthorizationUrl(): Promise<URL>;
  handleCallback(code: string, state: string): Promise<void>;
  getAccessToken(): Promise<string>;
  getAuthStatus(): Promise<AuthStatus>;
};

export type DashboardService = {
  getDashboard(): Promise<DashboardData>;
  getSubjectEpisodes(subjectId: number): Promise<EpisodeRow[]>;
  getBacklog(): Promise<BacklogData>;
  getHeldSubjects(): Promise<DashboardSubject[]>;
  getWishlist(query: string, year: number | null | 'unknown'): Promise<WishlistData>;
  getCalendar(): Promise<CalendarDay[]>;
  getUpcomingSeason(): Promise<UpcomingSeasonData>;
  saveBroadcastOverride(input: Omit<BroadcastOverride, 'updatedAt'>): Promise<void>;
  deleteBroadcastOverride(subjectId: number): Promise<void>;
  syncNow(mode?: SyncMode): Promise<SyncResult>;
  startSync(mode?: SyncMode): SyncStatus;
  getSyncStatus(): SyncStatus;
  getSyncDiagnostics(): Promise<SyncDiagnostics>;
  retryOperation(id: number): Promise<void>;
  subscribe(listener: (event: DashboardEvent) => void): () => void;
  markEpisodeWatched(episodeId: number): Promise<void>;
  markEpisodeUnwatched(episodeId: number): Promise<void>;
  markSubjectEpisodesWatchedThrough(subjectId: number, episodeId: number): Promise<void>;
  addSubjectToWatching(subjectId: number): Promise<SyncStatus>;
  addSubjectToWishlist(subjectId: number): Promise<SyncStatus>;
  addUpcomingToWishlist(subjectId: number): Promise<SyncStatus>;
  startSubject(subjectId: number): Promise<SyncStatus>;
  holdSubject(subjectId: number): Promise<void>;
  resumeHeldSubject(subjectId: number): Promise<void>;
  dropSubject(subjectId: number): Promise<void>;
  pauseBacklogSubject(subjectId: number): Promise<void>;
  resumeBacklogSubject(subjectId: number): Promise<void>;
  completeBacklogSubject(subjectId: number): Promise<void>;
  swapBacklogTask(episodeId: number): Promise<void>;
  skipBacklogToday(): Promise<void>;
  replanBacklogToday(): Promise<void>;
  searchAnimeSubjects(keyword: string): Promise<AnimeSearchResult[]>;
  dismissEpisode(episodeId: number): Promise<void>;
  snoozeEpisodeUntilTomorrow(episodeId: number): Promise<void>;
};

export type OAuthConfigInput = {
  clientId: string;
  clientSecret: string;
};

export type SettingsService = {
  saveOAuthConfig(input: OAuthConfigInput): Promise<void>;
};
