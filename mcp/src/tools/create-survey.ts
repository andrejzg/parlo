import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ParloClient } from "../client.js";

const BASE_URL = "https://parlo.me";

export function registerCreateSurvey(server: McpServer, client: ParloClient) {
  server.tool(
    "create_survey",
    "Create a new Parlo voice survey. Provide the audience description and what info to gather, and the AI will generate interview questions.",
    {
      audience: z.string().describe("Who will be answering this survey? e.g. 'startup founders', 'my team'"),
      gather: z.string().describe("What information should the survey gather? e.g. 'feedback on our onboarding flow'"),
      title: z.string().optional().describe("Optional title for the survey"),
    },
    async ({ audience, gather, title }) => {
      const survey = await client.createSurvey({ title });

      const generated = await client.generateQuestions(survey.id, {
        audience,
        gather,
      });

      const participantLink = `${BASE_URL}/s/${survey.code}`;
      const dashboardLink = `${BASE_URL}/d/${survey.dashboardCode}`;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                surveyId: survey.id,
                surveyCode: survey.code,
                dashboardCode: survey.dashboardCode,
                title: generated.title,
                questions: generated.questions,
                participantLink,
                dashboardLink,
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
