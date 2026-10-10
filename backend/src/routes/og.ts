import { Hono } from "hono";
import { ImageResponse } from "workers-og";
import type { Env } from "../types";
import { extractCode } from "../services/slug";

const og = new Hono<{ Bindings: Env }>();

// ── Parlo1 palette (dark mode) — mirrors the tokens in gui/themes/parlo1.md.
// The Worker has no CSS variables, so the theme values are defined once here.
const COLORS = {
  canvas: "#000000",        // --neutral-1
  surface: "#241f16",       // --neutral-2
  surfaceMuted: "#2f2a21",  // --neutral-3
  edge: "#413c32",          // --neutral-4
  textMuted: "#b0aa9e",     // --neutral-7
  text: "#ffffff",          // --neutral-10
  accent: "#dd4222",        // --color-1
  accentText: "#000000",    // --cte-accent-text
};

// Open Runde Bold, served by the Pages deploy (public/fonts/open-runde/).
// Satori reads WOFF (not WOFF2). The bytes are validated (WOFF magic) before
// use or caching — a Pages SPA fallback answers unknown paths with 200 HTML,
// which would otherwise poison the cache and break the render. If anything
// is off we fall back to the library default so the preview still renders.
const FONT_URL = "https://parlo.me/fonts/open-runde/OpenRunde-Bold.woff";
const FONT_CACHE_KEY = `${FONT_URL}?parlo1=2`;
const WOFF_MAGIC = 0x774f4646; // "wOFF"

function isWoff(buf: ArrayBuffer): boolean {
  return buf.byteLength > 4 && new DataView(buf).getUint32(0) === WOFF_MAGIC;
}

async function loadBrandFont(): Promise<{ name: string; data: ArrayBuffer; weight: 700; style: "normal" }[]> {
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const cached = await cache.match(FONT_CACHE_KEY);
    if (cached) {
      const data = await cached.arrayBuffer();
      if (isWoff(data)) return [{ name: "Open Runde", data, weight: 700, style: "normal" }];
    }
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`font ${res.status}`);
    const data = await res.arrayBuffer();
    if (!isWoff(data)) throw new Error(`font is not WOFF (${res.headers.get("content-type")})`);
    await cache.put(
      FONT_CACHE_KEY,
      new Response(data, { headers: { "Content-Type": "font/woff", "Cache-Control": "public, max-age=86400" } }),
    );
    return [{ name: "Open Runde", data, weight: 700, style: "normal" }];
  } catch (err) {
    console.warn("[og] brand font unavailable, using default:", err);
    return [];
  }
}

// ── Tiny seeded RNG so each survey gets a deterministic but unique pattern ─
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickPattern(seed: number): "circles" | "plus" | "squares" | "diamonds" {
  const variants = ["circles", "plus", "squares", "diamonds"] as const;
  return variants[seed % variants.length];
}

// Trim survey title length so it fits the card
function fitTitle(title: string): { text: string; size: number } {
  const len = title.length;
  if (len <= 28) return { text: title, size: 88 };
  if (len <= 50) return { text: title, size: 68 };
  if (len <= 80) return { text: title, size: 52 };
  return { text: title.slice(0, 78) + "…", size: 48 };
}

// workers-og's HTML parser does NOT decode entities, so we only neutralise
// the chars that would actually break parsing. `&` is fine to pass through.
function safeText(s: string): string {
  return s.replace(/[<>]/g, "");
}

// Build a base64-encoded SVG to use as a CSS background-image. Satori
// supports url(data:...svg+xml;base64) on background-image which is the
// standard workaround for its lack of <pattern> support.
function patternBgUrl(seed: number, variant: string): string {
  const tile = 70;
  let inner = "";
  switch (variant) {
    case "circles":
      inner = `
        <circle cx="35" cy="35" r="3" fill="${COLORS.edge}" opacity="0.9"/>
        <circle cx="35" cy="35" r="14" fill="none" stroke="${COLORS.edge}" stroke-width="1" opacity="0.5"/>
        <circle cx="35" cy="35" r="28" fill="none" stroke="${COLORS.edge}" stroke-width="0.6" opacity="0.25"/>`;
      break;
    case "plus":
      inner = `
        <line x1="35" y1="27" x2="35" y2="43" stroke="${COLORS.edge}" stroke-width="1.5" opacity="0.8"/>
        <line x1="27" y1="35" x2="43" y2="35" stroke="${COLORS.edge}" stroke-width="1.5" opacity="0.8"/>
        <circle cx="35" cy="35" r="22" fill="none" stroke="${COLORS.edge}" stroke-width="0.6" opacity="0.25"/>`;
      break;
    case "squares":
      inner = `
        <rect x="31" y="31" width="8" height="8" rx="2" fill="${COLORS.edge}" opacity="0.8"/>
        <rect x="17" y="17" width="36" height="36" rx="8" fill="none" stroke="${COLORS.edge}" stroke-width="0.8" opacity="0.4"/>`;
      break;
    case "diamonds":
    default:
      inner = `
        <polygon points="35,25 45,35 35,45 25,35" fill="none" stroke="${COLORS.edge}" stroke-width="1" opacity="0.8"/>
        <circle cx="35" cy="35" r="2" fill="${COLORS.edge}" opacity="0.9"/>`;
      break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}">${inner}</svg>`;
  // btoa works in the Workers runtime
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ── GET /api/og/:code.png ── Open Graph preview image ───────────────────
og.get("/api/og/:code{.+\\.png}", async (c) => {
  try {
    const param = c.req.param("code").replace(/\.png$/, "");
    const code = extractCode(param);
    const db = c.env.DB;

    const survey = await db
      .prepare("SELECT title FROM surveys WHERE code = ?")
      .bind(code)
      .first<{ title: string | null }>();

    const rawTitle = survey?.title ?? "Voice Survey";
    const { text, size } = fitTitle(rawTitle);

    const seed = hashSeed(code);
    const variant = pickPattern(seed);
    const bgUrl = patternBgUrl(seed, variant);

    console.log(`[og] rendering code=${code} title="${rawTitle}" variant=${variant}`);

    // Parlo1: black canvas with a subtle per-survey texture, one flat
    // neutral-2 card (no border), Open Runde, accent pill with black text.
    const html = `
<div style="display:flex;width:1200px;height:630px;background-color:${COLORS.canvas};background-image:url('${bgUrl}');background-repeat:repeat;font-family:'Open Runde',sans-serif;align-items:center;justify-content:center;padding:60px;">
  <div style="display:flex;flex-direction:column;width:920px;height:454px;background:${COLORS.surface};border-radius:42px;padding:48px 64px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;font-size:20px;color:${COLORS.textMuted};font-weight:700;letter-spacing:4px;">PARLO</div>
      <div style="display:flex;font-size:18px;color:${COLORS.textMuted};letter-spacing:0.5px;">parlo.me</div>
    </div>
    <div style="display:flex;flex-grow:1;align-items:center;justify-content:center;padding:24px 0;">
      <div style="display:flex;font-size:${size}px;font-weight:700;color:${COLORS.text};text-align:center;line-height:1.08;letter-spacing:-0.02em;">
        ${safeText(text)}
      </div>
    </div>
    <div style="display:flex;width:100%;justify-content:center;align-items:center;">
      <div style="display:flex;align-items:center;background:${COLORS.accent};color:${COLORS.accentText};font-size:20px;font-weight:700;padding:14px 28px;border-radius:9999px;letter-spacing:0.2px;">
        Tap to answer with your voice
      </div>
    </div>
  </div>
</div>`.trim();

    const fonts = await loadBrandFont();
    const res = new ImageResponse(html, {
      width: 1200,
      height: 630,
      format: "png",
      ...(fonts.length ? { fonts } : {}),
    });

    // Materialise the PNG before answering: a render error inside the stream
    // would otherwise go out as an empty 200 and get cached at the edge.
    const png = await res.arrayBuffer();
    if (png.byteLength < 8 || new DataView(png).getUint32(0) !== 0x89504e47) {
      throw new Error(`render produced ${png.byteLength} bytes`);
    }

    // Cache aggressively at the edge — survey titles are stable
    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch (err) {
    console.error("[og] render failed:", err);
    return c.json({ error: String(err) }, 500, { "Cache-Control": "no-store" });
  }
});

export default og;
