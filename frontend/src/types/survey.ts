export interface SurveyQuestion {
  id: string;
  text: string;
  hint?: string;
  audioUrl?: string;
  type?: "voice" | "photo" | "video"; // defaults to voice
}

/** The creator's voice hello, played on the welcome screen. */
export interface SurveyIntro {
  audioUrl: string;
  durationMs: number;
  transcript?: string;
}

export type GroupVisibility = "open" | "private";
export type GroupRole = "owner" | "admin" | "member";

export interface GroupReportSummary {
  available: boolean;
  unlocked: boolean;
  markdown: string | null;
  updatedAt: string | null;
}

export interface Survey {
  id: string;
  code: string;
  title: string;
  description: string;
  ctaLabel: string;
  /** The asks pending for this visitor (all sent rounds minus what they answered). */
  questions: SurveyQuestion[];
  accentColor?: string;
  isOpen: boolean;
  dashboardCode: string;
  intro?: SurveyIntro;
  /** private (default): only the owner, admins and the agent hear raw answers. open: everyone hears everyone, with names. */
  visibility?: GroupVisibility;
  /** Latest sent round. */
  round?: { number: number; kind: "poll" | "probe"; closesAt?: string | null } | null;
  /** Set when the visitor arrived with a valid member token. */
  member?: { role: GroupRole; displayName: string | null; hasAnswered: boolean } | null;
  report?: GroupReportSummary;
  memberCount?: number;
}

export interface VoiceSegment {
  blob?: Blob;
  url?: string;
  durationMs: number;
}

export interface VoiceAnswer {
  questionId: string;
  blob?: Blob;
  url?: string;
  durationMs: number;
  textContent?: string;
  /** Live speech-to-text of a voice answer (creator flow only). */
  transcript?: string;
  segments?: VoiceSegment[];
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  answers: { questionId: string; audioUrl: string; durationMs: number }[];
  phone?: string;
  firstName?: string;
  lastName?: string;
  submittedAt?: string;
}

export interface PublicResult {
  firstName: string;
  answers: { questionId: string; audioUrl: string; durationMs: number }[];
}

// Matches backend DashboardView shape (with audioUrl/imageUrl/videoUrl added by route handler)
export interface DashboardAnswer {
  id: string;
  response_id: string;
  question_id: string;
  audio_r2_key: string;
  image_r2_key: string | null;
  video_r2_key: string | null;
  duration_ms: number;
  audioUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  transcription: string | null;
  transcriptionStatus: string | null;
}

export interface DashboardResponse {
  id: string;
  code: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  submittedAt: string | null;
  answers: DashboardAnswer[];
}

export interface DashboardQuestion {
  id: string;
  survey_id: string;
  sort_order: number;
  text: string;
  hint: string | null;
}

export interface DashboardSurvey {
  id: string;
  code: string;
  dashboard_code: string;
  creator_id: string;
  title: string | null;
  visibility: "open" | "private";
  status: "active" | "paused" | "closed";
  created_at: string;
}

export interface DashboardData {
  survey: DashboardSurvey;
  questions: DashboardQuestion[];
  responses: DashboardResponse[];
  total: number;
  hasMore: boolean;
}
