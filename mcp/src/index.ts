import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ParloClient } from "./client.js";
import { registerCreateSurvey } from "./tools/create-survey.js";
import { registerGetDashboard } from "./tools/get-dashboard.js";
import { registerGetSurveyStats } from "./tools/get-survey-stats.js";
import { registerGetSurvey } from "./tools/get-survey.js";
import { registerGetShareLinks } from "./tools/get-share-links.js";
import { registerUpdateQuestions } from "./tools/update-questions.js";
import { registerListMySurveys } from "./tools/list-my-surveys.js";
import { registerGetTranscriptions } from "./tools/get-transcriptions.js";
import { oauthHandlers } from "./oauth/handlers.js";
import { bearerAuthMiddleware } from "./oauth/middleware.js";

interface Env {
  PARLO_BACKEND_URL: string;
  PARLO_API_KEY?: string;
  PARLO_BACKEND?: Fetcher;
  OAUTH_KV: KVNamespace;
}

function createServer(env: Env, apiKey?: string): McpServer {
  const server = new McpServer({
    name: "parlo-mcp",
    version: "0.1.0",
  });

  const client = new ParloClient(
    env.PARLO_BACKEND_URL,
    apiKey || env.PARLO_API_KEY,
    env.PARLO_BACKEND,
  );

  registerCreateSurvey(server, client);
  registerGetDashboard(server, client);
  registerGetSurveyStats(server, client);
  registerGetSurvey(server, client);
  registerGetShareLinks(server);
  registerUpdateQuestions(server, client);
  registerListMySurveys(server, client);
  registerGetTranscriptions(server, client);

  return server;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "Last-Event-ID",
      "mcp-protocol-version",
    ],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
  })
);

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "parlo-mcp" }));

// OAuth routes (well-known metadata, register, authorize, token)
app.route("/", oauthHandlers);

// MCP endpoint — with OAuth bearer auth
app.all("/mcp", bearerAuthMiddleware, async (c) => {
  const apiKey = c.get("apiKey" as never) as string | undefined;
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createServer(c.env, apiKey);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export default app;
