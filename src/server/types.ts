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
};

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
};

export type DashboardSubject = SubjectRow & {
  nextEpisode: EpisodeRow | null;
  mainEpisodes: EpisodeRow[];
  unwatchedMainEpisodeCount: number;
  unwatchedMainEpisodes: EpisodeRow[];
};

export type DashboardData = {
  pendingEpisodes: EpisodeRow[];
  subjects: DashboardSubject[];
  lastSyncAt: string | null;
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
  items: Array<SubjectRow & { isCurrentSeason: boolean }>;
  years: number[];
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

export type AnimeSearchResult = {
  id: number;
  name: string;
  nameCn: string;
  eps: number;
  image: string | null;
  url: string;
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
};

export type CalendarDay = {
  weekday: BangumiCalendarDay['weekday'];
  items: CalendarSubject[];
};

export type BangumiClient = {
  getMe(): Promise<BangumiUser>;
  getCalendar(): Promise<CalendarDay[]>;
  getAnimeCollections(username: string, type: 1 | 3 | 4, limit: number, offset: number): Promise<BangumiCollectionPage>;
  getWatchingAnime(username: string, limit: number, offset: number): Promise<BangumiCollectionPage>;
  getSubjectEpisodes(subjectId: number, limit?: number, offset?: number): Promise<BangumiEpisodePage>;
  getBroadcastTimes?(): Promise<Map<number, { airDate: string; airTime: string; dayOffset: number }>>;
  markEpisodesWatched(subjectId: number, episodeIds: number[]): Promise<void>;
  markEpisodesUnwatched(subjectId: number, episodeIds: number[]): Promise<void>;
  setSubjectCollectionType(subjectId: number, type: 2 | 3 | 4): Promise<void>;
  addSubjectToWatching(subjectId: number): Promise<void>;
  searchAnimeSubjects(keyword: string): Promise<AnimeSearchResult[]>;
};

export type SyncRepository = {
  upsertSubject(subject: SubjectWrite): Promise<void>;
  replaceSubjectEpisodes(subjectId: number, episodes: EpisodeRow[]): Promise<void>;
  setSetting(key: string, value: string): Promise<void>;
};

export type SyncResult = {
  subjectsSynced: number;
  episodesSynced: number;
};

export type OAuthManager = {
  createAuthorizationUrl(): Promise<URL>;
  handleCallback(code: string, state: string): Promise<void>;
  getAccessToken(): Promise<string>;
  getAuthStatus(): Promise<AuthStatus>;
};

export type DashboardService = {
  getDashboard(): Promise<DashboardData>;
  getCalendar(): Promise<CalendarDay[]>;
  syncNow(): Promise<SyncResult>;
  markEpisodeWatched(episodeId: number): Promise<void>;
  markEpisodeUnwatched(episodeId: number): Promise<void>;
  markSubjectEpisodesWatchedThrough(subjectId: number, episodeId: number): Promise<void>;
  addSubjectToWatching(subjectId: number): Promise<SyncResult>;
  searchAnimeSubjects(keyword: string): Promise<AnimeSearchResult[]>;
  dismissEpisode(episodeId: number): Promise<void>;
};

export type OAuthConfigInput = {
  clientId: string;
  clientSecret: string;
};

export type SettingsService = {
  saveOAuthConfig(input: OAuthConfigInput): Promise<void>;
};
