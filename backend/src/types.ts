// ── Cloudflare Bindings ──

export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  KV: KVNamespace;
  /** One GroupAgent Durable Object per parlo; instance name = survey id. */
  GROUP_AGENT: DurableObjectNamespace<import("./agent/GroupAgent").GroupAgent>;
  WHATSAPP_VERIFY_TOKEN: string;
  KAPSO_API_KEY: string;
  KAPSO_WEBHOOK_SECRET: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  POSTHOG_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  /** Optional: when set, the group agent's planning loop runs on Claude. */
  ANTHROPIC_API_KEY?: string;
  LINKEDIN_CLIENT_ID: string;
  LINKEDIN_CLIENT_SECRET: string;
  /** Firebase project whose ID tokens prove a phone number (`aud` claim). */
  FIREBASE_PROJECT_ID: string;
  /** Public origin of this API, for OAuth callbacks (wrangler dev reports the custom domain, see pitfall 20). */
  API_ORIGIN?: string;
  /** Where the web app lives, for redirects back after OAuth. */
  FRONTEND_ORIGIN?: string;
  /**
   * Rewards (services/tremendous.ts). Without a key rewards are still
   * recorded and approved; they wait as "owed" until one is set.
   */
  TREMENDOUS_API_KEY?: string;
  /** "production" to spend real money; anything else is the sandbox. */
  TREMENDOUS_ENV?: string;
  /** Overrides the API base (tests point it at a local stand-in). */
  TREMENDOUS_API_BASE?: string;
  /** The campaign whose catalogue recipients choose from; else the account's first campaign. */
  TREMENDOUS_CAMPAIGN_ID?: string;
  /** Defaults to BALANCE. */
  TREMENDOUS_FUNDING_SOURCE_ID?: string;
  AI: any;
}

// ── Database Row Types ──

/** One identity for everyone — creators, admins and members alike. */
export interface User {
  id: string;
  phone: string | null;
  wa_name: string | null;
  first_name: string | null;
  last_name: string | null;
  api_key: string | null;
  created_at: string;
  linkedin_sub: string | null;
  linkedin_name: string | null;
  linkedin_email: string | null;
  linkedin_photo_url: string | null;
  linkedin_photo_r2_key: string | null;
  linkedin_connected_at: string | null;
  email?: string | null;
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
  brief?: string | null;
  brief_clarifications?: string | null;
  /** Creator's voice hello, played on the participant welcome screen. */
  intro_r2_key?: string | null;
  intro_duration_ms?: number | null;
  intro_transcript?: string | null;
  /** Mirror of the group agent's /report.md so members can read it from D1. */
  report_md?: string | null;
  report_updated_at?: string | null;
  /** The third chip row's pick (services/shapes.ts TIMINGS); null = no row or an older parlo. */
  timing?: string | null;
  /** Who, besides the research team, hears the answers; null = not a sponsored study. */
  sponsor_name?: string | null;
  /** 'study' when the parlo is run as a research study; null = a group parlo. */
  kind?: string | null;
  /** Default price per touch for new rounds, in cents. */
  reward_cents?: number | null;
  /** The study's reward cap, in cents; null = no cap. */
  reward_budget_cents?: number | null;
  reward_currency?: string | null;
}

// ── Groups ──

/**
 * `owner` and `admin` are the research team (they manage). `client` is the
 * company that commissioned a study: hears raw answers, shapes the brief and
 * steers, never approves a round or manages members. `member` is a participant.
 */
export type GroupRole = "owner" | "admin" | "client" | "member";
export type GroupVisibility = "open" | "private";

export interface GroupMember {
  survey_id: string;
  user_id: string;
  role: GroupRole;
  access_token: string;
  joined_at: string;
  invited_by: string | null;
  removed_at: string | null;
  /** Which group of participants they belong to ("Customer", "Competitor user"). */
  segment?: string | null;
  /** One line a researcher knows about them. */
  descriptor?: string | null;
}

export type RoundKind = "poll" | "probe";
export type RoundStatus = "proposed" | "sent" | "rejected" | "closed";

export interface Round {
  id: string;
  survey_id: string;
  number: number;
  kind: RoundKind;
  status: RoundStatus;
  rationale: string | null;
  proposed_by: string;
  created_at: string;
  sent_at: string | null;
  /** When a sent round stops taking answers (ISO); null = open-ended. */
  closes_at?: string | null;
  /** When the close actually ran (ISO). */
  closed_at?: string | null;
  /** JSON array of the brief item ids this round digs into. */
  serves?: string | null;
  /** 'testimonial': asks named people for a line meant for public use, under a notice, for a bonus. */
  purpose?: string | null;
  /** What this round pays for an accepted answer, in cents; null or 0 = unpaid. */
  reward_cents?: number | null;
}

export interface SurveyIntro {
  audioUrl: string;
  durationMs: number;
  transcript: string | null;
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
  /** Which round this ask belongs to (round 1 = the original question set). */
  round_id?: string | null;
  /** Null = asked of everyone; otherwise a probe aimed at one member. */
  target_user_id?: string | null;
  /** The round's purpose, when asks are listed for a participant: 'testimonial' or null. */
  round_purpose?: string | null;
  /** What the ask's round pays, when listed for a signed-in member (a testimonial's bonus). */
  round_reward_cents?: number | null;
}

export interface Response {
  id: string;
  code: string;
  survey_id: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  status: "in_progress" | "submitted" | "notified";
  submitted_at: string | null;
  user_id?: string | null;
  round_id?: string | null;
  /** The group's visibility when this was submitted — never loosened later. */
  visibility_at_submit?: GroupVisibility | null;
  /** 1 when submitted under a consent line naming the sponsor; the client only hears those. */
  sponsor_consent?: number | null;
  /** What the participant allowed beyond the study: none | quote | voice. */
  publish_consent?: PublishConsent | null;
}

/** none: nothing leaves the study. quote: words may be quoted publicly, unnamed. voice: the recording may be used too. */
export type PublishConsent = "none" | "quote" | "voice";

export function asPublishConsent(value: unknown): PublishConsent {
  return value === "quote" || value === "voice" ? value : "none";
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
    /** Agent brief flow: the creator's single free-form recording. */
    brief: string;
    /** Legacy two-question flow (kept for the MCP server / old clients). */
    audience: string;
    gather: string;
  };
}

export interface Clarification {
  question: string;
  answer: string;
}

export interface GenerateSurveyRequest {
  /**
   * Output-first flow (current): the shape of what should come back, who the
   * group is, how long it should take, and the one blank the creator filled.
   * The route composes the brief from these (services/shapes.ts).
   */
  shape?: string;
  audience?: string;
  length?: string;
  /** Optional since 2026-10-25; the creation screen no longer has a blank. */
  topic?: string;
  /** Free-form brief ("Something else") — when present without `shape`, used as is. */
  brief?: string;
  /** What the agent should make beyond the report (ids from services/outputs.ts). */
  outputs?: string[];
  /** The third chip row's pick (ids from services/shapes.ts TIMINGS); ignored for shapes without a row. */
  timing?: string;
  clarifications?: Clarification[];
  /** Legacy two-question flow. */
  textAnswers?: {
    audience?: string;
    gather?: string;
  };
}

export interface BriefEvaluateRequest {
  transcript: string;
}

export interface BriefEvaluateResponse {
  items: { id: string; satisfied: boolean; probability: number }[];
  complete: boolean;
  provider: string;
  model: string | null;
}

export interface ClarifyRequest {
  brief: string;
  history: Clarification[];
}

export interface ClarifyResponse {
  question: string;
  hint: string | null;
  /** 1-based position of this question in the clarification sequence. */
  index: number;
}

export interface TranscribeResponse {
  text: string;
}

export interface GenerateSurveyResponse {
  title: string;
  questions: {
    text: string;
    hint: string;
    type?: "voice" | "photo" | "video";
  }[];
  /** The brief the questions were built from (composed from the taps in the output-first flow). */
  brief: string;
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
  /** Display only — identity comes from the API key, `idToken` or `proof`. */
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Firebase ID token from this session's SMS OTP. */
  idToken?: string;
  /** Proof token from POST /api/otp/verify-whatsapp. */
  proof?: string;
  /** A study's consent screen: may these words (or this voice) be used in public material? Default none. */
  publishConsent?: string;
  /** Ids of testimonial asks this client showed with their marketing notice before recording. Only these are stamped as consented for public use. */
  testimonialAck?: string[];
}

export interface SurveyPublicView {
  id: string;
  title: string | null;
  status: string;
  /** The asks still pending for this visitor (all sent rounds, minus what they answered). */
  questions: SurveyQuestion[];
  audioKeys: { questionKey: string; audioR2Key: string }[];
  /** Null until the creator records one. */
  intro: SurveyIntro | null;
  visibility: GroupVisibility;
  /** Latest sent round, if any. */
  round: { number: number; kind: RoundKind; closesAt: string | null } | null;
  /** Set when the visitor carried a valid member token. */
  member: { role: GroupRole; displayName: string | null; hasAnswered: boolean } | null;
  /** The agent's report. `markdown` is only filled once the visitor has answered. */
  report: { available: boolean; unlocked: boolean; markdown: string | null; updatedAt: string | null };
  memberCount: number;
  /** Set on a sponsored study: who else hears the answers (for the consent line). */
  sponsor: { name: string } | null;
  /** What answering now pays this visitor; null for anyone who did not arrive by a personal link. */
  reward: { amountCents: number; currency: string } | null;
  /** A research study: the page drops its group furniture and asks for publication consent. */
  study: boolean;
  /** Shown on a testimonial ask: who may use the recording, in a sentence. */
  testimonialNotice: string;
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
