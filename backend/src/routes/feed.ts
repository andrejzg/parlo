import { Hono } from "hono";
import type { Env, ResponseAnswer, SurveyQuestion } from "../types";
import { generatePresignedReadUrl, generateReadToken } from "../services/r2";

const feed = new Hono<{ Bindings: Env; Variables: { creatorId: string | null } }>();

// ── Helper: enrich answers with presigned URLs ──
async function enrichAnswer(
  answer: ResponseAnswer,
  question: SurveyQuestion,
  kv: KVNamespace,
  baseUrl: string,
) {
  let audioUrl: string | null = null;
  let imageUrl: string | null = null;
  let videoUrl: string | null = null;

  if (answer.audio_r2_key) {
    const token = await generateReadToken(kv, answer.audio_r2_key);
    audioUrl = generatePresignedReadUrl(baseUrl, answer.audio_r2_key, token);
  }
  if (answer.image_r2_key) {
    const token = await generateReadToken(kv, answer.image_r2_key);
    imageUrl = generatePresignedReadUrl(baseUrl, answer.image_r2_key, token);
  }
  if (answer.video_r2_key) {
    const token = await generateReadToken(kv, answer.video_r2_key);
    videoUrl = generatePresignedReadUrl(baseUrl, answer.video_r2_key, token);
  }

  return {
    id: answer.id,
    questionId: question.id,
    questionText: question.text,
    questionType: question.question_type,
    audioUrl,
    imageUrl,
    videoUrl,
    transcription: answer.transcription,
    transcriptionStatus: answer.transcription_status,
    durationMs: answer.duration_ms,
  };
}

// ── GET /api/my/feed ── Cross-survey paginated feed for the listening player
feed.get("/api/my/feed", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) return c.json({ error: "Authentication required" }, 401);

  const db = c.env.DB;
  const baseUrl = new URL(c.req.url).origin;

  const limit = Math.min(parseInt(c.req.query("limit") ?? "5", 10) || 5, 20);
  const before = c.req.query("before");
  const beforeId = c.req.query("beforeId");
  const unreadOnly = c.req.query("unreadOnly") === "true";
  const surveyIdFilter = c.req.query("surveyId");

  // Get all survey IDs for this creator (with titles for the response)
  const surveysResult = await db
    .prepare("SELECT id, title FROM surveys WHERE creator_id = ?")
    .bind(creatorId)
    .all<{ id: string; title: string | null }>();

  const surveyMap = new Map(surveysResult.results.map((s) => [s.id, s.title ?? "Untitled"]));
  const surveyIds = surveyIdFilter
    ? [surveyIdFilter].filter((id) => surveyMap.has(id))
    : Array.from(surveyMap.keys());

  if (surveyIds.length === 0) {
    return c.json({ items: [], cursor: null, hasMore: false, totalUnread: 0 });
  }

  // Build the responses query with cursor pagination
  const placeholders = surveyIds.map(() => "?").join(", ");
  let query = `
    SELECT r.id, r.code, r.survey_id, r.status, r.first_name, r.last_name, r.submitted_at
    FROM responses r
  `;

  if (unreadOnly) {
    query += `
      LEFT JOIN creator_read_responses crr
        ON crr.response_id = r.id AND crr.creator_id = ?
    `;
  }

  query += `
    WHERE r.survey_id IN (${placeholders})
      AND r.status = 'submitted'
  `;

  if (unreadOnly) {
    query += " AND crr.response_id IS NULL";
  }

  if (before && beforeId) {
    query += " AND (r.submitted_at < ? OR (r.submitted_at = ? AND r.id < ?))";
  }

  query += " ORDER BY r.submitted_at DESC, r.id DESC LIMIT ?";

  // Build bindings
  const bindings: (string | number)[] = [];
  if (unreadOnly) bindings.push(creatorId);
  bindings.push(...surveyIds);
  if (before && beforeId) bindings.push(before, before, beforeId);
  bindings.push(limit);

  const responsesResult = await db
    .prepare(query)
    .bind(...bindings)
    .all<{
      id: string;
      code: string;
      survey_id: string;
      status: string;
      first_name: string | null;
      last_name: string | null;
      submitted_at: string | null;
    }>();

  // For each response, fetch answers + questions and generate presigned URLs
  const items = await Promise.all(
    responsesResult.results.map(async (resp) => {
      // Get answers
      const answersResult = await db
        .prepare("SELECT * FROM response_answers WHERE response_id = ?")
        .bind(resp.id)
        .all<ResponseAnswer>();

      // Get questions for this survey (cached per survey would be better, but fine at this scale)
      const questionsResult = await db
        .prepare("SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order")
        .bind(resp.survey_id)
        .all<SurveyQuestion>();

      // Enrich answers with presigned URLs, ordered by question sort_order
      const answerPromises: Promise<Awaited<ReturnType<typeof enrichAnswer>>>[] = [];
      for (const q of questionsResult.results) {
        const answer = answersResult.results.find((a) => a.question_id === q.id);
        if (answer) answerPromises.push(enrichAnswer(answer, q, c.env.KV, baseUrl));
      }
      const enrichedAnswers = await Promise.all(answerPromises);

      // Check read status
      const readCheck = await db
        .prepare("SELECT 1 FROM creator_read_responses WHERE creator_id = ? AND response_id = ?")
        .bind(creatorId, resp.id)
        .first();

      return {
        surveyId: resp.survey_id,
        surveyTitle: surveyMap.get(resp.survey_id) ?? "Untitled",
        response: {
          id: resp.id,
          firstName: resp.first_name,
          lastName: resp.last_name,
          submittedAt: resp.submitted_at,
          isRead: !!readCheck,
        },
        answers: enrichedAnswers,
      };
    })
  );

  // Count total unread across all creator's surveys
  const unreadResult = await db
    .prepare(`
      SELECT COUNT(*) as count
      FROM responses r
      LEFT JOIN creator_read_responses crr
        ON crr.response_id = r.id AND crr.creator_id = ?
      WHERE r.survey_id IN (SELECT id FROM surveys WHERE creator_id = ?)
        AND r.status = 'submitted'
        AND crr.response_id IS NULL
    `)
    .bind(creatorId, creatorId)
    .first<{ count: number }>();

  const totalUnread = unreadResult?.count ?? 0;

  // Build cursor from last item
  const lastItem = responsesResult.results[responsesResult.results.length - 1];
  const cursor = lastItem
    ? { before: lastItem.submitted_at ?? "", beforeId: lastItem.id }
    : null;

  const hasMore = responsesResult.results.length === limit;

  return c.json({ items, cursor, hasMore, totalUnread });
});

// ── POST /api/my/responses/:responseId/read ── Mark single response as read
feed.post("/api/my/responses/:responseId/read", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) return c.json({ error: "Authentication required" }, 401);

  const responseId = c.req.param("responseId");
  const db = c.env.DB;

  // Get the response to find its survey_id and submitted_at
  const resp = await db
    .prepare("SELECT survey_id, submitted_at FROM responses WHERE id = ?")
    .bind(responseId)
    .first<{ survey_id: string; submitted_at: string | null }>();

  if (!resp) return c.json({ error: "Response not found" }, 404);

  // Insert read receipt + update cursor
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO creator_read_responses (creator_id, response_id) VALUES (?, ?)")
      .bind(creatorId, responseId),
    db
      .prepare(`
        INSERT INTO creator_survey_cursors (creator_id, survey_id, last_read_at, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT (creator_id, survey_id) DO UPDATE
        SET last_read_at = MAX(excluded.last_read_at, creator_survey_cursors.last_read_at),
            updated_at = datetime('now')
      `)
      .bind(creatorId, resp.survey_id, resp.submitted_at ?? new Date().toISOString()),
  ]);

  return c.json({ ok: true });
});

// ── POST /api/my/responses/read ── Batch mark as read
feed.post("/api/my/responses/read", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) return c.json({ error: "Authentication required" }, 401);

  const body = await c.req.json<{ responseIds: string[] }>().catch(() => null);
  if (!body?.responseIds?.length) return c.json({ error: "responseIds required" }, 400);

  const db = c.env.DB;

  // Get survey_id and submitted_at for each response
  const placeholders = body.responseIds.map(() => "?").join(", ");
  const responses = await db
    .prepare(`SELECT id, survey_id, submitted_at FROM responses WHERE id IN (${placeholders})`)
    .bind(...body.responseIds)
    .all<{ id: string; survey_id: string; submitted_at: string | null }>();

  const statements = [];

  // Insert read receipts
  for (const resp of responses.results) {
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO creator_read_responses (creator_id, response_id) VALUES (?, ?)")
        .bind(creatorId, resp.id)
    );
  }

  // Update cursors per survey
  const surveyLatest = new Map<string, string>();
  for (const resp of responses.results) {
    const ts = resp.submitted_at ?? new Date().toISOString();
    const current = surveyLatest.get(resp.survey_id);
    if (!current || ts > current) surveyLatest.set(resp.survey_id, ts);
  }

  for (const [surveyId, latestAt] of surveyLatest) {
    statements.push(
      db
        .prepare(`
          INSERT INTO creator_survey_cursors (creator_id, survey_id, last_read_at, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT (creator_id, survey_id) DO UPDATE
          SET last_read_at = MAX(excluded.last_read_at, creator_survey_cursors.last_read_at),
              updated_at = datetime('now')
        `)
        .bind(creatorId, surveyId, latestAt)
    );
  }

  if (statements.length > 0) await db.batch(statements);

  return c.json({ ok: true });
});

export default feed;
