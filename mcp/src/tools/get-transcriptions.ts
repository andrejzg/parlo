import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";

export function registerGetTranscriptions(server: McpServer, client: ParloClient) {
  server.tool(
    "get_transcriptions",
    "Get transcribed text from all survey responses. Best tool for summarizing feedback or answering 'what did people say?'.",
    {
      dashboard_code: z.string().describe("The 12-character dashboard code for the survey"),
    },
    async ({ dashboard_code }) => {
      const data = await client.getDashboard(dashboard_code);

      const questionMap = new Map(data.questions.map((q) => [q.id, q.text]));
      const lines: string[] = [];

      lines.push(`Survey: ${data.survey.title ?? "Untitled"}`);
      lines.push(`Total responses: ${data.responses.length}`);
      lines.push("");

      for (const r of data.responses) {
        const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || "Anonymous";
        lines.push(`--- ${name} (${r.submittedAt}) ---`);

        for (const a of r.answers) {
          const question = questionMap.get(a.questionId) ?? "Unknown question";
          let answer: string;
          if (a.transcription) {
            answer = a.transcription;
          } else if (a.transcriptionStatus === "pending") {
            answer = "[Transcribing...]";
          } else if (a.transcriptionStatus === "failed") {
            answer = "[Transcription failed]";
          } else {
            answer = "[No transcription]";
          }
          lines.push(`Q: ${question}`);
          lines.push(`A: ${answer}`);
          lines.push("");
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n"),
          },
        ],
      };
    },
  );
}
