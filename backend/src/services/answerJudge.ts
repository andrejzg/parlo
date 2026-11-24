/**
 * Did this answer answer its question?
 *
 * One judgment with three uses on a study:
 *   - inside a sitting, to decide whether to ask a follow-up (a probe) and,
 *     after two, to let go (`POST /api/responses/:id/probe`);
 *   - when the transcripts land, to stamp each answer with a verdict the
 *     research team can see (`judgeResponseAnswers`);
 *   - for pay: a round with an ask left unanswered is held for a person to
 *     decide (`services/rewards.ts`). The judge is a model, so it can hold
 *     a reward and never refuses one.
 *
 * TypeSafe gives a probability; Cerebras and Workers AI stand in with a
 * three-way answer. With no judge at all the verdict stays NULL, which
 * everything downstream reads as "not judged": nobody loses pay to an outage.
 */

import type { Env } from "../types";
import { runJsonCompletion, transcribeAudio } from "./ai";
import { systemOne, type NoulQuestion } from "./typesafe";
import { trackServerEvent } from "./analytics";

export type Verdict = "answered" | "partial" | "unanswered";

/** At or above this the question counts as answered. */
export const ANSWERED_AT = 0.6;
/** Below this it was not answered. Between the two: partly. */
export const UNANSWERED_BELOW = 0.3;
/** Follow-ups per ask before the agent lets go. */
export const MAX_PROBES = 2;
/** Fewer words than this is not an answer to anything. */
export const MIN_ANSWER_WORDS = 4;

export interface Judged {
  verdict: Verdict;
  score: number;
}

export function verdictFor(score: number): Verdict {
  return score >= ANSWERED_AT ? "answered" : score < UNANSWERED_BELOW ? "unanswered" : "partial";
}

export function wordCount(text: string | null | undefined): number {
  return text?.trim().split(/\s+/).filter(Boolean).length ?? 0;
}

const ANSWERS_IT: NoulQuestion = {
  type: "noul",
  instructions: "Does the participant's answer actually answer the question they were asked?",
  criteria: {
    true: "It gives something concrete in response to what was asked: a reason, an example, a number, a comparison, a clear position. Or it says plainly that the question does not apply to them, and why.",
    false: "It avoids the question, stays generic or vague, repeats the question back, says they don't know and nothing more, or talks about something else.",
  },
};

async function judgeOne(env: Env, question: string, transcript: string, purpose: string): Promise<Judged | null> {
  if (wordCount(transcript) < MIN_ANSWER_WORDS) return { verdict: "unanswered", score: 0 };
  const state = {
    context: "A research participant answered a question by voice. This is the question and the transcript of what they said.",
    question,
    transcript: transcript.slice(0, 4000),
  };
  if (env.TYPESAFE_API_KEY) {
    try {
      const result = await systemOne(env.TYPESAFE_API_KEY, state, { answers: ANSWERS_IT }, { timeoutMs: 5000, properties: { purpose } });
      const score = result.answers.answers?.noul;
      if (typeof score === "number" && Number.isFinite(score)) return { verdict: verdictFor(score), score };
    } catch (err) {
      console.error("[answer-judge] TypeSafe failed, falling back:", err);
    }
  }
  try {
    const answer = await runJsonCompletion(
      env.AI,
      env.CEREBRAS_API_KEY,
      [
        { role: "system", content: "You judge whether a spoken answer answers the question it was asked. Be fair: a short concrete answer counts. Always respond in valid JSON." },
        {
          role: "user",
          content: `QUESTION: ${question}\n\nANSWER (transcript): ${state.transcript}\n\nDoes the answer answer the question?\n- "yes": ${ANSWERS_IT.criteria?.true}\n- "no": ${ANSWERS_IT.criteria?.false}\n- "partly": it starts to answer but leaves out the main thing that was asked.\n\nReturn JSON: {"answers": "yes" | "partly" | "no"}`,
        },
      ],
      (text) => {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const parsed = JSON.parse(fenced ? fenced[1].trim() : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { answers?: unknown };
        const v = String(parsed.answers ?? "").toLowerCase();
        if (v !== "yes" && v !== "partly" && v !== "no") throw new Error("no verdict in the reply");
        return v;
      },
      { maxTokens: 60, properties: { purpose: `${purpose}-fallback` } }
    );
    const score = answer === "yes" ? 0.9 : answer === "partly" ? 0.45 : 0.1;
    return { verdict: verdictFor(score), score };
  } catch (err) {
    console.error("[answer-judge] no judge available:", err);
    return null;
  }
}

/** Judge several answers at once. An entry is null when no judge could be reached. */
export function judgeAnswers(env: Env, pairs: { question: string; transcript: string }[], purpose = "answer-judge"): Promise<(Judged | null)[]> {
  return Promise.all(pairs.map((p) => judgeOne(env, p.question, p.transcript, purpose)));
}

/**
 * One spoken follow-up that names what is still missing. Null when the
 * model gives nothing usable: then there is no probe, and the sitting moves on.
 */
export async function writeProbe(env: Env, input: { question: string; transcript: string; earlier: string[] }): Promise<string | null> {
  try {
    return await runJsonCompletion(
      env.AI,
      env.CEREBRAS_API_KEY,
      [
        {
          role: "system",
          content:
            "You are a research interviewer listening to a voice answer. The answer did not fully answer the question. Write ONE follow-up to say next: a full, warm, plain sentence of 8 to 22 words that names the specific thing still missing and is easy to answer in a sentence or two. Start from what they just said (\"You said it was fine: what...\") so it sounds like someone listening. Do not repeat the question. Do not repeat an earlier follow-up. Do not scold. Never lead: do not suggest an answer, and do not bring in a topic, example or option that is in neither the question nor what they said (no \"was it the price or the support?\"); ask openly and let them supply it. Always respond in valid JSON.",
        },
        {
          role: "user",
          content: [
            `QUESTION ASKED: ${input.question}`,
            `WHAT THEY SAID: ${input.transcript.slice(0, 3000) || "(nothing audible)"}`,
            input.earlier.length ? `FOLLOW-UPS ALREADY ASKED:\n${input.earlier.map((p) => `- ${p}`).join("\n")}` : "",
            'Return JSON: {"probe": "..."}',
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      (text) => {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const parsed = JSON.parse(fenced ? fenced[1].trim() : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { probe?: unknown };
        const probe = typeof parsed.probe === "string" ? parsed.probe.trim().replace(/\s+/g, " ") : "";
        // A two-word probe ("The reason itself?") reads as curt; better none than that.
        if (probe.length < 8 || probe.split(/\s+/).length < 5) throw new Error("no usable probe in the reply");
        return probe.slice(0, 220);
      },
      { maxTokens: 120, properties: { purpose: "probe-write" } }
    );
  } catch (err) {
    console.error("[answer-judge] probe writing failed:", err);
    return null;
  }
}

const IS_POSITIVE: NoulQuestion = {
  type: "noul",
  instructions: "In what this participant said, are they clearly positive about the product, or about something specific in it?",
  criteria: {
    true: "They praise it, say what it does for them, or say they would keep using or recommend it, in their own words.",
    false: "They are neutral or vague, more critical than positive, describe leaving or wanting to leave, or say nothing about it.",
  },
};

/**
 * Was this person clearly positive? Checked on their own words before anyone
 * is asked for a testimonial: the planner proposes who to ask, and this
 * decides whether each of them really sounded happy. Asking someone who was
 * lukewarm or leaving for a public endorsement is worse than asking nobody.
 * Returns a probability per person, or null where no judge was reachable
 * (then the planner's pick stands).
 */
export function judgePositive(env: Env, people: { said: string }[], about?: string): Promise<(number | null)[]> {
  return Promise.all(
    people.map(async (p) => {
      const said = p.said.trim();
      if (wordCount(said) < MIN_ANSWER_WORDS) return 0;
      const state = {
        context: "A research participant's answers in a study about a product, as transcripts of what they said.",
        ...(about ? { the_researcher_is_looking_for: about } : {}),
        said: said.slice(0, 4000),
      };
      if (env.TYPESAFE_API_KEY) {
        try {
          const result = await systemOne(env.TYPESAFE_API_KEY, state, { positive: IS_POSITIVE }, { timeoutMs: 5000, properties: { purpose: "testimonial-positive" } });
          const score = result.answers.positive?.noul;
          if (typeof score === "number" && Number.isFinite(score)) return score;
        } catch (err) {
          console.error("[answer-judge] TypeSafe positivity check failed, falling back:", err);
        }
      }
      try {
        return await runJsonCompletion(
          env.AI,
          env.CEREBRAS_API_KEY,
          [
            { role: "system", content: "You judge whether a research participant was clearly positive about a product in what they said. Be strict: lukewarm is not positive. Always respond in valid JSON." },
            { role: "user", content: `WHAT THEY SAID: ${state.said}\n\n${about ? `THE RESEARCHER IS LOOKING FOR: ${about}\n\n` : ""}Clearly positive means: ${IS_POSITIVE.criteria?.true}\nNot positive means: ${IS_POSITIVE.criteria?.false}\n\nReturn JSON: {"positive": true | false}` },
          ],
          (text) => {
            const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            const parsed = JSON.parse(fenced ? fenced[1].trim() : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { positive?: unknown };
            if (typeof parsed.positive !== "boolean") throw new Error("no verdict in the reply");
            return parsed.positive ? 0.9 : 0.1;
          },
          { maxTokens: 40, properties: { purpose: "testimonial-positive-fallback" } }
        );
      } catch (err) {
        console.error("[answer-judge] no positivity judge available:", err);
        return null;
      }
    })
  );
}

/** At or above this a participant counts as clearly positive. */
export const POSITIVE_AT = 0.6;

/**
 * Wake up what a follow-up needs, when a study sitting starts. The first
 * probe after a quiet spell took 8.7 s in production against 1.8 s for the
 * next one, and the page waits six seconds at most, so without this the first
 * question of a sitting would rarely get its follow-up. Speech-to-text on half
 * a second of silence and one throwaway judgment; the participant is still on
 * the consent screen or talking while it runs. Never throws.
 */
export async function warmUpProbe(env: Env): Promise<void> {
  const seconds = 0.5;
  const rate = 16000;
  const samples = Math.floor(rate * seconds);
  const wav = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(wav);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  await Promise.allSettled([
    transcribeAudio(env.AI, wav, "probe-warmup"),
    judgeAnswers(env, [{ question: "What did you have for breakfast?", transcript: "Toast and coffee, like most mornings." }], "probe-warmup"),
  ]);
}

export function probeKey(responseId: string, questionId: string) {
  return `probe:${responseId}:${questionId}`;
}

/** The follow-ups already asked for one answer in this sitting, oldest first. */
/**
 * Follow-ups the participant actually saw. The page holds Next for a few
 * seconds at most; a follow-up that comes back later than that was written
 * (it is in `probeKey`) and never shown. Only the shown ones count toward
 * the limit and are kept with the answer: a researcher deciding on a held
 * reward must not read "the agent followed up" about a question nobody saw.
 */
export function probeShownKey(responseId: string, questionId: string) {
  return `probe-shown:${responseId}:${questionId}`;
}

export async function probesShown(kv: KVNamespace, responseId: string, questionId: string): Promise<string[]> {
  try {
    const raw = await kv.get(probeShownKey(responseId, questionId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function probesAsked(kv: KVNamespace, responseId: string, questionId: string): Promise<string[]> {
  try {
    const raw = await kv.get(probeKey(responseId, questionId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Stamp every spoken answer of a response with its verdict, once the
 * transcripts exist. Studies only: a group parlo is not judged. Idempotent:
 * an answer that already has a verdict is left alone.
 */
export async function judgeResponseAnswers(env: Env, responseId: string): Promise<number> {
  const db = env.DB;
  const study = await db
    .prepare("SELECT s.id FROM responses r JOIN surveys s ON s.id = r.survey_id WHERE r.id = ? AND (s.kind = 'study' OR s.sponsor_name IS NOT NULL)")
    .bind(responseId)
    .first<{ id: string }>();
  if (!study) return 0;
  const rows = await db
    .prepare(
      `SELECT ra.id, ra.transcription, q.text, rd.purpose, COALESCE(rd.number, 1) AS round_number
       FROM response_answers ra
       JOIN survey_questions q ON q.id = ra.question_id
       LEFT JOIN rounds rd ON rd.id = q.round_id
       WHERE ra.response_id = ? AND ra.verdict IS NULL AND ra.transcription_status = 'completed'
         AND q.question_type != 'photo' AND COALESCE(rd.number, 1) > 0`
    )
    .bind(responseId)
    .all<{ id: string; transcription: string | null; text: string; purpose: string | null; round_number: number }>();
  if (rows.results.length === 0) return 0;

  // A testimonial is not an answer to a question: it is a line the person
  // chose to give. Its bonus turns on whether the line can stand as one (their
  // own words, clearly positive), not on whether it matches the ask's wording.
  // The first production run held a bonus for "it gave me my Fridays back"
  // because the ask had been about dashboards.
  const ordinary = rows.results.filter((r) => r.purpose !== "testimonial");
  const testimonials = rows.results.filter((r) => r.purpose === "testimonial");
  const [answers, lines] = await Promise.all([
    judgeAnswers(env, ordinary.map((r) => ({ question: r.text, transcript: r.transcription ?? "" })), "answer-verdict"),
    judgePositive(env, testimonials.map((r) => ({ said: r.transcription ?? "" }))),
  ]);
  const byId = new Map<string, Judged | null>();
  ordinary.forEach((r, i) => byId.set(r.id, answers[i]));
  testimonials.forEach((r, i) => {
    const score = lines[i];
    byId.set(r.id, score === null ? null : { verdict: verdictFor(score), score });
  });
  const judged = rows.results.map((r) => byId.get(r.id) ?? null);

  let stamped = 0;
  for (const [i, row] of rows.results.entries()) {
    const j = judged[i];
    if (!j) continue;
    const note =
      wordCount(row.transcription) < MIN_ANSWER_WORDS
        ? "Only a few words"
        : row.purpose === "testimonial" && j.verdict === "unanswered"
          ? "Does not read as a testimonial"
          : null;
    await db
      .prepare("UPDATE response_answers SET verdict = ?, verdict_score = ?, verdict_note = ? WHERE id = ?")
      .bind(j.verdict, j.score, note, row.id)
      .run();
    stamped++;
  }
  const counts = judged.reduce(
    (acc, j) => {
      if (j) acc[j.verdict]++;
      return acc;
    },
    { answered: 0, partial: 0, unanswered: 0 }
  );
  trackServerEvent(responseId, "answers_judged", { surveyId: study.id, responseId, ...counts });
  return stamped;
}
