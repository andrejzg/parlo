import { useQuery, useMutation } from "@tanstack/react-query";
import type { Survey, DashboardData, PublicResult } from "@/types/survey";
import { getMediaMix } from "@/lib/mediaMix";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Mutations ──────────────────────────────────────────────────────────

export interface CreateSurveyResponse {
  id: string;
  code: string;
  dashboardCode: string;
  uploadUrls: { brief: string; audience: string; gather: string };
}

export function useCreateSurvey() {
  return useMutation({
    mutationFn: () =>
      apiFetch<CreateSurveyResponse>("/surveys", { method: "POST" }),
  });
}

// ── Agent brief flow ──────────────────────────────────────────────────

export interface Clarification {
  question: string;
  answer: string;
}

export interface BriefEvaluation {
  items: { id: string; satisfied: boolean; probability: number }[];
  complete: boolean;
  provider: string;
  model: string | null;
}

/** Which brief-checklist items does this transcript cover? (TypeSafe Jev) */
export function evaluateBrief(surveyId: string, transcript: string) {
  return apiFetch<BriefEvaluation>(`/surveys/${surveyId}/brief/evaluate`, {
    method: "POST",
    body: JSON.stringify({ transcript }),
  });
}

export interface ClarifyingQuestion {
  question: string;
  hint: string | null;
  index: number;
}

/** Ask Cerebras for the next clarifying question given everything so far. */
export function fetchClarifyingQuestion(surveyId: string, brief: string, history: Clarification[]) {
  return apiFetch<ClarifyingQuestion>(`/surveys/${surveyId}/clarify`, {
    method: "POST",
    body: JSON.stringify({ brief, history }),
  });
}

/** Whisper transcription of a creator recording (fallback when Web Speech is unavailable). */
export async function transcribeAudio(surveyId: string, blob: Blob): Promise<string> {
  const res = await fetch(`${API_BASE}/surveys/${surveyId}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text ?? "";
}

export interface GeneratedQuestion {
  id?: string;
  text: string;
  hint?: string;
  type?: "voice" | "photo" | "video";
}

export interface GenerateQuestionsResponse {
  title?: string;
  questions: GeneratedQuestion[];
}

export interface GenerateQuestionsInput {
  surveyId: string;
  /** Agent brief flow: the creator's transcribed brief + clarifying Q&A. */
  brief?: string;
  clarifications?: Clarification[];
  /** Legacy two-question flow. */
  textAnswers?: { questionId: string; text: string }[];
}

export function useGenerateQuestions() {
  return useMutation({
    mutationFn: ({ surveyId, brief, clarifications, textAnswers }: GenerateQuestionsInput) => {
      let body: string | undefined;
      if (brief?.trim()) {
        body = JSON.stringify({ brief: brief.trim(), clarifications: clarifications ?? [] });
      } else if (textAnswers?.length) {
        // Legacy: map frontend question IDs to backend field names.
        const mapped: Record<string, string> = {};
        for (const ta of textAnswers) {
          if (ta.questionId === "cq1" || ta.questionId === "audience") mapped.audience = ta.text;
          else if (ta.questionId === "cq3" || ta.questionId === "gather") mapped.gather = ta.text;
        }
        body = JSON.stringify({ textAnswers: mapped });
      }
      return apiFetch<GenerateQuestionsResponse>(`/surveys/${surveyId}/generate`, {
        method: "POST",
        body,
      });
    },
  });
}

export function useUpdateQuestions() {
  return useMutation({
    mutationFn: ({
      surveyId,
      questions,
    }: {
      surveyId: string;
      questions: {
        text: string;
        hint?: string;
        type?: "voice" | "photo" | "video";
      }[];
    }) =>
      apiFetch(`/surveys/${surveyId}/questions`, {
        method: "PUT",
        body: JSON.stringify({ questions }),
      }),
  });
}

// ── Creator voice intro ───────────────────────────────────────────────

/** Fresh one-time upload URL for `surveys/{id}/intro.webm` (the creation-time URLs expire after 10 min). */
export async function fetchIntroUploadUrl(surveyId: string): Promise<string> {
  const data = await apiFetch<{ uploadUrl: string }>(`/surveys/${surveyId}/intro/upload-url`, {
    method: "POST",
  });
  return data.uploadUrl;
}

/** Tell the backend the intro landed in R2 so it shows up for participants. */
export function saveIntro(surveyId: string, durationMs: number) {
  return apiFetch<{ success: true; durationMs: number }>(`/surveys/${surveyId}/intro`, {
    method: "PUT",
    body: JSON.stringify({ durationMs }),
  });
}

export function loginByPhone(phone: string) {
  return apiFetch<{ apiKey: string | null; creatorId?: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function claimSurvey(surveyId: string, phone: string) {
  return apiFetch<{ ok: boolean; apiKey: string | null }>(`/surveys/${surveyId}/claim`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export type GroupRole = "owner" | "admin" | "member";
export type GroupVisibility = "open" | "private";

export interface MySurvey {
  id: string;
  code: string;
  /** Empty for plain members — they never see raw answers. */
  dashboardCode: string;
  title: string | null;
  status: string;
  visibility?: GroupVisibility;
  createdAt: string;
  /** Your role in this parlo. */
  role?: GroupRole;
  /** Your personal-link token for /s/:code?t= */
  memberToken?: string;
  questionCount: number;
  memberCount?: number;
  responseCount: number;
  newCount?: number;
  latestResponseAt?: string | null;
  reportUpdatedAt?: string | null;
  /** First line of prose from the agent's report, for the row preview. */
  reportPreview?: string | null;
  /** Newest of: created, last answer, report, a later round sent, a proposal. The list sorts by it. */
  lastActivityAt?: string;
  /** The latest sent round and how it is going. `targets` is 0 when there is no fixed audience (round 1). */
  round?: { number: number; kind: ParloRoundKind; sentAt: string | null; answered: number; targets: number } | null;
  /** A round the agent planned that still needs approval. Owner/admin only. */
  proposedRound?: { number: number; kind: ParloRoundKind; createdAt: string } | null;
  /** Asks waiting for this viewer. Members only; always 0 for owner/admin. */
  pendingAsks?: number;
  /** Up to three other members, for the avatar cluster. */
  faces?: ParloFace[];
}

export type ParloRoundKind = "poll" | "probe";

export interface ParloFace {
  userId: string;
  name: string | null;
  /** Stable `GET /api/users/:id/photo` URL, or null when they have no photo. */
  photoUrl: string | null;
}

export function fetchMySurveys(apiKey: string) {
  return apiFetch<{ surveys: MySurvey[] }>("/my/surveys", {
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

export interface SurveyMember {
  userId: string;
  role: GroupRole;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  linkedinName: string | null;
  linkedinPhotoUrl: string | null;
  linkedinEmail: string | null;
  joinedAt: string;
  responseCount: number;
}

export function fetchSurveyMembers(apiKey: string, surveyId: string) {
  return apiFetch<{ members: SurveyMember[]; you: { userId: string; role: GroupRole } }>(`/my/surveys/${surveyId}/members`, {
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

// ── Groups: roles, settings ──────────────────────────────────────────

function authed(apiKey: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { "X-Parlo-Api-Key": apiKey, ...(init.headers ?? {}) } };
}

export function setMemberRole(apiKey: string, surveyId: string, userId: string, role: "admin" | "member") {
  return apiFetch<{ ok: boolean }>(`/my/surveys/${surveyId}/members/${userId}/role`, authed(apiKey, { method: "POST", body: JSON.stringify({ role }) }));
}

export function removeMember(apiKey: string, surveyId: string, userId: string) {
  return apiFetch<{ ok: boolean }>(`/my/surveys/${surveyId}/members/${userId}`, authed(apiKey, { method: "DELETE" }));
}

export function transferOwnership(apiKey: string, surveyId: string, userId: string) {
  return apiFetch<{ ok: boolean }>(`/my/surveys/${surveyId}/transfer`, authed(apiKey, { method: "POST", body: JSON.stringify({ userId }) }));
}

export function updateGroupSettings(apiKey: string, surveyId: string, settings: { visibility?: GroupVisibility; title?: string }) {
  return apiFetch<{ ok: boolean; visibility: GroupVisibility; title: string | null }>(`/my/surveys/${surveyId}/settings`, authed(apiKey, { method: "PUT", body: JSON.stringify(settings) }));
}

// ── Groups: the agent & rounds ───────────────────────────────────────

export type RoundKind = "poll" | "probe";
export type RoundStatus = "proposed" | "sent" | "rejected" | "closed";

export interface RoundAsk {
  id: string;
  text: string;
  hint: string | null;
  type: "voice" | "photo" | "video";
  sortOrder: number;
  targetUserId: string | null;
  targetName: string | null;
}

export interface GroupRound {
  id: string;
  survey_id: string;
  number: number;
  kind: RoundKind;
  status: RoundStatus;
  rationale: string | null;
  proposed_by: string;
  created_at: string;
  sent_at: string | null;
  asks: RoundAsk[];
}

export interface AgentState {
  surveyId: string | null;
  title: string | null;
  answersIngested: number;
  ingestedSinceDigest: number;
  lastIngestAt: string | null;
  lastDigestAt: string | null;
  lastProposalAt: string | null;
  lastError: string | null;
  provider: string | null;
  model: string | null;
}

export interface AgentSnapshot {
  state: AgentState;
  files: { path: string; updatedAt: string; bytes: number }[];
  report: string | null;
  reportUpdatedAt: string | null;
  memory: string | null;
  rounds: GroupRound[];
  visibility: GroupVisibility;
}

export function fetchAgent(apiKey: string, surveyId: string) {
  return apiFetch<AgentSnapshot>(`/my/surveys/${surveyId}/agent`, authed(apiKey));
}

export function runAgentDigest(apiKey: string, surveyId: string) {
  return apiFetch<{ ok: boolean; report: string | null; answersRead: number; provider: string; model: string; error?: string }>(
    `/my/surveys/${surveyId}/agent/digest`,
    authed(apiKey, { method: "POST" }),
  );
}

export function fetchAgentFile(apiKey: string, surveyId: string, path: string) {
  return apiFetch<{ path: string; content: string; updatedAt: string }>(`/my/surveys/${surveyId}/agent/file?path=${encodeURIComponent(path)}`, authed(apiKey));
}

export function proposeRound(apiKey: string, surveyId: string, input: { kind?: RoundKind; hint?: string } = {}) {
  return apiFetch<{ round: GroupRound }>(`/my/surveys/${surveyId}/rounds/propose`, authed(apiKey, { method: "POST", body: JSON.stringify(input) }));
}

export function approveRound(apiKey: string, surveyId: string, roundId: string) {
  return apiFetch<{ ok: boolean; round: GroupRound; notified: number }>(`/my/surveys/${surveyId}/rounds/${roundId}/approve`, authed(apiKey, { method: "POST" }));
}

export function rejectRound(apiKey: string, surveyId: string, roundId: string) {
  return apiFetch<{ ok: boolean }>(`/my/surveys/${surveyId}/rounds/${roundId}/reject`, authed(apiKey, { method: "POST" }));
}

export function updateRoundAsks(apiKey: string, surveyId: string, roundId: string, asks: { id: string; text: string }[]) {
  return apiFetch<{ round: GroupRound }>(`/my/surveys/${surveyId}/rounds/${roundId}`, authed(apiKey, { method: "PUT", body: JSON.stringify({ asks }) }));
}

// ── Groups: member-facing (personal link) ────────────────────────────

export interface GroupReport {
  available: boolean;
  unlocked: boolean;
  markdown: string | null;
  updatedAt: string | null;
  role?: GroupRole;
}

export function fetchGroupReport(code: string, token: string) {
  return apiFetch<GroupReport>(`/s/${code}/report?t=${encodeURIComponent(token)}`);
}

export interface GroupFeedItem {
  id: string;
  responseId: string;
  userId: string | null;
  name: string;
  submittedAt: string | null;
  roundNumber: number;
  questionId: string;
  questionText: string;
  questionType: string;
  durationMs: number;
  transcription: string | null;
  transcriptionStatus: string;
  audioUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
}

export function fetchGroupFeed(code: string, token: string) {
  return apiFetch<{ items: GroupFeedItem[] }>(`/s/${code}/feed?t=${encodeURIComponent(token)}`);
}

export function deleteSurvey(apiKey: string, surveyId: string) {
  return apiFetch<{ ok: boolean }>(`/my/surveys/${surveyId}`, {
    method: "DELETE",
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

export interface StartResponseResult {
  id: string;
  code: string;
  uploadUrls: Record<string, string>;
}

export function useStartResponse() {
  return useMutation({
    mutationFn: ({ code, token }: { code: string; token?: string | null }) =>
      apiFetch<StartResponseResult>(`/s/${code}/responses${token ? `?t=${encodeURIComponent(token)}` : ""}`, {
        method: "POST",
      }),
  });
}

export interface SubmitResponsePayload {
  responseId: string;
  phone: string;
}

export interface SubmitResponseResult {
  success: boolean;
  id: string;
  /** Your personal-link token for this parlo — answering is joining. */
  memberToken: string | null;
  visibility: GroupVisibility;
}

export function useSubmitResponse() {
  return useMutation({
    mutationFn: ({ responseId, ...body }: SubmitResponsePayload) =>
      apiFetch<SubmitResponseResult>(`/responses/${responseId}/submit`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

// ── WhatsApp OTP ─────────────────────────────────────────────────────

export async function sendWhatsAppOtp(phone: string): Promise<{ sent: boolean }> {
  return apiFetch<{ sent: boolean }>("/otp/send-whatsapp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function verifyWhatsAppOtp(phone: string, code: string): Promise<{ verified: boolean }> {
  return apiFetch<{ verified: boolean }>("/otp/verify-whatsapp", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export async function refreshUploadUrls(responseId: string): Promise<Record<string, string>> {
  const data = await apiFetch<{ uploadUrls: Record<string, string> }>(
    `/responses/${responseId}/refresh-urls`,
    { method: "POST" }
  );
  return data.uploadUrls;
}

// ── Queries ────────────────────────────────────────────────────────────

interface APISurveyResponse {
  id: string;
  title: string | null;
  status: string;
  questions: {
    id: string;
    survey_id: string;
    sort_order: number;
    text: string;
    hint: string | null;
    question_type?: "voice" | "photo" | "video";
  }[];
  audioKeys: { questionKey: string; audioR2Key: string }[];
  intro: { audioUrl: string; durationMs: number; transcript: string | null } | null;
  visibility?: GroupVisibility;
  round?: { number: number; kind: RoundKind } | null;
  member?: { role: GroupRole; displayName: string | null; hasAnswered: boolean } | null;
  report?: { available: boolean; unlocked: boolean; markdown: string | null; updatedAt: string | null };
  memberCount?: number;
}

export function useGetSurvey(code: string, token?: string | null) {
  return useQuery<Survey>({
    queryKey: ["survey", code, token ?? ""],
    queryFn: async () => {
      const data = await apiFetch<APISurveyResponse>(`/s/${code}${token ? `?t=${encodeURIComponent(token)}` : ""}`);
      const questions = data.questions.map((q) => ({
        id: q.id,
        text: q.text,
        hint: q.hint ?? undefined,
        type: q.question_type ?? "voice",
      }));
      const mix = getMediaMix(questions);
      return {
        id: data.id,
        code,
        title: data.title ?? "Voice Survey",
        description: mix.welcomeDescription,
        ctaLabel: mix.ctaLabel,
        isOpen: true,
        dashboardCode: "",
        questions,
        intro: data.intro
          ? {
              audioUrl: data.intro.audioUrl,
              durationMs: data.intro.durationMs,
              transcript: data.intro.transcript ?? undefined,
            }
          : undefined,
        visibility: data.visibility ?? "private",
        round: data.round ?? null,
        member: data.member ?? null,
        report: data.report ?? { available: false, unlocked: false, markdown: null, updatedAt: null },
        memberCount: data.memberCount ?? 0,
      };
    },
    enabled: !!code,
  });
}

export function useGetPublicResults(code: string) {
  return useQuery<{ survey: Survey; results: PublicResult[] }>({
    queryKey: ["publicResults", code],
    queryFn: () =>
      apiFetch<{ survey: Survey; results: PublicResult[] }>(
        `/surveys/code/${code}/results`,
      ),
    enabled: !!code,
  });
}

export function useGetDashboard(dashboardCode: string) {
  return useQuery<DashboardData>({
    queryKey: ["dashboard", dashboardCode],
    queryFn: () =>
      apiFetch<DashboardData>(`/d/${dashboardCode}?limit=20`),
    enabled: !!dashboardCode,
    refetchOnWindowFocus: true,
  });
}

/** Fetch a page of dashboard responses (for infinite scroll). */
export function fetchDashboardPage(dashboardCode: string, limit: number, offset: number) {
  return apiFetch<DashboardData>(`/d/${dashboardCode}?limit=${limit}&offset=${offset}`);
}

/** Fetch only new responses since a given timestamp (for delta polling). */
export function fetchDashboardSince(dashboardCode: string, since: string) {
  return apiFetch<DashboardData>(`/d/${dashboardCode}?since=${encodeURIComponent(since)}`);
}

// ── LinkedIn Profile ────────────────────────────────────────────────────

export interface LinkedInProfile {
  connected: boolean;
  name?: string;
  email?: string;
  photoUrl?: string;
}

export function fetchLinkedInProfile(phone: string) {
  return apiFetch<LinkedInProfile>(`/auth/linkedin/profile?phone=${encodeURIComponent(phone)}`);
}

// ── Read state ────────────────────────────────────────────────────────

/** Mark every answer in a parlo as read; clears its unread dot and `newCount` on the home list. */
export function markSurveyRead(apiKey: string, surveyId: string) {
  return apiFetch<{ ok: boolean }>(`/my/surveys/${surveyId}/read`, {
    method: "POST",
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

// ── Notifications ────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  surveyId: string | null;
  surveyTitle: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  hasMore: boolean;
}

export function fetchNotifications(apiKey: string, params?: { limit?: number; before?: string }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.before) qs.set("before", params.before);
  const query = qs.toString();
  return apiFetch<NotificationsResponse>(`/my/notifications${query ? `?${query}` : ""}`, {
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

export function markNotificationsRead(apiKey: string, notificationIds: string[]) {
  return apiFetch<{ ok: boolean }>("/my/notifications/read", {
    method: "POST",
    headers: { "X-Parlo-Api-Key": apiKey },
    body: JSON.stringify({ notificationIds }),
  });
}

// ── Admin: Prompt Management ──────────────────────────────────────────

export interface PromptVersion {
  version: number;
  content: string;
  createdBy: string;
  createdAt: string;
}

export interface PromptSummary {
  name: string;
  currentVersion: number;
}

export interface PromptDetail {
  name: string;
  currentVersion: number;
  currentContent: string;
  versions: PromptVersion[];
}

export async function getPrompts() {
  const res = await apiFetch<{ prompts: PromptSummary[] }>("/admin/prompts");
  return res.prompts;
}

export function getPrompt(name: string) {
  return apiFetch<PromptDetail>(`/admin/prompts/${name}`);
}

export function savePrompt(name: string, content: string) {
  return apiFetch<PromptDetail>(`/admin/prompts/${name}`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function revertPrompt(name: string, version: number) {
  return apiFetch<PromptDetail>(`/admin/prompts/${name}/revert`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export function seedPrompts() {
  return apiFetch<{ ok: boolean }>("/admin/prompts/seed");
}

export interface TestGenerateResponse {
  questions: { id: string; text: string; hint?: string }[];
}

export function testGenerate(audience: string, gather: string) {
  return apiFetch<TestGenerateResponse>("/admin/test-generate", {
    method: "POST",
    body: JSON.stringify({ audience, gather }),
  });
}
