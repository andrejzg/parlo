import { useQuery, useMutation } from "@tanstack/react-query";
import type { AudienceId, LengthId, ShapeId, TimingId } from "@/lib/shapes";
import type { OutputId } from "@/lib/outputs";
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
  /** The brief the questions were built from — composed server-side from the taps in the output-first flow. */
  brief?: string;
}

export interface GenerateQuestionsInput {
  surveyId: string;
  /** Output-first flow: the shape of what comes back, who, how long, and the one blank. */
  shape?: ShapeId;
  audience?: AudienceId;
  length?: LengthId;
  topic?: string;
  /** What the agent should make beyond the report. */
  outputs?: OutputId[];
  /** The third chip row's pick (deadline / cadence / follow-up), when the shape has one. */
  timing?: TimingId;
  /** Free brief ("Something else"): the creator's own words. */
  brief?: string;
  clarifications?: Clarification[];
  /** Legacy two-question flow. */
  textAnswers?: { questionId: string; text: string }[];
}

export function useGenerateQuestions() {
  return useMutation({
    mutationFn: ({ surveyId, shape, audience, length, topic, outputs, timing, brief, clarifications, textAnswers }: GenerateQuestionsInput) => {
      let body: string | undefined;
      if (shape && shape !== "other") {
        body = JSON.stringify({ shape, audience, length, ...(topic?.trim() ? { topic: topic.trim() } : {}), outputs: outputs ?? [], ...(timing ? { timing } : {}), clarifications: clarifications ?? [] });
      } else if (brief?.trim()) {
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

// ── Phone proof ───────────────────────────────────────────────────────
//
// The backend never trusts a phone number in a request body. After the OTP
// screen the client holds one of two proofs and sends that instead.

/** A Firebase ID token (SMS code confirmed in the browser) or a WhatsApp proof token. */
export type PhoneProof = { idToken: string } | { proof: string };

export interface LoginResult {
  apiKey: string;
  userId: string;
  /** @deprecated same as userId */
  creatorId: string;
  /** The verified phone, normalised by the server. */
  phone: string;
  created: boolean;
}

/** Prove a phone, get (or mint) the user's API key. Creates the user if the phone is new. */
export function loginByPhone(proof: PhoneProof, names: { firstName?: string; lastName?: string } = {}) {
  return apiFetch<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ ...proof, ...names }),
  });
}

export interface ClaimResult {
  ok: boolean;
  apiKey: string;
  userId: string;
  phone: string | null;
}

/** Attach the owner seat of a freshly created parlo to a verified identity: a proof, or a logged-in device's API key. */
export function claimSurvey(surveyId: string, auth: PhoneProof | { apiKey: string }, name?: string) {
  if ("apiKey" in auth) {
    return apiFetch<ClaimResult>(`/surveys/${surveyId}/claim`, authed(auth.apiKey, { method: "POST", body: JSON.stringify({ name }) }));
  }
  return apiFetch<ClaimResult>(`/surveys/${surveyId}/claim`, {
    method: "POST",
    body: JSON.stringify({ ...auth, name }),
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
  round?: { number: number; kind: ParloRoundKind; sentAt: string | null; closesAt?: string | null; answered: number; targets: number } | null;
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
  closes_at?: string | null;
  closed_at?: string | null;
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
  dashboardCode?: string | null;
  /** Export to the connected destinations after every report. */
  autoExport?: boolean;
  lastExportAt?: string | null;
  lastExportSummary?: string | null;
  lastExportError?: string | null;
}

export type ConnectionState = "authenticating" | "connecting" | "connected" | "discovering" | "ready" | "failed";

/** An MCP server the owner connected as an export destination. */
export interface AgentConnection {
  id: string;
  name: string;
  url: string;
  state: ConnectionState;
  tools: string[];
  error: string | null;
  /** Set while the owner still has to authorise the server. */
  authUrl: string | null;
}

export interface AgentSnapshot {
  state: AgentState;
  files: { path: string; updatedAt: string; bytes: number }[];
  report: string | null;
  reportUpdatedAt: string | null;
  memory: string | null;
  rounds: GroupRound[];
  visibility: GroupVisibility;
  connections: AgentConnection[];
}

export interface ExportResult {
  ok: boolean;
  summary: string | null;
  toolCalls: number;
  destinations: string[];
  provider: string;
  model: string;
  error?: string;
}

export function fetchConnections(apiKey: string, surveyId: string) {
  return apiFetch<{ connections: AgentConnection[] }>(`/my/surveys/${surveyId}/connections`, authed(apiKey));
}

/** Connect an MCP server. If it needs OAuth, `authUrl` is where to send the browser. */
export function addConnection(apiKey: string, surveyId: string, input: { name: string; url: string }) {
  return apiFetch<{ id: string; state: ConnectionState; authUrl: string | null; connection: AgentConnection | null }>(
    `/my/surveys/${surveyId}/connections`,
    authed(apiKey, { method: "POST", body: JSON.stringify(input) }),
  );
}

export function removeConnection(apiKey: string, surveyId: string, connectionId: string) {
  return apiFetch<{ ok: boolean }>(`/my/surveys/${surveyId}/connections/${encodeURIComponent(connectionId)}`, authed(apiKey, { method: "DELETE" }));
}

/** Ask the agent to export the report and answers to every ready destination now. */
export async function runAgentExport(apiKey: string, surveyId: string, instruction?: string): Promise<ExportResult> {
  const res = await fetch(`${API_BASE}/my/surveys/${surveyId}/agent/export`, {
    ...authed(apiKey, { method: "POST", body: JSON.stringify({ instruction }) }),
    headers: { "Content-Type": "application/json", "X-Parlo-Api-Key": apiKey },
  });
  const body = (await res.json().catch(() => null)) as ExportResult | { error?: string } | null;
  if (body && "toolCalls" in body) return body; // 200 or 502 both carry the result
  throw new Error((body as { error?: string } | null)?.error ?? `API ${res.status}`);
}

export function updateAgentSettings(apiKey: string, surveyId: string, settings: { autoExport: boolean }) {
  return apiFetch<{ autoExport: boolean }>(`/my/surveys/${surveyId}/agent/settings`, authed(apiKey, { method: "PUT", body: JSON.stringify(settings) }));
}

/** Download the answers table as a CSV file (the endpoint needs the API key header, so no plain link). */
export async function downloadAnswersCsv(apiKey: string, surveyId: string, filename: string) {
  const res = await fetch(`${API_BASE}/my/surveys/${surveyId}/export.csv`, authed(apiKey));
  if (!res.ok) throw new Error(`API ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
  /** Display only; identity comes from `apiKey` or the proof. */
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** A logged-in device: the server identifies the member by this key. */
  apiKey?: string;
  /** Or the proof from this session's OTP. Without either, the answer stays anonymous. */
  idToken?: string;
  proof?: string;
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
    mutationFn: ({ responseId, apiKey, ...body }: SubmitResponsePayload) => {
      const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
      return apiFetch<SubmitResponseResult>(`/responses/${responseId}/submit`, apiKey ? authed(apiKey, init) : init);
    },
  });
}

// ── WhatsApp OTP ─────────────────────────────────────────────────────

export async function sendWhatsAppOtp(phone: string): Promise<{ sent: boolean }> {
  return apiFetch<{ sent: boolean }>("/otp/send-whatsapp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

/** On success the server returns a `proof` token (10 min) to present to login / claim / submit. */
export async function verifyWhatsAppOtp(phone: string, code: string): Promise<{ verified: boolean; proof?: string }> {
  return apiFetch<{ verified: boolean; proof?: string }>("/otp/verify-whatsapp", {
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
  round?: { number: number; kind: RoundKind; closesAt?: string | null } | null;
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

/** The logged-in user's own LinkedIn profile. */
export function fetchLinkedInProfile(apiKey: string) {
  return apiFetch<LinkedInProfile>("/auth/linkedin/profile", authed(apiKey));
}

/** Start the LinkedIn OAuth flow; send the browser to the returned URL. */
export function startLinkedIn(apiKey: string, returnTo?: string) {
  return apiFetch<{ url: string }>("/auth/linkedin/start", authed(apiKey, { method: "POST", body: JSON.stringify({ returnTo }) }));
}

export function disconnectLinkedIn(apiKey: string) {
  return apiFetch<{ ok: boolean }>("/auth/linkedin/disconnect", authed(apiKey, { method: "POST" }));
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
