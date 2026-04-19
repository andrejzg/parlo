import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";

export function registerUpdateQuestions(server: McpServer, client: ParloClient) {
  server.tool(
    "update_questions",
    "Replace a survey's questions with a new set. Deletes existing questions and inserts the provided ones.",
    {
      survey_id: z.string().describe("The survey ID (UUID)"),
      questions: z
        .array(
          z.object({
            text: z.string().describe("The question text"),
            hint: z.string().optional().describe("Optional hint/subtext for the question"),
          }),
        )
        .describe("Array of questions to set on the survey"),
    },
    async ({ survey_id, questions }) => {
      const result = await client.updateQuestions(survey_id, questions);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                questions: result.questions.map((q) => ({
                  id: q.id,
                  text: q.text,
                  hint: q.hint,
                  sortOrder: q.sort_order,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
