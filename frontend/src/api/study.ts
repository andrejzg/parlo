/**
 * The research studio's API: the living brief, invites, participants,
 * raw answers, and rewards. Shapes mirror `backend/src/services/briefBoard.ts`,
 * `routes/study.ts` and `routes/rewards.ts`; check there before changing a field.
 */
import { apiFetch, authed, type GroupRole, type PhoneProof, type PublishConsent, type RoundCost, type RoundKind } from "@/api/client";

// ── The brief board ────────────────────────────────────────────────────

export type BriefStatus = "suggested" | "open" | "emerging" | "answered" | "dropped" | "dismissed";
export type BriefOrigin = "seed" | "researcher" | "client" | "agent";

export interface StudyAnswer {
  id: string;
  responseId: string;
  /** A name for the research team; a label ("Customer 3") for the client. */
  who: string;
  segment: string | null;
  roundNumber: number;
  questionId: string;
  questionText: string;
  questionType: "voice" | "photo" | "video";
  transcription: string | null;
  transcriptionStatus: string;
  durationMs: number;
  /** What may leave the study: none | quote (their words, unnamed) | voice (the recording too). */
  publishConsent: PublishConsent;
  submittedAt: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
}

export interface BriefItem {
  id: string;
  text: string;
  status: BriefStatus;
  origin: BriefOrigin;
  addedBy: string | null;
  /** The agent's current answer in a sentence. */
  finding: string | null;
  /** For a suggestion: why the agent proposes it. */
  why: string | null;
  voices: number;
  /** A person set the status; the agent leaves it alone. */
  setByHand: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  evidence: { quote: string; answer: StudyAnswer }[];
}

export interface BriefSteer {
  id: string;
  itemId: string | null;
  itemText: string | null;
  body: string;
  by: string;
  role: string;
  at: string | null;
}

export interface BriefRoundAsk {
  id: string;
  text: string;
  hint: string | null;
  type: string;
  /** Who it is aimed at; empty = everyone. */
  targets: string[];
}

export interface BriefEvent {
  id: string;
  type:
    | "goal_edited"
    | "item_added"
    | "item_edited"
    | "item_dropped"
    | "item_reopened"
    | "item_answered"
    | "suggestion_made"
    | "suggestion_accepted"
    | "suggestion_dismissed"
    | "status_changed"
    | "steer"
    | "round_proposed"
    | "round_sent";
  body: string | null;
  itemId: string | null;
  itemText: string | null;
  by: string;
  role: string;
  /** Someone's AI agent made this change for them, through the MCP server. */
  viaAgent?: boolean;
  roundNumber: number | null;
  at: string | null;
}

export interface RewardSummary {
  currency: string;
  defaultCents: number | null;
  budgetCents: number | null;
  committedCents: number;
  remainingCents: number | null;
  sentCents: number;
  owedCents: number;
  heldCount: number;
  failedCount: number;
  /** null = no payout provider connected: rewards are recorded and wait as owed. */
  payouts: "sandbox" | "production" | null;
}

export interface BriefBoard {
  survey: { id: string; code: string; title: string | null; sponsor: string | null; study: boolean; dashboardCode: string | null };
  you: { userId: string; role: GroupRole; canManage: boolean };
  goal: string;
  items: BriefItem[];
  suggestions: BriefItem[];
  dropped: BriefItem[];
  /** Steers no round has taken up yet. */
  steers: BriefSteer[];
  /** A steer is newer than the plan on the table: the agent is still working it in. */
  planning: boolean;
  nextRound: {
    id: string;
    number: number;
    kind: RoundKind;
    rationale: string | null;
    createdAt: string | null;
    /** Ids of the brief questions this round digs into. */
    serves: string[];
    asks: BriefRoundAsk[];
    cost: RoundCost;
  } | null;
  liveRound: {
    id: string;
    number: number;
    kind: RoundKind;
    sentAt: string | null;
    closesAt: string | null;
    serves: string[];
    asks: BriefRoundAsk[];
    answered: number;
    rewardCents: number;
  } | null;
  timeline: BriefEvent[];
  report: { markdown: string | null; updatedAt: string | null };
  voices: number;
  answers: number;
  /** People brought in as participants, whether or not they have answered. */
  participants: number;
  team: { userId: string; role: GroupRole; name: string }[];
  rewards: RewardSummary;
}

const base = (surveyId: string) => `/my/surveys/${surveyId}`;
const post = (apiKey: string, body?: unknown) => authed(apiKey, { method: "POST", body: JSON.stringify(body ?? {}) });
const put = (apiKey: string, body: unknown) => authed(apiKey, { method: "PUT", body: JSON.stringify(body) });

export const fetchBrief = (apiKey: string, surveyId: string) => apiFetch<BriefBoard>(`${base(surveyId)}/brief`, authed(apiKey));
export const editGoal = (apiKey: string, surveyId: string, goal: string) => apiFetch<BriefBoard>(`${base(surveyId)}/brief/goal`, put(apiKey, { goal }));
export const addBriefItem = (apiKey: string, surveyId: string, text: string) => apiFetch<BriefBoard>(`${base(surveyId)}/brief/items`, post(apiKey, { text }));
export const updateBriefItem = (apiKey: string, surveyId: string, itemId: string, change: { text?: string; status?: "open" | "answered" | "dropped" }) =>
  apiFetch<BriefBoard>(`${base(surveyId)}/brief/items/${itemId}`, put(apiKey, change));
export const answerSuggestion = (apiKey: string, surveyId: string, itemId: string, verdict: "accept" | "dismiss") =>
  apiFetch<BriefBoard>(`${base(surveyId)}/brief/items/${itemId}/${verdict}`, post(apiKey));
/** "Dig into this": a note the agent works into the next round. */
export const steerBrief = (apiKey: string, surveyId: string, note: string, itemId?: string | null) =>
  apiFetch<BriefBoard>(`${base(surveyId)}/brief/steer`, post(apiKey, { note, itemId: itemId ?? null }));
/** Research team only: have the agent plan the next round now. */
export const replanBrief = (apiKey: string, surveyId: string) => apiFetch<BriefBoard>(`${base(surveyId)}/brief/replan`, post(apiKey));

/** What you hand your own AI agent so it can work on the study with your seat. */
export const fetchAgentAccess = (apiKey: string, surveyId: string) =>
  apiFetch<{ mcpUrl: string; inviteLink: string; seat: string; studyId: string }>(`${base(surveyId)}/agent-access`, authed(apiKey));

export const fetchStudyAnswers = (apiKey: string, surveyId: string, offset = 0, limit = 30) =>
  apiFetch<{ answers: StudyAnswer[]; total: number; hasMore: boolean }>(`${base(surveyId)}/answers?limit=${limit}&offset=${offset}`, authed(apiKey));

// ── Starting a study ───────────────────────────────────────────────────

export interface CreateStudyInput {
  /** What the study is for, who it should hear from, what the team needs to learn. At least 20 characters. */
  brief: string;
  title?: string;
  /** Who commissioned it; shown on the participant's consent screen. Leave out for an internal study. */
  sponsorName?: string;
  /** Default reward per answer and the study's cap, in cents. */
  rewardCents?: number | null;
  budgetCents?: number | null;
  currency?: string;
  /** The team's own round-1 questions; left out, the agent writes them from the brief. */
  questions?: string[];
}
export interface CreatedStudy {
  surveyId: string;
  code: string;
  dashboardCode: string;
  title: string;
  sponsor: string | null;
  questions: { text: string; hint: string; type: string }[];
  studyLink: string;
  dashboardLink: string;
  shareLink: string;
}
/** One call from a brief to a study that is ready to work on. Takes a few seconds: a model writes round 1. */
export const createStudy = (apiKey: string, input: CreateStudyInput) => apiFetch<CreatedStudy>("/studies", post(apiKey, input));

// ── Invites and joining ────────────────────────────────────────────────

export interface StudyInvite {
  token: string;
  role: "admin" | "client";
  link: string;
  uses: number;
}

export const fetchInvites = (apiKey: string, surveyId: string) =>
  apiFetch<{ sponsor: string | null; invites: (StudyInvite & { createdAt: string })[] }>(`${base(surveyId)}/invites`, authed(apiKey));
/** One reusable link per seat kind. Inviting a client makes the study a sponsored one. */
export const createInvite = (apiKey: string, surveyId: string, role: "admin" | "client", sponsorName?: string) =>
  apiFetch<StudyInvite & { sponsor: string | null }>(`${base(surveyId)}/invites`, post(apiKey, { role, sponsorName }));
export const revokeInvite = (apiKey: string, surveyId: string, token: string) =>
  apiFetch<{ ok: boolean }>(`${base(surveyId)}/invites/${token}`, authed(apiKey, { method: "DELETE" }));

export interface JoinInfo {
  surveyId: string;
  title: string | null;
  role: "admin" | "client";
  sponsor: string | null;
  invitedBy: string | null;
}
export const fetchJoinInfo = (token: string) => apiFetch<JoinInfo>(`/join/${token}`);
export function joinByInvite(token: string, auth: PhoneProof | { apiKey: string }) {
  if ("apiKey" in auth) {
    return apiFetch<JoinResult>(`/join/${token}`, authed(auth.apiKey, { method: "POST", body: JSON.stringify({}) }));
  }
  return apiFetch<JoinResult>(`/join/${token}`, { method: "POST", body: JSON.stringify(auth) });
}
export interface JoinResult {
  ok: boolean;
  apiKey: string;
  userId: string;
  phone: string | null;
  surveyId: string;
  role: GroupRole;
  dashboardCode: string | null;
}

// ── Participants ───────────────────────────────────────────────────────

export interface ParticipantInput {
  name?: string;
  phone?: string;
  email?: string;
  segment?: string;
  descriptor?: string;
  /** An interview already held elsewhere; filed as round 0. */
  transcript?: string;
}
export interface ImportedParticipant {
  userId: string;
  name: string | null;
  segment: string | null;
  /** Their personal link: send it to them. It is what makes them payable. */
  link: string;
  added: boolean;
  transcriptImported: boolean;
}
export const importParticipants = (apiKey: string, surveyId: string, participants: ParticipantInput[]) =>
  apiFetch<{ participants: ImportedParticipant[]; skipped: { row: number; reason: string }[] }>(`${base(surveyId)}/participants`, post(apiKey, { participants }));

// ── Rewards: the research team ─────────────────────────────────────────

export type RewardStatus = "pending" | "held" | "approved" | "sent" | "failed" | "void";
export interface LedgerReward {
  id: string;
  userId: string;
  name: string | null;
  segment: string | null;
  roundNumber: number;
  responseId: string;
  amountCents: number;
  currency: string;
  status: RewardStatus;
  holdReason: "too_short" | "off_topic" | "over_budget" | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  claimedAt: string | null;
}
export const fetchRewards = (apiKey: string, surveyId: string) =>
  apiFetch<{ summary: RewardSummary; rewards: LedgerReward[] }>(`${base(surveyId)}/rewards`, authed(apiKey));
export const updateRewardSettings = (apiKey: string, surveyId: string, settings: { budgetCents?: number | null; defaultCents?: number | null; currency?: string }) =>
  apiFetch<{ summary: RewardSummary }>(`${base(surveyId)}/rewards/settings`, put(apiKey, settings));
/** Pay a held (or failed) reward after a look. */
export const releaseReward = (apiKey: string, surveyId: string, rewardId: string) =>
  apiFetch<{ ok: boolean; status: RewardStatus; error: string | null; summary: RewardSummary }>(`${base(surveyId)}/rewards/${rewardId}/release`, post(apiKey));
export const voidReward = (apiKey: string, surveyId: string, rewardId: string) =>
  apiFetch<{ ok: boolean; status: RewardStatus; summary: RewardSummary }>(`${base(surveyId)}/rewards/${rewardId}/void`, post(apiKey));

// ── Rewards: the participant (personal link) ───────────────────────────

export interface MyReward {
  id: string;
  roundNumber: number;
  amountCents: number;
  currency: string;
  /** preparing: on its way. ready: claim it. review: the research team is taking a look. */
  state: "preparing" | "ready" | "review";
  claimed: boolean;
}
export const fetchMyRewards = (code: string, token: string) =>
  apiFetch<{ offer: { amountCents: number; currency: string } | null; rewards: MyReward[] }>(`/s/${code}/reward?t=${encodeURIComponent(token)}`);
/** A fresh redemption link, to navigate to at once. Never store it. */
export const claimMyReward = (code: string, token: string, rewardId: string) =>
  apiFetch<{ url: string }>(`/s/${code}/reward/${rewardId}/claim?t=${encodeURIComponent(token)}`, { method: "POST", body: "{}" });

/** "$10", "$12.50", "€8". */
export function formatMoney(cents: number, currency = "USD"): string {
  const amount = cents / 100;
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** `apiFetch` throws "API 400: {json}"; this is the server's sentence. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const m = err.message.match(/^API \d+: (.*)$/s);
  if (!m) return err.message || fallback;
  try {
    return (JSON.parse(m[1]) as { error?: string }).error || fallback;
  } catch {
    return fallback;
  }
}
