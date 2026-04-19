// ── Cloudflare Bindings ──

export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  KV: KVNamespace;
  WHATSAPP_VERIFY_TOKEN: string;
  KAPSO_API_KEY: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  POSTHOG_API_KEY?: string;
  LINKEDIN_CLIENT_ID: string;
  LINKEDIN_CLIENT_SECRET: string;
  AI: any;
}

// ── Database Row Types ──

export interface Creator {
  id: string;
  phone: string | null;
  wa_name: string | null;
  api_key: string | null;
  created_at: string;
  linkedin_sub: string | null;
  linkedin_name: string | null;
  linkedin_email: string | null;
  linkedin_photo_url: string | null;
  linkedin_connected_at: string | null;
}

export interface Survey {
  id: string;
  code: string;
  dashboard_code: string;
  creator_id: string;
  title: string | null;
  visibility: "open" | "private";
  status: "active" | "paused" | "closed";
  created_at: string;
}

export interface SurveyAudio {
  id: string;
  survey_id: string;
  question_key: string;
  audio_r2_key: string;
  duration_ms: number;
}

export interface SurveyQuestion {
  id: string;
  survey_id: string;
  sort_order: number;
  text: string;
  hint: string | null;
  question_type: "voice" | "photo" | "video";
}

export interface Response {
  id: string;
  code: string;
  survey_id: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  status: "in_progress" | "submitted";
  submitted_at: string | null;
}

export interface ResponseAnswer {
  id: string;
  response_id: string;
  question_id: string;
  audio_r2_key: string;
  image_r2_key: string | null;
  video_r2_key: string | null;
  duration_ms: number;
  transcription: string | null;
  transcription_status: string;
}

// ── API Request / Response Types ──

export interface CreateSurveyRequest {
  title?: string;
  creatorPhone?: string;
  creatorName?: string;
}

export interface CreateSurveyResponse {
  id: string;
  code: string;
  dashboardCode: string;
  apiKey: string;
  uploadUrls: {
    audience: string;
    gather: string;
  };
}

export interface GenerateSurveyRequest {
  textAnswers?: {
    audience?: string;
    gather?: string;
  };
}

export interface GenerateSurveyResponse {
  title: string;
  questions: {
    text: string;
    hint: string;
    type?: "voice" | "photo" | "video";
  }[];
}

export interface StartResponseRequest {
  // Empty — just starts a response session
}

export interface StartResponseResponse {
  id: string;
  code: string;
  uploadUrls: Record<string, string>;
}

export interface SubmitResponseRequest {
  phone?: string;
  firstName?: string;
  lastName?: string;
}

export interface SurveyPublicView {
  id: string;
  title: string | null;
  status: string;
  questions: SurveyQuestion[];
  audioKeys: { questionKey: string; audioR2Key: string }[];
}

export interface DashboardView {
  survey: Survey;
  questions: SurveyQuestion[];
  responses: {
    id: string;
    code: string;
    status: string;
    firstName: string | null;
    lastName: string | null;
    submittedAt: string | null;
    answers: ResponseAnswer[];
  }[];
}

export interface PublicResultsView {
  survey: {
    id: string;
    title: string | null;
    status: string;
  };
  questions: SurveyQuestion[];
  responseCount: number;
}

// ── WhatsApp Types ──

export interface WhatsAppMessage {
  from: string;
  type: string;
  text?: { body: string };
  timestamp: string;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: {
    id: string;
    changes: {
      value: {
        messages?: WhatsAppMessage[];
        contacts?: { profile: { name: string }; wa_id: string }[];
      };
      field: string;
    }[];
  }[];
}
