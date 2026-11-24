// A stand-in for the Tremendous sandbox, for local runs of the reward flow without an account.
// Shaped from its public docs (https://developers.tremendous.com/llms.txt):
// POST /orders (delivery.method LINK), GET /campaigns, POST /rewards/:id/generate_link.
//
//   node backend/test/tremendous-stub.mjs          # listens on 127.0.0.1:8799
//   cd backend && npx wrangler dev --port 8787 \
//     --var TREMENDOUS_API_KEY:TEST_stub --var TREMENDOUS_API_BASE:http://127.0.0.1:8799/api/v2
//
// A recipient whose name starts with "Nofunds" gets a 402. Requests are logged (without the key) to $STUB_LOG.
import http from "node:http";
import fs from "node:fs";

const PORT = 8799;
const LOG = process.env.STUB_LOG ?? "/tmp/tremendous-stub-requests.jsonl";
const orders = new Map(); // external_id → order
let seq = 0;

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const auth = req.headers.authorization ?? "";
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = "unparseable"; }
      fs.appendFileSync(LOG, JSON.stringify({ method: req.method, url: req.url, authorised: auth === "Bearer TEST_stub", body }) + "\n");
      if (auth !== "Bearer TEST_stub") return send(res, 401, { errors: { message: "Invalid API key" } });

      if (req.method === "GET" && req.url.startsWith("/api/v2/campaigns")) {
        return send(res, 200, { campaigns: [{ id: "CAMPAIGNSTUB1", name: "Default" }], total_count: 1 });
      }
      if (req.method === "POST" && req.url === "/api/v2/orders") {
        const r = body?.reward;
        const payload = {};
        if (!body?.payment?.funding_source_id) payload.payment = { funding_source_id: "Your request was missing a funding_source_id." };
        if (!r?.campaign_id && !r?.products?.length) payload.reward = { products: "Either products or campaign_id must be specified." };
        if (typeof r?.value?.denomination !== "number" || r.value.denomination <= 0) payload.value = { denomination: "must be greater than 0" };
        if (r?.delivery?.method !== "LINK") payload.delivery = { method: "expected LINK in this stub" };
        if (!r?.recipient?.name) payload.recipient = { name: "is required" };
        if (Object.keys(payload).length) return send(res, 400, { errors: { message: "Order failed: validation failure", payload } });
        if (r.recipient.name.startsWith("Nofunds")) return send(res, 402, { errors: { message: "Not enough funds in your account" } });

        const existing = body.external_id && orders.get(body.external_id);
        if (existing) {
          // A repeated external_id returns the first order, without a link.
          const copy = structuredClone(existing);
          delete copy.rewards[0].delivery.link;
          return send(res, 201, { order: copy });
        }
        const n = ++seq;
        const order = {
          id: `ORDER${n}`,
          external_id: body.external_id ?? null,
          status: "EXECUTED",
          payment: { subtotal: r.value.denomination, total: r.value.denomination, fees: 0 },
          rewards: [
            {
              id: `REWARD${n}`,
              order_id: `ORDER${n}`,
              value: r.value,
              delivery: { method: "LINK", status: "SUCCEEDED", link: `https://testflight.tremendous.com/rewards/payout/stub-first-${n}` },
              recipient: r.recipient,
            },
          ],
        };
        if (body.external_id) orders.set(body.external_id, order);
        return send(res, 200, { order });
      }
      const m = req.method === "POST" && req.url.match(/^\/api\/v2\/rewards\/([^/]+)\/generate_link$/);
      if (m) return send(res, 200, { reward: { id: m[1], link: `https://testflight.tremendous.com/rewards/payout/stub-fresh-${m[1]}-${Date.now()}` } });
      send(res, 404, { errors: { message: "Not found" } });
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`tremendous stub on ${PORT}`));
