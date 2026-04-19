# Parlo MCP Server

MCP (Model Context Protocol) server for Parlo — create and monitor voice surveys from within AI assistants like Claude, ChatGPT, etc.

**Live:** `https://parlo-mcp.andrej-c9b.workers.dev/mcp`

## What it does

From an AI assistant, you can say things like:
- "Create a voice survey about customer satisfaction for my restaurant"
- "How many responses has my survey gotten?"
- "Show me what people said"
- "Change question 2 to ask about wait times"
- "Give me the WhatsApp share link"

## Tools (8)

| Tool | Description |
|------|-------------|
| `create_survey` | Creates a survey + generates questions via AI from a text description of audience and what to gather |
| `get_dashboard` | Full response data — respondent names, timestamps, audio/photo/video URLs, transcriptions |
| `get_survey_stats` | Quick summary — response count, latest activity, respondent names |
| `get_survey` | Survey details (title, status, questions) by participant code |
| `get_share_links` | Participant link, WhatsApp share link, dashboard link |
| `get_transcriptions` | Just the Whisper transcripts for a survey's responses — leaner than `get_dashboard` when you only need the text |
| `update_questions` | Replace a survey's questions with a new set |
| `list_my_surveys` | All surveys for the authenticated creator (requires API key) |

## Setup

### Claude Code / Claude Desktop

Add to `.mcp.json` in your project root (or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "parlo": {
      "type": "http",
      "url": "https://parlo-mcp.andrej-c9b.workers.dev/mcp"
    }
  }
}
```

Restart Claude Code to pick it up.

### With API key (for `list_my_surveys`)

When you create your first survey via the MCP, the backend returns an API key (`pk_...`). To use `list_my_surveys`, set the key as a wrangler secret:

```bash
wrangler secret put PARLO_API_KEY --config mcp/wrangler.toml
```

## Architecture

```
┌─────────────────┐    Service Binding     ┌──────────────────┐
│   parlo-mcp     │ ────────────────────>  │  parlo-backend   │
│  (CF Worker)    │    (zero latency)      │  (CF Worker)     │
│                 │                        │                  │
│  Hono + MCP SDK │                        │  Hono + D1 + R2  │
│  Streamable HTTP│                        │  + Workers AI    │
└─────────────────┘                        └──────────────────┘
```

- **Transport:** Streamable HTTP (Web Standard) — works with Claude Code's `type: "http"` MCP config
- **Worker-to-Worker:** Service Binding (`PARLO_BACKEND`) for direct calls, no network hop
- **Stateless:** Fresh MCP server per request — no Durable Objects or session state needed
- **Auth:** API keys (`pk_` prefix) stored on creator records in D1

## Development

```bash
cd mcp
npm install
npm run dev        # local dev server
npm run deploy     # deploy to Cloudflare
```

Or with the global wrangler:

```bash
/Users/andrejzg/.npm-global/bin/wrangler deploy --config /Users/andrejzg/work/repos/parlo/mcp/wrangler.toml
```

## Roadmap

### Phase 2 (Next)
- OAuth auth (replace API key copy-paste)
- Custom domain: `mcp.parlo.me`
- MCP resources (`parlo://survey/{code}`, `parlo://dashboard/{code}`)

### Phase 3 (Future)
- `analyze_responses` — AI-powered thematic analysis across transcripts
- **Dynamic Workers** — adaptive surveys with AI-generated follow-up logic per response
- Real-time notifications when new responses arrive
- **Multimodal answers** — let the LLM reason over photo/video answers directly (URLs are already exposed in `get_dashboard` — it's the model-side handling that's not yet wired up)

### Shipped
- ✅ **Whisper transcription** — `get_transcriptions` tool + `transcription` field on `get_dashboard` answers (`pending` / `completed` / `failed`)
- ✅ **Photo & video question types** — surveys can now mix voice, photo, and video questions. The AI picks the type per question based on the gather goal. Dashboard returns `audioUrl` / `imageUrl` / `videoUrl`.
