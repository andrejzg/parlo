/**
 * The home list reads like a chat inbox: each parlo is a row whose preview
 * says what last happened, with the one thing the viewer is on the hook for
 * pinned to the top. These are the pure rules behind the rows; CreatorHome
 * only renders what comes out.
 */

import type { MySurvey } from "@/api/client";

/** What the viewer has to do, if anything. Rows with an action are pinned. */
export type RowAction = "approve" | "answer" | null;

export interface ParloRow {
  preview: string;
  action: RowAction;
  /** New answers the viewer hasn't seen (owner/admin only). */
  unread: boolean;
  /** A parlo whose round 1 was never built; sorts last and reads muted. */
  draft: boolean;
  /** The timestamp the row's time label and sort order use. */
  activityAt: string;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function describeParlo(s: MySurvey): ParloRow {
  const activityAt = s.lastActivityAt ?? s.latestResponseAt ?? s.reportUpdatedAt ?? s.createdAt;
  const quiet = (preview: string, draft = false): ParloRow => ({ preview, action: null, unread: false, draft, activityAt });

  const report = s.reportPreview ? `Agent: ${s.reportPreview}` : null;
  const reportIsNewest =
    !!s.reportUpdatedAt && (!s.latestResponseAt || Date.parse(s.reportUpdatedAt) >= Date.parse(s.latestResponseAt));

  if (s.role === "member") {
    if ((s.pendingAsks ?? 0) > 0) {
      return {
        preview: "The agent has a question for you",
        action: "answer",
        unread: false,
        draft: false,
        activityAt,
      };
    }
    return quiet(report ?? "Waiting for the agent's report");
  }

  if (s.proposedRound) {
    return {
      preview: `Agent proposed round ${s.proposedRound.number}`,
      action: "approve",
      unread: (s.newCount ?? 0) > 0,
      draft: false,
      activityAt,
    };
  }

  if (s.questionCount === 0) return quiet("Continue setting up", true);

  const fresh = s.newCount ?? 0;
  if (fresh > 0) {
    return {
      preview: `${count(fresh, "new answer")}${reportIsNewest ? " · report updated" : ""}`,
      action: null,
      unread: true,
      draft: false,
      activityAt,
    };
  }

  if (s.responseCount === 0) return quiet("Share the link to get the first answers");
  if (report && reportIsNewest) return quiet(report);

  if (s.round) {
    const { number, answered, targets } = s.round;
    // Round 1 is open to anyone with the link, so it has no fixed audience.
    if (number > 1 && targets > 0) {
      return quiet(answered >= targets ? `Everyone answered round ${number}` : `Round ${number} · ${answered} of ${targets} answered`);
    }
    return quiet(`Round ${number} · ${count(answered, "answer")}`);
  }

  return quiet(count(s.responseCount, "answer"));
}

/** Pinned actions first, then newest activity, drafts at the bottom. */
export function sortParlos(surveys: MySurvey[]): MySurvey[] {
  const rows = new Map(surveys.map((s) => [s.id, describeParlo(s)] as const));
  const rank = (s: MySurvey) => {
    const row = rows.get(s.id)!;
    return row.action ? 0 : row.draft ? 2 : 1;
  };
  const at = (s: MySurvey) => Date.parse(rows.get(s.id)!.activityAt) || 0;
  return [...surveys].sort((a, b) => rank(a) - rank(b) || at(b) - at(a));
}

/**
 * Chat-list time: "now", "5m", "2h" today, "Yesterday", a weekday within
 * the week, then "9 Oct" (with the year once it is not this year).
 */
export function formatListTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso);
  const ms = now - t.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;

  const today = new Date(now);
  const sameDay = t.toDateString() === today.toDateString();
  if (sameDay) return `${Math.floor(mins / 60)}h`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (t.toDateString() === yesterday.toDateString()) return "Yesterday";

  if (ms < 7 * 86_400_000) return t.toLocaleDateString("en-GB", { weekday: "short" });
  if (t.getFullYear() === today.getFullYear()) return t.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "Andrej Zukov Gregoric" → "AG"; "Priya" → "P"; nothing → "". */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}
