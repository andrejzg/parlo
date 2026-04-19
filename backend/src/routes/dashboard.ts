import { Hono } from "hono";
import type {
  Env,
  Survey,
  SurveyQuestion,
  ResponseAnswer,
  DashboardView,
  PublicResultsView,
} from "../types";
import { generatePresignedReadUrl, generateReadToken } from "../services/r2";

const dashboard = new Hono<{ Bindings: Env }>();

// ── GET /api/r/:code ── Public results (open surveys only)
dashboard.get("/api/r/:code", async (c) => {
  const code = c.req.param("code");
  const db = c.env.DB;

  const survey = await db
    .prepare("SELECT * FROM surveys WHERE code = ?")
    .bind(code)
    .first<Survey>();

  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }

  if (survey.visibility !== "open") {
    return c.json({ error: "Results are not public for this survey" }, 403);
  }

  const questions = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order"
    )
    .bind(survey.id)
    .all<SurveyQuestion>();

  const responseCount = await db
    .prepare(
      "SELECT COUNT(*) as count FROM responses WHERE survey_id = ? AND status = 'submitted'"
    )
    .bind(survey.id)
    .first<{ count: number }>();

  const view: PublicResultsView = {
    survey: {
      id: survey.id,
      title: survey.title,
      status: survey.status,
    },
    questions: questions.results,
    responseCount: responseCount?.count ?? 0,
  };

  return c.json(view);
});

// ── Helper: enrich response answers with presigned URLs ──
async function enrichAnswers(
  answers: ResponseAnswer[],
  kv: KVNamespace,
  baseUrl: string,
) {
  return Promise.all(
    answers.map(async (answer) => {
      let audioUrl: string | null = null;
      let imageUrl: string | null = null;
      let videoUrl: string | null = null;

      if (answer.audio_r2_key) {
        const audioToken = await generateReadToken(kv, answer.audio_r2_key);
        audioUrl = generatePresignedReadUrl(baseUrl, answer.audio_r2_key, audioToken);
      }
      if (answer.image_r2_key) {
        const imgToken = await generateReadToken(kv, answer.image_r2_key);
        imageUrl = generatePresignedReadUrl(baseUrl, answer.image_r2_key, imgToken);
      }
      if (answer.video_r2_key) {
        const videoToken = await generateReadToken(kv, answer.video_r2_key);
        videoUrl = generatePresignedReadUrl(baseUrl, answer.video_r2_key, videoToken);
      }

      return {
        ...answer,
        audioUrl,
        imageUrl,
        videoUrl,
        transcription: answer.transcription,
        transcriptionStatus: answer.transcription_status,
      };
    })
  );
}

// ── GET /api/d/:dashboardCode ── Creator dashboard (paginated + delta poll)
//
// Query params:
//   limit  — max responses to return (default 20, max 100)
//   offset — skip this many responses (default 0)
//   since  — ISO timestamp; return only responses submitted after this time
//            (overrides limit/offset — used for 3-second delta polling)
//
// Response includes `total` (count of all submitted responses) and `hasMore`.
dashboard.get("/api/d/:dashboardCode", async (c) => {
  const dashboardCode = c.req.param("dashboardCode");
  const db = c.env.DB;

  const survey = await db
    .prepare("SELECT * FROM surveys WHERE dashboard_code = ?")
    .bind(dashboardCode)
    .first<Survey>();

  if (!survey) {
    return c.json({ error: "Dashboard not found" }, 404);
  }

  const questions = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order"
    )
    .bind(survey.id)
    .all<SurveyQuestion>();

  // Total submitted count (always returned, cheap query)
  const totalRow = await db
    .prepare(
      "SELECT COUNT(*) as count FROM responses WHERE survey_id = ? AND status = 'submitted'"
    )
    .bind(survey.id)
    .first<{ count: number }>();
  const total = totalRow?.count ?? 0;

  const baseUrl = new URL(c.req.url).origin;
  const since = c.req.query("since");

  if (since) {
    // ── Delta poll mode: return only new responses since the given timestamp ──
    const newResponses = await db
      .prepare(
        "SELECT * FROM responses WHERE survey_id = ? AND status = 'submitted' AND submitted_at > ? ORDER BY submitted_at DESC"
      )
      .bind(survey.id, since)
      .all<{
        id: string;
        code: string;
        status: string;
        first_name: string | null;
        last_name: string | null;
        submitted_at: string | null;
      }>();

    const responsesWithAnswers = await Promise.all(
      newResponses.results.map(async (resp) => {
        const answers = await db
          .prepare("SELECT * FROM response_answers WHERE response_id = ?")
          .bind(resp.id)
          .all<ResponseAnswer>();

        const answersWithUrls = await enrichAnswers(answers.results, c.env.KV, baseUrl);

        return {
          id: resp.id,
          code: resp.code,
          status: resp.status,
          firstName: resp.first_name,
          lastName: resp.last_name,
          submittedAt: resp.submitted_at,
          answers: answersWithUrls,
        };
      })
    );

    return c.json({
      survey,
      questions: questions.results,
      responses: responsesWithAnswers,
      total,
      hasMore: false,
    });
  }

  // ── Paginated mode: return a page of responses ──
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;

  const responsesResult = await db
    .prepare(
      "SELECT * FROM responses WHERE survey_id = ? AND status = 'submitted' ORDER BY submitted_at DESC LIMIT ? OFFSET ?"
    )
    .bind(survey.id, limit, offset)
    .all<{
      id: string;
      code: string;
      status: string;
      first_name: string | null;
      last_name: string | null;
      submitted_at: string | null;
    }>();

  const responsesWithAnswers = await Promise.all(
    responsesResult.results.map(async (resp) => {
      const answers = await db
        .prepare("SELECT * FROM response_answers WHERE response_id = ?")
        .bind(resp.id)
        .all<ResponseAnswer>();

      const answersWithUrls = await enrichAnswers(answers.results, c.env.KV, baseUrl);

      return {
        id: resp.id,
        code: resp.code,
        status: resp.status,
        firstName: resp.first_name,
        lastName: resp.last_name,
        submittedAt: resp.submitted_at,
        answers: answersWithUrls,
      };
    })
  );

  const hasMore = offset + responsesResult.results.length < total;

  return c.json({
    survey,
    questions: questions.results,
    responses: responsesWithAnswers,
    total,
    hasMore,
  });
});

export default dashboard;
