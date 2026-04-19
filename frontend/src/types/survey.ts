export interface SurveyQuestion {
  id: string;
  text: string;
  hint?: string;
  audioUrl?: string;
  type?: "voice" | "photo" | "video"; // defaults to voice
}

export interface Survey {
  id: string;
  code: string;
  title: string;
  description: string;
  ctaLabel: string;
  questions: SurveyQuestion[];
  accentColor?: string;
  isOpen: boolean;
  dashboardCode: string;
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
