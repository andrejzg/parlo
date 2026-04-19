import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ParloClient } from "../client.js";

export function registerListMySurveys(server: McpServer, client: ParloClient) {
  server.tool(
    "list_my_surveys",
    "List all surveys created by the authenticated user. Requires an API key to be configured.",
    {},
    async () => {
      try {
        const surveys = await client.listMySurveys();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                surveys.map((s) => ({
                  id: s.id,
                  code: s.code,
                  dashboardCode: s.dashboardCode,
                  title: s.title,
                  status: s.status,
                  responseCount: s.responseCount,
                  createdAt: s.createdAt,
                  participantLink: `https://parlo.me/s/${s.code}`,
                  dashboardLink: `https://parlo.me/d/${s.dashboardCode}`,
                })),
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof Error && err.message.includes("API key is required")) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: API key is not configured. Set the PARLO_API_KEY secret in your wrangler config to use this tool.",
              },
            ],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
