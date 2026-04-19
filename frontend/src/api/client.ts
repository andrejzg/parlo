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
  uploadUrls: { audience: string; gather: string };
}

export function useCreateSurvey() {
  return useMutation({
    mutationFn: () =>
      apiFetch<CreateSurveyResponse>("/surveys", { method: "POST" }),
  });
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
  textAnswers?: { questionId: string; text: string }[];
}

export function useGenerateQuestions() {
  return useMutation({
    mutationFn: ({ surveyId, textAnswers }: GenerateQuestionsInput) => {
      // Map frontend question IDs to backend field names.
      // CreationQuestionScreen uses ids "audience" and "gather".
      // Map frontend question IDs to backend field names.
      let body: string | undefined;
      if (textAnswers?.length) {
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

export interface MySurvey {
  id: string;
  code: string;
  dashboardCode: string;
  title: string | null;
  status: string;
  createdAt: string;
  questionCount: number;
  responseCount: number;
  newCount?: number;
  latestResponseAt?: string | null;
}

export function fetchMySurveys(apiKey: string) {
  return apiFetch<{ surveys: MySurvey[] }>("/my/surveys", {
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

export interface SurveyMember {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  linkedinName: string | null;
  linkedinPhotoUrl: string | null;
  linkedinEmail: string | null;
  respondedAt: string;
}

export function fetchSurveyMembers(apiKey: string, surveyId: string) {
  return apiFetch<{ members: SurveyMember[] }>(`/my/surveys/${surveyId}/members`, {
    headers: { "X-Parlo-Api-Key": apiKey },
  });
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
    mutationFn: (code: string) =>
      apiFetch<StartResponseResult>(`/s/${code}/responses`, {
        method: "POST",
      }),
  });
}

export interface SubmitResponsePayload {
  responseId: string;
  phone: string;
}

export interface SubmitResponseResult {
  ok: boolean;
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
}

export function useGetSurvey(code: string) {
  return useQuery<Survey>({
    queryKey: ["survey", code],
    queryFn: async () => {
      const data = await apiFetch<APISurveyResponse>(`/s/${code}`);
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

// ── Listening Player Feed ────────────────────────────────────────────

export interface FeedAnswer {
  id: string;
  questionId: string;
  questionText: string;
  questionType: "voice" | "photo" | "video";
  audioUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  transcription: string | null;
  transcriptionStatus: string | null;
  durationMs: number;
}

export interface FeedItem {
  surveyId: string;
  surveyTitle: string;
  response: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    submittedAt: string | null;
    isRead: boolean;
  };
  answers: FeedAnswer[];
}

export interface FeedResponse {
  items: FeedItem[];
  cursor: { before: string; beforeId: string } | null;
  hasMore: boolean;
  totalUnread: number;
}

export function fetchFeed(
  apiKey: string,
  params?: {
    limit?: number;
    before?: string;
    beforeId?: string;
    unreadOnly?: boolean;
    surveyId?: string;
  },
): Promise<FeedResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.before) qs.set("before", params.before);
  if (params?.beforeId) qs.set("beforeId", params.beforeId);
  if (params?.unreadOnly) qs.set("unreadOnly", "true");
  if (params?.surveyId) qs.set("surveyId", params.surveyId);
  const query = qs.toString();
  return apiFetch<FeedResponse>(`/my/feed${query ? `?${query}` : ""}`, {
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

export function markResponseRead(apiKey: string, responseId: string) {
  return apiFetch<{ ok: boolean }>(`/my/responses/${responseId}/read`, {
    method: "POST",
    headers: { "X-Parlo-Api-Key": apiKey },
  });
}

export function markResponsesRead(apiKey: string, responseIds: string[]) {
  return apiFetch<{ ok: boolean }>("/my/responses/read", {
    method: "POST",
    headers: { "X-Parlo-Api-Key": apiKey },
    body: JSON.stringify({ responseIds }),
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
