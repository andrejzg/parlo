import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BASE_URL = "https://parlo.me";

export function registerGetShareLinks(server: McpServer) {
  server.tool(
    "get_share_links",
    "Generate shareable links for a survey. Returns the participant link, a pre-filled WhatsApp share link, and optionally the dashboard link.",
    {
      survey_code: z.string().describe("The 6-character survey code"),
      dashboard_code: z.string().optional().describe("The 12-character dashboard code (optional)"),
    },
    async ({ survey_code, dashboard_code }) => {
      const participantLink = `${BASE_URL}/s/${survey_code}`;
      const whatsappText = encodeURIComponent(
        `Hey! I'd love to hear your thoughts. It takes 2 minutes — just tap and talk: ${participantLink}`,
      );
      const whatsappShareLink = `https://wa.me/?text=${whatsappText}`;

      const result: Record<string, string> = {
        participantLink,
        whatsappShareLink,
      };

      if (dashboard_code) {
        result.dashboardLink = `${BASE_URL}/d/${dashboard_code}`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
