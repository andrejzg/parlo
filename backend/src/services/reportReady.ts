import type { Env } from "../types";
import { createWhatsAppClient } from "./whatsapp";
import { latestSentRound } from "./rounds";
import { trackServerEvent } from "./analytics";

const NOTIFIED_TTL_SECONDS = 30 * 24 * 3600;

/**
 * After a digest: tell every member who has answered, and has a phone, that
 * the report is there, once per round, with the `parlo_report_ready` template
 * (a URL button to their personal link). Owner and admins hear through the
 * Inbox and the dashboard. Sends fail quietly until Meta approves the template.
 */
export async function notifyReportReady(env: Env, surveyId: string): Promise<number> {
  const db = env.DB;
  const survey = await db
    .prepare("SELECT code, title, report_md FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ code: string; title: string | null; report_md: string | null }>();
  if (!survey?.report_md) return 0;
  const round = await latestSentRound(db, surveyId);
  const roundNumber = round?.number ?? 1;

  const members = await db
    .prepare(
      `SELECT gm.user_id, gm.access_token, u.phone
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.survey_id = ? AND gm.removed_at IS NULL AND gm.role = 'member' AND u.phone IS NOT NULL
         AND EXISTS (SELECT 1 FROM responses r WHERE r.survey_id = gm.survey_id AND r.user_id = gm.user_id AND r.status IN ('submitted', 'notified'))`
    )
    .bind(surveyId)
    .all<{ user_id: string; access_token: string; phone: string }>();
  if (members.results.length === 0) return 0;

  const wa = createWhatsAppClient(env.KAPSO_API_KEY, env.WHATSAPP_PHONE_NUMBER_ID);
  let sent = 0;
  for (const m of members.results) {
    const key = `report-notified:${surveyId}:${m.user_id}:${roundNumber}`;
    if (await env.KV.get(key)) continue;
    await wa.sendTemplate(m.phone, "parlo_report_ready", [
      { type: "body", parameters: [{ type: "text", parameter_name: "survey_title", text: survey.title ?? "your parlo" }] },
      { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: `${survey.code}?t=${m.access_token}` }] },
    ]);
    await env.KV.put(key, "1", { expirationTtl: NOTIFIED_TTL_SECONDS });
    trackServerEvent(m.user_id, "report_ready_sent", { surveyId, round: roundNumber });
    sent += 1;
  }
  return sent;
}
