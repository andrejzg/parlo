import { Hono } from "hono";
import { ImageResponse } from "workers-og";
import type { Env } from "../types";
import { extractCode } from "../services/slug";

const og = new Hono<{ Bindings: Env }>();

// ── Color palette (matches Parlo brand + Vienna Secession warmth) ──────
const COLORS = {
  bgDark: "#0a0c12",       // deep navy ~ hsl(225 25% 4%)
  orange: "#fb923c",       // primary accent ~ hsl(22 95% 62%)
  gold: "#c8a04a",         // warmer gold for borders / decoration
  goldFaint: "rgba(200,160,74,0.10)",
  cream: "#f5efe1",        // ~ hsl(40 30% 94%)
  ink: "#0e1016",          // dark text on cream
  goldHair: "rgba(200,160,74,0.45)",
};

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
        <circle cx="35" cy="35" r="3" fill="#c8a04a" opacity="0.45"/>
        <circle cx="35" cy="35" r="14" fill="none" stroke="#c8a04a" stroke-width="1" opacity="0.20"/>
        <circle cx="35" cy="35" r="28" fill="none" stroke="#fb923c" stroke-width="0.6" opacity="0.10"/>`;
      break;
    case "plus":
      inner = `
        <line x1="35" y1="27" x2="35" y2="43" stroke="#c8a04a" stroke-width="1.5" opacity="0.40"/>
        <line x1="27" y1="35" x2="43" y2="35" stroke="#c8a04a" stroke-width="1.5" opacity="0.40"/>
        <circle cx="35" cy="35" r="22" fill="none" stroke="#fb923c" stroke-width="0.6" opacity="0.10"/>`;
      break;
    case "squares":
      inner = `
        <rect x="31" y="31" width="8" height="8" fill="#c8a04a" opacity="0.40"/>
        <rect x="17" y="17" width="36" height="36" fill="none" stroke="#c8a04a" stroke-width="0.8" opacity="0.18"/>`;
      break;
    case "diamonds":
    default:
      inner = `
        <polygon points="35,25 45,35 35,45 25,35" fill="none" stroke="#c8a04a" stroke-width="1" opacity="0.40"/>
        <circle cx="35" cy="35" r="2" fill="#fb923c" opacity="0.40"/>`;
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

    // Vienna Secession-style: tiled SVG pattern background, framed cream card.
    const html = `
<div style="display:flex;width:1200px;height:630px;background-color:${COLORS.bgDark};background-image:url('${bgUrl}');background-repeat:repeat;font-family:sans-serif;align-items:center;justify-content:center;padding:60px;">
  <div style="display:flex;flex-direction:column;width:920px;height:454px;background:${COLORS.cream};border:2px solid ${COLORS.gold};border-radius:14px;padding:48px 64px;">
    <div style="display:flex;align-items:center;justify-content:center;">
      <div style="display:flex;width:14px;height:14px;border-radius:9999px;background:${COLORS.orange};margin-right:14px;"></div>
      <div style="display:flex;font-size:24px;color:${COLORS.orange};font-weight:700;letter-spacing:8px;">PARLO</div>
    </div>
    <div style="display:flex;width:100%;height:1px;background:${COLORS.goldHair};margin-top:28px;margin-bottom:36px;"></div>
    <div style="display:flex;flex-grow:1;align-items:center;justify-content:center;">
      <div style="display:flex;font-size:${size}px;font-weight:800;color:${COLORS.ink};text-align:center;line-height:1.06;">
        ${safeText(text)}
      </div>
    </div>
    <div style="display:flex;width:100%;height:1px;background:${COLORS.goldHair};margin-top:32px;margin-bottom:24px;"></div>
    <div style="display:flex;width:100%;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;background:${COLORS.orange};color:${COLORS.bgDark};font-size:20px;font-weight:700;padding:14px 26px;border-radius:9999px;letter-spacing:0.5px;">
        <div style="display:flex;width:10px;height:10px;border-radius:9999px;background:${COLORS.bgDark};margin-right:12px;"></div>
        Tap to answer with your voice
      </div>
      <div style="display:flex;font-size:18px;color:${COLORS.gold};letter-spacing:1px;">parlo.me</div>
    </div>
  </div>
</div>`.trim();

    const res = new ImageResponse(html, {
      width: 1200,
      height: 630,
      format: "png",
    });

    // Cache aggressively at the edge — survey titles are stable
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800");
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    console.error("[og] render failed:", err);
    return c.json({ error: String(err) }, 500);
  }
});

export default og;
