/**
 * Cloudflare Pages Function — injects Open Graph meta tags into index.html
 * for survey share URLs so WhatsApp / Slack / iMessage / etc. show a nice
 * preview card.
 *
 * Runs for every /s/* request (scoped via public/_routes.json). Serves the
 * same HTML to bots and humans — React hydrates fine because the meta tags
 * live in <head>, not the SPA mount point.
 *
 * URL pattern: /s/{slug}-{code} or /s/{code}
 * The trailing 6-12 char alphanumeric segment is the canonical code.
 */

interface Env {
  ASSETS: Fetcher;
}

const BACKEND_URL = "https://api.parlo.me";

function extractCode(slugOrCode: string): string {
  const match = slugOrCode.match(/([a-z0-9]{6,12})$/i);
  return match ? match[1] : slugOrCode;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const param = (ctx.params.code as string) || "";
  const code = extractCode(param);

  // Fetch the SPA shell from Pages static assets
  const shellUrl = new URL("/index.html", url);
  const asset = await ctx.env.ASSETS.fetch(shellUrl.toString());

  // Default meta values (used if survey lookup fails)
  let title = "Parlo — Voice surveys answered by speaking";
  let description =
    "A new kind of survey. Tap the link, hit record, and answer in your own voice. No typing, no signup, takes under two minutes.";

  try {
    const r = await fetch(`${BACKEND_URL}/api/s/${code}`);
    if (r.ok) {
      const survey = (await r.json()) as { title?: string | null };
      if (survey.title) {
        title = `${survey.title} — Voice Survey on Parlo`;
        description = `You're invited to "${survey.title}". Answer with your voice in under two minutes — no typing, no signup. Just tap, speak, and you're done.`;
      }
    }
  } catch {
    // Backend unreachable — fall back to defaults
  }

  const image = `${BACKEND_URL}/api/og/${code}.png`;
  const canonical = `${url.origin}/s/${param}`;

  const tags = `
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${image}">
`.trim();

  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(tags, { html: true });
      },
    })
    .transform(asset);
};
