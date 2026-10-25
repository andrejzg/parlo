import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";
import { BASE_URL, buildShareUrl, buildWhatsAppShareUrl } from "../slug.js";

/**
 * What the web opener falls back to when the creator said nothing usable
 * (mirrors OPENER_FALLBACK_BRIEF in frontend/src/pages/CreatorPage.tsx).
 */
const FALLBACK_BRIEF =
  "A short voice conversation with my group. Ask them, in a warm and direct way, what is on their mind about the thing I opened with, what they would change, and what they need from me. Four questions.";

const BRIEF_MAX_CHARS = 20_000;

export function registerCreateParlo(server: McpServer, client: ParloClient) {
  server.tool(
    "create_parlo",
    [
      "Create a parlo (a group chat run by an agent) and get its share link, in one call.",
      "Give it the brief in the creator's own words: who they are, who they want to hear from, what they want to know, and what they'll do with it.",
      "Pass a voice note as `opener_audio_url` and the recording becomes the opener participants hear; its transcript is used as the brief when `brief` is empty.",
      "The parlo is live when this returns: post `shareLink` into the group chat. The agent gathers the voice answers, writes the report and proposes follow-up rounds.",
    ].join(" "),
    {
      brief: z
        .string()
        .max(BRIEF_MAX_CHARS)
        .optional()
        .describe(
          "The brief, as the creator said it (transcript of their message is fine). Who they are, who should answer, what they want to know, what they'll do with it. Optional when opener_audio_url is given.",
        ),
      opener_audio_url: z
        .string()
        .url()
        .optional()
        .describe(
          "https URL of the creator's voice note (ogg/opus, m4a, mp3, wav, webm; up to 12 MB, about a minute is ideal). Stored as the opener participants hear and transcribed; the transcript stands in for a missing brief.",
        ),
      title: z.string().max(120).optional().describe("Optional title. Left out, the agent names the parlo from the brief."),
    },
    async ({ brief, opener_audio_url, title }) => {
      const typedBrief = (brief ?? "").trim();
      if (!typedBrief && !opener_audio_url) {
        return {
          content: [{ type: "text" as const, text: "Give me a brief (what to ask the group and why) or an opener_audio_url, or both." }],
          isError: true,
        };
      }

      const survey = await client.createSurvey({ title });

      let opener: { durationMs: number; transcript: string } | null = null;
      let openerError: string | null = null;
      if (opener_audio_url) {
        try {
          const saved = await client.setIntroFromUrl(survey.id, opener_audio_url);
          opener = { durationMs: saved.durationMs, transcript: saved.transcript };
        } catch (err) {
          openerError = err instanceof Error ? err.message : String(err);
        }
      }

      const transcript = opener?.transcript.trim() ?? "";
      if (!typedBrief && !transcript) {
        return {
          content: [
            {
              type: "text" as const,
              text: openerError
                ? `Could not use the voice note (${openerError}) and no brief was given, so nothing was built. Pass the brief as text, or a URL the server can fetch.`
                : "The voice note had no words I could use and no brief was given, so nothing was built. Pass the brief as text.",
            },
          ],
          isError: true,
        };
      }

      const briefUsed = (typedBrief || transcript || FALLBACK_BRIEF).slice(0, BRIEF_MAX_CHARS);
      const briefSource = typedBrief ? "brief" : transcript ? "opener_transcript" : "fallback";

      const generated = await client.generateFromBrief(survey.id, briefUsed);

      const shareLink = buildShareUrl(generated.title, survey.code);
      const result = {
        parloId: survey.id,
        code: survey.code,
        title: generated.title,
        shareLink,
        whatsappShareLink: buildWhatsAppShareUrl(shareLink),
        dashboardLink: `${BASE_URL}/d/${survey.dashboardCode}`,
        dashboardCode: survey.dashboardCode,
        questions: generated.questions,
        briefSource,
        opener,
        openerError,
      };

      const lines = [
        `Parlo "${generated.title}" is live. Share this link with the group: ${shareLink}`,
        opener
          ? `Opener saved (${describeDuration(opener.durationMs)}); participants hear it before they answer.`
          : openerError
            ? `No opener: ${openerError}. The parlo works without one.`
            : null,
        `${generated.questions.length} questions in round 1. Results and the agent's report: ${result.dashboardLink}`,
        "",
        JSON.stringify(result, null, 2),
      ].filter((l): l is string => l !== null);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

function describeDuration(ms: number): string {
  if (ms <= 0) return "length unknown";
  if (ms < 1000) return "under a second";
  return `${Math.round(ms / 1000)} s`;
}
