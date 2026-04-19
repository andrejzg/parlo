import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";

export function registerGetSurvey(server: McpServer, client: ParloClient) {
  server.tool(
    "get_survey",
    "Get a survey's details including title, status, and questions. Uses the 6-character participant code.",
    {
      code: z.string().describe("The 6-character survey code"),
    },
    async ({ code }) => {
      const survey = await client.getSurvey(code);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: survey.id,
                title: survey.title,
                status: survey.status,
                questions: survey.questions.map((q) => ({
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
