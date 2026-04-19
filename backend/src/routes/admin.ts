/**
 * Admin API routes for prompt management.
 *
 * KV key structure:
 *   prompt:{name}       → current active version content (read by AI pipeline)
 *   prompt:{name}:meta  → JSON { currentVersion, versions: [{ version, content, createdAt, createdBy }] }
 */

import { Hono } from "hono";
import type { Env } from "../types";

const admin = new Hono<{ Bindings: Env }>();

// ── Types ──

interface PromptVersionEntry {
  version: number;
  content: string;
  createdAt: string;
  createdBy: string;
}

interface PromptMeta {
  currentVersion: number;
  versions: PromptVersionEntry[];
}

// ── Default prompts (must stay in sync with ai.ts) ──

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant that generates voice survey questions. Always respond in valid JSON.";

const DEFAULT_USER_PROMPT = `Create a voice survey based on these creator descriptions:

1. AUDIENCE: {{audience}}
2. INFO TO GATHER: {{gather}}

Generate a JSON response with:
- "title": short catchy survey title (max 50 chars)
- "questions": array of objects, each with "text" (the question) and "hint" (e.g. "Question 1 of 3")

IMPORTANT: Generate the number of questions the creator asked for. If they said "2 questions", generate exactly 2. If they didn't specify a number, default to 3. Pay close attention to what they actually want to ask — use their exact questions if they provided them, just make them sound warm and conversational.

People will answer by speaking, not typing — keep questions open-ended and natural.`;

const DEFAULTS: Record<string, string> = {
  system: DEFAULT_SYSTEM_PROMPT,
  user: DEFAULT_USER_PROMPT,
};

// ── Helpers ──

async function getMeta(kv: KVNamespace, name: string): Promise<PromptMeta | null> {
  const raw = await kv.get(`prompt:${name}:meta`);
  if (!raw) return null;
  return JSON.parse(raw) as PromptMeta;
}

async function putMeta(kv: KVNamespace, name: string, meta: PromptMeta): Promise<void> {
  await kv.put(`prompt:${name}:meta`, JSON.stringify(meta));
}

// ── Routes ──

/**
 * GET /api/admin/prompts/seed
 * Initialise "system" and "user" prompts with defaults if they don't exist in KV.
 */
admin.get("/api/admin/prompts/seed", async (c) => {
  const kv = c.env.KV;
  const seeded: string[] = [];

  for (const [name, defaultContent] of Object.entries(DEFAULTS)) {
    const existing = await getMeta(kv, name);
    if (existing) continue;

    const now = new Date().toISOString();
    const meta: PromptMeta = {
      currentVersion: 1,
      versions: [
        {
          version: 1,
          content: defaultContent,
          createdAt: now,
          createdBy: "system-seed",
        },
      ],
    };

    await kv.put(`prompt:${name}`, defaultContent);
    await putMeta(kv, name, meta);
    seeded.push(name);
  }

  return c.json({ ok: true, seeded });
});

/**
 * GET /api/admin/prompts
 * List all known prompt names with their current version number.
 *
 * Because KV list doesn't support suffix filtering, we list keys prefixed with
 * "prompt:" and collect those ending in ":meta".
 */
admin.get("/api/admin/prompts", async (c) => {
  const kv = c.env.KV;
  const prompts: { name: string; currentVersion: number }[] = [];
  const knownNames = new Set<string>();

  // Always check the known prompt names directly (KV list has eventual consistency)
  for (const name of Object.keys(DEFAULTS)) {
    const meta = await getMeta(kv, name);
    if (meta) {
      prompts.push({ name, currentVersion: meta.currentVersion });
      knownNames.add(name);
    } else {
      // Check for bare key (legacy, pre-versioning)
      const content = await kv.get(`prompt:${name}`);
      if (content) {
        prompts.push({ name, currentVersion: 0 });
        knownNames.add(name);
      }
    }
  }

  // Also scan KV for any custom prompts beyond the defaults
  let cursor: string | undefined;
  do {
    const list = await kv.list({ prefix: "prompt:", cursor });
    for (const key of list.keys) {
      if (key.name.endsWith(":meta")) {
        const name = key.name.replace(/^prompt:/, "").replace(/:meta$/, "");
        if (!knownNames.has(name)) {
          const meta = await getMeta(kv, name);
          prompts.push({ name, currentVersion: meta?.currentVersion ?? 0 });
          knownNames.add(name);
        }
      }
    }
    cursor = list.list_complete ? undefined : (list.cursor as string);
  } while (cursor);

  return c.json({ prompts });
});

/**
 * GET /api/admin/prompts/:name
 * Get prompt details: current content + full version history.
 */
admin.get("/api/admin/prompts/:name", async (c) => {
  const kv = c.env.KV;
  const name = c.req.param("name");

  const content = await kv.get(`prompt:${name}`);
  const meta = await getMeta(kv, name);

  if (!content && !meta) {
    return c.json({ error: "Prompt not found" }, 404);
  }

  return c.json({
    name,
    currentContent: content,
    currentVersion: meta?.currentVersion ?? null,
    versions: meta?.versions ?? [],
  });
});

/**
 * GET /api/admin/prompts/:name/versions/:version
 * Get a specific version's content.
 */
admin.get("/api/admin/prompts/:name/versions/:version", async (c) => {
  const kv = c.env.KV;
  const name = c.req.param("name");
  const version = parseInt(c.req.param("version"), 10);

  if (isNaN(version)) {
    return c.json({ error: "Invalid version number" }, 400);
  }

  const meta = await getMeta(kv, name);
  if (!meta) {
    return c.json({ error: "Prompt not found or has no version history" }, 404);
  }

  const entry = meta.versions.find((v) => v.version === version);
  if (!entry) {
    return c.json({ error: `Version ${version} not found` }, 404);
  }

  return c.json(entry);
});

/**
 * POST /api/admin/prompts/:name
 * Save a new version.  Body: { content: string, createdBy?: string }
 */
admin.post("/api/admin/prompts/:name", async (c) => {
  const kv = c.env.KV;
  const name = c.req.param("name");
  const body = await c.req.json<{ content: string; createdBy?: string }>();

  if (!body.content || typeof body.content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }

  const now = new Date().toISOString();
  let meta = await getMeta(kv, name);

  // Bootstrap meta from a legacy bare key if needed
  if (!meta) {
    const existingContent = await kv.get(`prompt:${name}`);
    if (existingContent) {
      meta = {
        currentVersion: 1,
        versions: [
          {
            version: 1,
            content: existingContent,
            createdAt: now,
            createdBy: "legacy-import",
          },
        ],
      };
    } else {
      meta = { currentVersion: 0, versions: [] };
    }
  }

  const newVersion = meta.currentVersion + 1;
  const entry: PromptVersionEntry = {
    version: newVersion,
    content: body.content,
    createdAt: now,
    createdBy: body.createdBy ?? "admin",
  };

  meta.currentVersion = newVersion;
  meta.versions.push(entry);

  await kv.put(`prompt:${name}`, body.content);
  await putMeta(kv, name, meta);

  return c.json({ ok: true, version: entry });
});

/**
 * POST /api/admin/prompts/:name/revert
 * Revert to a specific version. Body: { version: number }
 * Creates a NEW version with the old content (history is never mutated).
 */
admin.post("/api/admin/prompts/:name/revert", async (c) => {
  const kv = c.env.KV;
  const name = c.req.param("name");
  const body = await c.req.json<{ version: number }>();

  if (typeof body.version !== "number") {
    return c.json({ error: "version is required and must be a number" }, 400);
  }

  const meta = await getMeta(kv, name);
  if (!meta) {
    return c.json({ error: "Prompt not found or has no version history" }, 404);
  }

  const target = meta.versions.find((v) => v.version === body.version);
  if (!target) {
    return c.json({ error: `Version ${body.version} not found` }, 404);
  }

  const now = new Date().toISOString();
  const newVersion = meta.currentVersion + 1;
  const entry: PromptVersionEntry = {
    version: newVersion,
    content: target.content,
    createdAt: now,
    createdBy: `revert-to-v${body.version}`,
  };

  meta.currentVersion = newVersion;
  meta.versions.push(entry);

  await kv.put(`prompt:${name}`, target.content);
  await putMeta(kv, name, meta);

  return c.json({ ok: true, revertedFrom: body.version, version: entry });
});

export default admin;
