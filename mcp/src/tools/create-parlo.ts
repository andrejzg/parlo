import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";

const BRIEF_MAX_CHARS = 20_000;

/**
 * One call to a live parlo. Thin: the backend's `POST /api/agent/parlos` does
 * the chain (create, opener from URL, generate, go-live) and decides the
 * links; this tool only shapes the reply. With the OAuth-mapped API key the
 * caller's user owns the parlo, so there is no claim link; the opener link
 * (a WhatsApp deep link to Parlo's number) is what the agent passes on.
 */
export function registerCreateParlo(server: McpServer, client: ParloClient) {
  server.tool(
    "create_parlo",
    [
      "Create a parlo (a group chat run by an agent) and get its share link, in one call.",
      "Give it the brief in the creator's own words: who they are, who they want to hear from, what they want to know, and what they'll do with it.",
      "Pass a voice note as `opener_audio_url` if you hold one; otherwise send the person the returned `openerLink`, a WhatsApp link where they record the opener the group hears first.",
      "The parlo is live when this returns: post `shareLink` into the group chat.",
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
          "https URL of the creator's voice note (ogg/opus, m4a, mp3, wav, webm; up to 12 MB). Stored as the opener participants hear and transcribed; the transcript stands in for a missing brief.",
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

      const result = await client.createParlo({
        brief: typedBrief || undefined,
        opener_audio_url,
        title,
      });

      const lines = [
        `Parlo "${result.title}" is live. Share this link with the group: ${result.shareLink}`,
        result.opener
          ? `Opener saved (${describeDuration(result.opener.durationMs)}); participants hear it before they answer.`
          : `No opener yet. Send the person this link; they tap it and send Parlo a voice note on WhatsApp (30 to 60 s: who they are, what they want to hear, what they'll do with it): ${result.openerLink}`,
        result.claimLink ? `Claim link for the person (one tap makes the parlo theirs): ${result.claimLink}` : null,
        `${result.questions.length} questions in round 1. Results and the agent's report: ${result.dashboardLink}`,
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
