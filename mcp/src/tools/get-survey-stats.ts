import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";

export function registerGetSurveyStats(server: McpServer, client: ParloClient) {
  server.tool(
    "get_survey_stats",
    "Get summary statistics for a survey: title, total responses, latest response time, and respondent names.",
    {
      dashboard_code: z.string().describe("The 12-character dashboard code for the survey"),
    },
    async ({ dashboard_code }) => {
      const data = await client.getDashboard(dashboard_code);

      const respondentNames = data.responses
        .map((r) => [r.firstName, r.lastName].filter(Boolean).join(" "))
        .filter((name) => name.length > 0);

      const latestResponseAt =
        data.responses.length > 0
          ? data.responses.reduce((latest, r) =>
              r.submittedAt > latest ? r.submittedAt : latest,
            data.responses[0].submittedAt)
          : null;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                title: data.survey.title,
                totalResponses: data.responses.length,
                latestResponseAt,
                respondentNames,
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
