export type Language = "de-DE" | "en-US";
export type TopicKind = "vocabulary" | "dialogue";
export type Visibility = "private" | "public";
export type SpeechType = "dialogue" | "monologue" | "vocabulary";

export interface User {
  id: number;
  email: string;
  name: string;
  avatarUrl: string;
  /** Only the admin may open the cost page (/usage). */
  isAdmin: boolean;
  createdAt: string;
}

export interface Participant {
  id: number;
  name: string;
  avatarUrl: string;
  lastAt: string;
}

/** A word the user can copy into their pocket. */
export interface VocabCandidate {
  term: string;
  meaning?: string;
  example?: string;
  imageKey?: string;
  imageUrl?: string;
}

export interface Topic {
  id: number;
  title: string;
  description: string;
  language: Language;
  kind: TopicKind;
  visibility: Visibility;
  coverKey: string;
  /** Signed URL of the cover picture ("" if none). */
  coverUrl: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  /** Lines the current user has passed (shadowing). */
  passedCount: number;
  /** Lines the current user has passed in Listen → Write. */
  dictationPassedCount: number;
  /** The current user's latest practice in this topic. */
  lastPracticedAt: string | null;
  ownerName: string;
  isOwner: boolean;
  /** Times anyone finished every line in one session. */
  completions: number;
  /** Gradings + AI generation by everyone. */
  totalCostUsd: number;
}

export interface TopicCost {
  userId: number;
  name: string;
  gradings: number;
  gradingCostUsd: number;
  scriptCostUsd: number;
  ttsCostUsd: number;
  totalCostUsd: number;
}

export interface Recording {
  id: number;
  itemId: number;
  score: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  /** Grading cost of this take. */
  costUsd: number;
  createdAt: string;
}

export interface Item {
  id: number;
  topicId: number;
  position: number;
  speaker: string;
  text: string;
  note: string;
  imageKey: string;
  imageUrl: string;
  recordings: Recording[];
  /** Best Listen → Write result of the current user. */
  dictation: { score: number; passed: boolean } | null;
  /** Present when reference speech is generated (German + OpenAI): whether the clip is already stored. */
  speechCached?: boolean;
}

export interface TopicDetail extends Topic {
  content: string;
  speakers: string[];
  items: Item[];
}

export interface TopicInput {
  title: string;
  description: string;
  language: Language;
  kind: TopicKind;
  visibility: Visibility;
  content: string;
  coverKey?: string;
  /** Picture key per parsed line ("" = none), aligned with the lines of `content`. */
  images?: string[];
  /** From "Tạo bằng AI": links the generation costs to the new topic. */
  generationIds?: number[];
  /** Added to the owner's Vocabulary Pocket on create. */
  vocabulary?: { term: string; meaning: string }[];
}

export interface GenerateRequest {
  language: Language;
  speechType: SpeechType;
  scenario: string;
  vocabulary: string[];
  level: string;
  lines: number;
}

export interface GenerateResult {
  title: string;
  description: string;
  kind: TopicKind;
  content: string;
  vocabulary: { term: string; meaning: string }[];
  usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number };
  generationId: number;
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  level: string;
  visibility: Visibility;
  ownerName: string;
  isOwner: boolean;
  following: boolean;
  topicCount: number;
  followerCount: number;
  updatedAt: string;
  coverUrl: string;
  progress: { topicsDone: number; topicsTotal: number; percent: number };
}

export interface PlaylistDetail extends Playlist {
  topics: Topic[];
  /** The owner's private topics, not visible to the current user. */
  hiddenTopics: number;
}

export interface PlaylistInput {
  name: string;
  description: string;
  level: string;
  visibility: Visibility;
}

export type DictationStatus = "ok" | "case" | "spelling" | "typo" | "wrong" | "missing" | "extra";

export interface DictationResult {
  score: number;
  passed: boolean;
  passScore: number;
  reference: string;
  tokens: { text: string; expected: string; status: DictationStatus }[];
}

export interface SpeechClip {
  url: string;
  cached: boolean;
  voice: string;
  durationMs: number;
  costUsd: number;
  storage: string;
}

export type TokenStatus = "ok" | "mispronounced" | "omitted" | "skip";

export interface Token {
  text: string;
  status: TokenStatus;
  score: number;
}

export interface AssessResult {
  passed: boolean;
  threshold: number;
  scores: { pronScore: number; accuracyScore: number; fluencyScore: number; completenessScore: number };
  tokens: Token[];
  recognized: string;
  recording: Recording | null;
  mock: boolean;
  /** Absent when talking to an older backend build. */
  usage?: GradingUsage;
}

export interface GradingUsage {
  provider: "azure" | "mock";
  audioMs: number;
  latencyMs: number;
  costUsd: number;
}

export interface TranslateResult {
  translations: string[];
  provider: string;
  costUsd: number;
  chars: number;
}

export type CardState = "new" | "learning" | "young" | "mature";
export type Grade = 1 | 2 | 3 | 4; // again, hard, good, easy

export interface VocabEntry {
  id: number;
  language: Language;
  term: string;
  meaning: string;
  example: string;
  topicId: number | null;
  imageKey: string;
  imageUrl: string;
  dueAt: string;
  reviews: number;
  lapses: number;
  ease: number;
  intervalDays: number;
  reps: number;
  state: CardState;
  /** Seconds until due again for each answer. */
  nextIn: { again: number; hard: number; good: number; easy: number };
  createdAt: string;
}

export interface DayStat {
  date: string;
  reviews: number;
  remembered: number;
}

export interface VocabStats {
  total: number;
  dueNow: number;
  states: Record<CardState, number>;
  streak: number;
  bestStreak: number;
  reviewedToday: number;
  minutesToday: number;
  retention30: number | null;
  totalReviews: number;
  totalMinutes: number;
  /** Last 30 days, oldest first. */
  days: DayStat[];
  /** Next 7 days; `reviews` = cards due that day (today includes overdue). */
  forecast: DayStat[];
}

export interface Scenario {
  title: string;
  setting: string;
  partner: string;
  userRole: string;
  goal: string;
  opening: string;
  openingVi: string;
  usefulWords: { term: string; meaning: string }[];
}

export interface SimulationTurn {
  id: number;
  round: number;
  speaker: "ai" | "user";
  text: string;
  translation: string;
  hasAudio: boolean;
  typed: boolean;
  pronScore: number | null;
  accuracy: number | null;
  fluency: number | null;
  logicScore: number | null;
  evaluation: {
    feedback: string;
    corrected: string;
    grammarNote: string;
    understood: boolean;
    words?: Token[];
    cost: Record<string, number>;
  } | null;
  costUsd: number;
  createdAt: string;
}

export interface SimulationSummary {
  rounds: number;
  avgPron: number | null;
  avgLogic: number | null;
  durationSec: number;
  overall?: number;
  goalReached?: boolean;
  cefr?: string;
  strengths?: string[];
  improvements?: string[];
  usefulPhrases?: { phrase: string; meaning: string }[];
  verdict?: string;
}

export interface Simulation {
  id: number;
  language: Language;
  level: string;
  scenario: Scenario;
  status: "active" | "finished";
  maxRounds: number;
  summary: SimulationSummary | null;
  createdAt: string;
  finishedAt: string | null;
  userTurns: number;
  avgPron: number;
  avgLogic: number;
  costUsd: number;
}

export interface SimulationDetail extends Simulation {
  turns: SimulationTurn[];
  costs: { speechUsd: number; llmUsd: number; ttsUsd: number; totalUsd: number; tokens: number; audioSeconds: number };
  voiceGenerated: boolean;
}

export interface VocabInput {
  language: Language;
  term: string;
  meaning: string;
  example: string;
  topicId?: number | null;
  imageKey?: string;
}

export interface UsagePeriod {
  since: string;
  gradings: number;
  passed: number;
  audioSeconds: number;
  gradingCostUsd: number;
  translationCalls: number;
  translationChars: number;
  translationCostUsd: number;
}

export interface RecentAssessment {
  id: number;
  provider: string;
  audioMs: number;
  latencyMs: number;
  pronScore: number;
  passed: boolean;
  costUsd: number;
  createdAt: string;
  itemText: string;
  topicTitle: string;
}

export interface UsageReport {
  month: UsagePeriod;
  allTime: UsagePeriod;
  recent: RecentAssessment[];
  monthAi: AIUsagePeriod;
  allTimeAi: AIUsagePeriod;
  pricing: {
    assessUsdPerHour: number;
    translatorUsdPerMChar: number;
    translator: string;
    chatModel: string;
    chatUsdPerMInput: number;
    chatUsdPerMOutput: number;
    ttsModel: string;
    ttsUsdPerMinute: number;
    storage: string;
  };
}

export interface AIUsagePeriod {
  scripts: number;
  scriptCostUsd: number;
  ttsClips: number;
  ttsAudioSeconds: number;
  ttsCostUsd: number;
  images: number;
  imageCostUsd: number;
  simulationCostUsd: number;
}

export interface Health {
  ok: boolean;
  azure: boolean;
  passThreshold: number;
  translator: string;
  assessUsdPerHour: number;
  translatorUsdPerM: number;
  openaiScript: boolean;
  openaiTts: boolean;
  storage: string;
  simulations: boolean;
  imageGeneration: boolean;
}

export const LANGUAGES: Record<Language, { label: string; flag: string }> = {
  "de-DE": { label: "Tiếng Đức", flag: "🇩🇪" },
  "en-US": { label: "Tiếng Anh", flag: "🇺🇸" },
};

/** Backend origin when the frontend is hosted elsewhere (Vercel); "" = same origin / Vite proxy. */
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const TOKEN_KEY = "dfs.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason, e.g. "needs_public" (see details). */
    public code = "",
    public details: string[] = [],
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText;
    let code = "";
    let details: string[] = [];
    try {
      const body = JSON.parse(await res.text());
      if (body?.error) msg = body.error;
      if (body?.code) code = body.code;
      if (Array.isArray(body?.details)) details = body.details;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, msg, code, details);
  }
  return res;
}

/** File name from a Content-Disposition header (RFC 6266 / 5987). */
function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:utf-8|UTF-8)''([^;]+)/.exec(header);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/.exec(header);
  return plain ? plain[1] : null;
}

/** Hands a blob to the browser as a file download. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function download(path: string, fallbackName: string) {
  const res = await request(path);
  saveBlob(await res.blob(), dispositionName(res.headers.get("Content-Disposition")) ?? fallbackName);
}

async function json<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await request(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  health: () => json<Health>("/health"),
  register: (email: string, password: string, name: string) =>
    json<{ token: string; user: User }>("/auth/register", "POST", { email, password, name }),
  login: (email: string, password: string) =>
    json<{ token: string; user: User }>("/auth/login", "POST", { email, password }),
  me: () => json<User>("/me"),
  setAvatar: async (file: File) => {
    const form = new FormData();
    form.append("image", file);
    return (await request("/me/avatar", { method: "PUT", body: form })).json() as Promise<User>;
  },
  removeAvatar: () => json<User>("/me/avatar", "DELETE"),
  topicParticipants: (id: number) => json<Participant[]>(`/topics/${id}/participants`),
  playlistParticipants: (id: number) => json<Participant[]>(`/playlists/${id}/participants`),
  /** The topic owner's word list for the topic. */
  topicVocabulary: (id: number) => json<VocabCandidate[]>(`/topics/${id}/vocabulary`),
  /** Adds several words; missing meanings are translated, existing terms skipped. */
  bulkAddVocab: (language: Language, topicId: number | null, items: VocabCandidate[]) =>
    json<{ added: VocabEntry[]; skipped: string[] }>("/vocab/bulk", "POST", { language, topicId, items }),

  listTopics: () => json<Topic[]>("/topics"),
  getTopic: (id: number) => json<TopicDetail>(`/topics/${id}`),
  createTopic: (input: TopicInput) => json<Topic>("/topics", "POST", input),
  updateTopic: (id: number, input: TopicInput) => json<Topic>(`/topics/${id}`, "PUT", input),
  deleteTopic: (id: number) => json<void>(`/topics/${id}`, "DELETE"),
  publicTopics: () => json<Topic[]>("/topics/public"),
  setVisibility: (id: number, visibility: Visibility) => json<Topic>(`/topics/${id}/visibility`, "PATCH", { visibility }),
  completeTopic: (id: number) => json<Topic>(`/topics/${id}/complete`, "POST"),
  topicCosts: (id: number) => json<TopicCost[]>(`/topics/${id}/costs`),
  generateScript: (req: GenerateRequest) => json<GenerateResult>("/generate/script", "POST", req),
  gradeDictation: (itemId: number, answer: string) => json<DictationResult>(`/items/${itemId}/dictation`, "POST", { answer }),
  uploadImage: async (file: File) => {
    const form = new FormData();
    form.append("image", file);
    return (await request("/images", { method: "POST", body: form })).json() as Promise<{ key: string; url: string }>;
  },

  myPlaylists: () => json<Playlist[]>("/playlists"),
  publicPlaylists: () => json<Playlist[]>("/playlists/public"),
  getPlaylist: (id: number) => json<PlaylistDetail>(`/playlists/${id}`),
  createPlaylist: (input: PlaylistInput) => json<Playlist>("/playlists", "POST", input),
  /** makePublic confirms publishing private topics of a playlist that becomes public. */
  updatePlaylist: (id: number, input: PlaylistInput, makePublic = false) => json<Playlist>(`/playlists/${id}`, "PUT", { ...input, makePublic }),
  deletePlaylist: (id: number) => json<void>(`/playlists/${id}`, "DELETE"),
  /** makePublic confirms publishing a private topic added to a public playlist. */
  addToPlaylist: (id: number, topicId: number, makePublic = false) => json<void>(`/playlists/${id}/topics`, "POST", { topicId, makePublic }),
  removeFromPlaylist: (id: number, topicId: number) => json<void>(`/playlists/${id}/topics/${topicId}`, "DELETE"),
  reorderPlaylist: (id: number, topicIds: number[]) => json<void>(`/playlists/${id}/order`, "PUT", { topicIds }),
  followPlaylist: (id: number, follow: boolean) => json<void>(`/playlists/${id}/follow`, follow ? "POST" : "DELETE"),
  /** Ids of the user's own playlists that contain the topic. */
  topicPlaylists: (topicId: number) => json<number[]>(`/topics/${topicId}/playlists`),

  /** Generated reference speech (German + OpenAI); creates and stores it on first use. */
  speech: (itemId: number) => json<SpeechClip>(`/items/${itemId}/speech`, "POST"),

  assess: async (itemId: number, wav: Blob) => {
    const form = new FormData();
    form.append("audio", wav, "recording.wav");
    return (await request(`/items/${itemId}/assess`, { method: "POST", body: form })).json() as Promise<AssessResult>;
  },
  recordingAudio: async (id: number) => (await request(`/recordings/${id}/audio`)).blob(),
  downloadRecording: (id: number) => download(`/recordings/${id}/audio?download=1`, `recording-${id}.wav`),
  downloadTopicRecordings: (topicId: number) => download(`/topics/${topicId}/recordings.zip`, `topic-${topicId}-recordings.zip`),
  deleteRecording: (id: number) => json<void>(`/recordings/${id}`, "DELETE"),

  /** Vietnamese translations (cached server-side), same order as texts. */
  translate: (language: Language, texts: string[]) => json<TranslateResult>("/translate", "POST", { language, texts }),
  usage: () => json<UsageReport>("/usage"),

  listVocab: () => json<VocabEntry[]>("/vocab"),
  createVocab: (input: VocabInput) => json<VocabEntry>("/vocab", "POST", input),
  updateVocab: (id: number, input: VocabInput) => json<VocabEntry>(`/vocab/${id}`, "PUT", input),
  deleteVocab: (id: number) => json<void>(`/vocab/${id}`, "DELETE"),
  reviewVocab: (id: number, grade: Grade, durationMs: number) => json<VocabEntry>(`/vocab/${id}/review`, "POST", { grade, durationMs }),
  /** Draws a picture for the card with AI (paid). */
  generateVocabImage: (id: number) => json<{ entry: VocabEntry; costUsd: number }>(`/vocab/${id}/image`, "POST"),
  vocabStats: () => json<VocabStats>(`/vocab/stats?tz=${-new Date().getTimezoneOffset()}`),

  simulations: () => json<Simulation[]>("/simulations"),
  getSimulation: (id: number) => json<SimulationDetail>(`/simulations/${id}`),
  startSimulation: (language: Language, level: string, hint: string) => json<SimulationDetail>("/simulations", "POST", { language, level, hint }),
  /** Sends the learner's turn: a WAV recording, or typed text. */
  simulationTurn: async (id: number, input: { audio?: Blob; text?: string }) => {
    const form = new FormData();
    if (input.audio) form.append("audio", input.audio, "turn.wav");
    if (input.text) form.append("text", input.text);
    return (await request(`/simulations/${id}/turns`, { method: "POST", body: form })).json() as Promise<SimulationDetail>;
  },
  finishSimulation: (id: number) => json<SimulationDetail>(`/simulations/${id}/finish`, "POST"),
  turnSpeech: (simId: number, turnId: number) => json<SpeechClip>(`/simulations/${simId}/turns/${turnId}/speech`, "POST"),
};
