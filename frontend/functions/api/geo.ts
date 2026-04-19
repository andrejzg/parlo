/** Cloudflare Pages Function that returns the visitor's country code from CF-IPCountry header. */
export const onRequestGet: PagesFunction = async (context) => {
  const country = context.request.headers.get("CF-IPCountry") || "US";
  return new Response(JSON.stringify({ country }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
