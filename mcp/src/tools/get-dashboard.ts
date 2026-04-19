import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";

export function registerGetDashboard(server: McpServer, client: ParloClient) {
  server.tool(
    "get_dashboard",
    "Get full dashboard data for a survey including all responses, respondent names, and audio URLs.",
    {
      dashboard_code: z.string().describe("The 12-character dashboard code for the survey"),
    },
    async ({ dashboard_code }) => {
      const data = await client.getDashboard(dashboard_code);

      const questionMap = new Map(data.questions.map((q) => [q.id, q.text]));

      const formatted = {
        survey: data.survey,
        questions: data.questions,
        responses: data.responses.map((r) => ({
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          submittedAt: r.submittedAt,
          answers: r.answers.map((a) => ({
            questionId: a.questionId,
            question: questionMap.get(a.questionId) ?? "Unknown question",
            audioUrl: a.audioUrl,
            transcription:
              a.transcription ??
              (a.transcriptionStatus === "pending"
                ? "[Transcribing...]"
                : a.transcriptionStatus === "failed"
                  ? "[Transcription failed]"
                  : null),
          })),
        })),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(formatted, null, 2),
          },
        ],
      };
    },
  );
}
