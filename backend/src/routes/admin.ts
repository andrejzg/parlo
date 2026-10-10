/**
 * Admin API routes for prompt management.
 *
 * KV key structure:
 *   prompt:{name}       → current active version content (read by AI pipeline)
 *   prompt:{name}:meta  → JSON { currentVersion, versions: [{ version, content, createdAt, createdBy }] }
 */

import { Hono } from "hono";
import type { Env } from "../types";
import { PROMPT_DEFAULTS } from "../services/ai";

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

// ── Default prompts ──
// Single source of truth is services/ai.ts (system, user, brief, clarify);
// importing it here means seeding and the AI pipeline can never drift.

const DEFAULTS: Record<string, string> = PROMPT_DEFAULTS;

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
