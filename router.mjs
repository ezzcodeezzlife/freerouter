// freerouter — standalone free-model quality-waterfall router.
// Zero dependencies. Node 18+.
//   node router.mjs                      -> serves http://localhost:4001
// Vercel: api/index.mjs re-exports the default handler below.
// Ledger: usage.json on disk locally; in-memory fallback (Vercel / read-only fs).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_PATH = path.join(__dir, "providers.json");
const USAGE_PATH = path.join(__dir, "usage.json");

// Embedded catalog (no keys): last-resort fallback when neither providers.json
// nor providers.example.json is bundled (e.g. Vercel serverless). Keys come
// from env vars (see each entry's "env").
const EMBEDDED = {
  routerKey: "sk-local", port: 4001, timeoutMs: 60000, cooldownSec: 60,
  providers: [
    { id: "zai", label: "Z.AI GLM-4.5-Flash", base: "https://api.z.ai/api/paas/v4", model: "glm-4.5-flash", key: "", env: "ZAI_KEY", daily: 1000, monthly: 30000, rank: 1 },
    { id: "mistral", label: "Mistral Small 3.2 24B", base: "https://api.mistral.ai/v1", model: "mistral-small-latest", key: "", env: "MISTRAL_KEY", daily: 5000, monthly: 150000, rank: 2 },
    { id: "openrouter", label: "OpenRouter Ling 3.0 Flash VL :free", base: "https://openrouter.ai/api/v1", model: "inclusionai/ling-3.0-flash-vl:free", key: "", env: "OPENROUTER_KEY", daily: 50, monthly: 1500, rank: 3 },
    { id: "agnes", label: "Agnes 2.0 Flash", base: "https://apihub.agnes-ai.com/v1", model: "agnes-2.0-flash", key: "", env: "AGNES_KEY", daily: 40000, monthly: 300000, rank: 4 },
    { id: "hf", label: "HF Llama 3.1 8B", base: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.1-8B-Instruct", key: "", env: "HF_KEY", daily: 50, monthly: 600, rank: 5 },
    { id: "cloudflare", label: "Cloudflare Llama 3.1 8B", base: "https://api.cloudflare.com/client/v4/accounts/9832ec7f475d8a1a98cfab82554e4aea/ai/v1", model: "@cf/meta/llama-3.1-8b-instruct", key: "", env: "CLOUDFLARE_KEY", daily: 1500, monthly: 45000, rank: 6 },
    { id: "cohere", label: "Cohere Command R7B", base: "https://api.cohere.com/compatibility/v1", model: "command-r7b-12-2024", key: "", env: "COHERE_KEY", daily: 33, monthly: 1000, rank: 7 },
  ],
};

function loadConfig() {
  // Fresh clones only have providers.example.json (providers.json holds local keys, gitignored).
  let cfg = null;
  for (const p of [PROVIDERS_PATH, path.join(__dir, "providers.example.json")]) {
    try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); break; } catch { /* next */ }
  }
  if (!cfg) cfg = JSON.parse(JSON.stringify(EMBEDDED));
  // Env overrides (so Vercel uses env vars, no keys in repo).
  for (const p of cfg.providers) {
    if (p.env && process.env[p.env]) p.key = process.env[p.env];
  }
  if (process.env.ROUTER_KEY) cfg.routerKey = process.env.ROUTER_KEY;
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  return cfg;
}
const config = loadConfig();
const PORT = config.port || 4001;
const TIMEOUT = config.timeoutMs || 30000;
const COOLDOWN = (config.cooldownSec || 60) * 1000;
const ROUTER_KEY = config.routerKey || "sk-local";

// ---------- ledger (disk with memory fallback) ----------
let memLedger = null;
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStr() { return new Date().toISOString().slice(0, 7); }
function blankLedger() {
  return { day: todayStr(), month: monthStr(), counts: {}, cooldownUntil: {} };
}
function readLedger() {
  if (memLedger && process.env.VERCEL === "1") return memLedger;
  try {
    const l = JSON.parse(fs.readFileSync(USAGE_PATH, "utf8"));
    if (l.day !== todayStr()) {
      l.day = todayStr();
      l.counts = Object.fromEntries(
        Object.entries(l.counts || {}).map(([k, v]) => [k, { day: 0, month: v.month || 0, tokens: 0 }])
      );
      l.cooldownUntil = {};
    }
    if (l.month !== monthStr()) {
      l.month = monthStr();
      l.counts = {};
      l.cooldownUntil = {};
    }
    return l;
  } catch {
    return memLedger || blankLedger();
  }
}
function writeLedger(l) {
  memLedger = l;
  try { fs.writeFileSync(USAGE_PATH, JSON.stringify(l, null, 2)); } catch { /* read-only fs (Vercel): memory only */ }
}
function bump(id, tokens = 0) {
  const l = readLedger();
  const c = l.counts[id] || { day: 0, month: 0, tokens: 0 };
  c.day += 1; c.month += 1; c.tokens += tokens;
  l.counts[id] = c;
  writeLedger(l);
}
function cooldown(id, ms = COOLDOWN) {
  const l = readLedger();
  l.cooldownUntil[id] = Date.now() + ms;
  writeLedger(l);
}
function countOf(id) {
  const l = readLedger();
  return l.counts[id] || { day: 0, month: 0, tokens: 0 };
}
function coolingUntil(id) {
  const l = readLedger();
  const until = l.cooldownUntil?.[id] || 0;
  return until > Date.now() ? until : 0;
}

// ---------- routing: quality waterfall, smartest first ----------
const ordered = [...config.providers].sort((a, b) => a.rank - b.rank);

function eligible(list = ordered) {
  return list.filter((p) => {
    if (coolingUntil(p.id)) return false;
    const c = countOf(p.id);
    if (p.daily && c.day >= p.daily) return false;
    if (p.monthly && c.month >= p.monthly) return false;
    if (!p.key) return false;
    return true;
  });
}

// model alias -> provider id. "auto" (default) = full waterfall.
const ALIAS = {
  auto: null, smart: null, best: null,
  glm: "zai", "glm-4.5-flash": "zai", zai: "zai",
  mistral: "mistral", "mistral-small-latest": "mistral",
  ling: "openrouter", openrouter: "openrouter",
  agnes: "agnes", "agnes-2.0-flash": "agnes",
  hf: "hf", llama: "hf",
  cloudflare: "cloudflare", cf: "cloudflare", "cf-llama": "cloudflare",
  cohere: "cohere", r7b: "cohere", "command-r7b-12-2024": "cohere",
};
function chainFor(model) {
  const key = String(model || "auto").toLowerCase();
  const forced = ALIAS[key];
  if (forced) {
    const p = ordered.find((x) => x.id === forced);
    const rest = ordered.filter((x) => x.id !== forced);
    return [p, ...rest].filter(Boolean);
  }
  return [...ordered];
}

// ---------- provider call ----------
async function callProvider(p, body) {
  const url = p.base.replace(/\/$/, "") + "/chat/completions";
  const payload = {
    model: p.model,
    messages: body.messages,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
    ...(body.max_completion_tokens !== undefined ? { max_tokens: body.max_completion_tokens } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.stop !== undefined ? { stop: body.stop } : {}),
    ...(body.tools !== undefined ? { tools: body.tools } : {}),
    ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
    ...(body.response_format !== undefined ? { response_format: body.response_format } : {}),
    ...(body.stream ? { stream: true } : {}),
  };
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${p.key}`,
  };
  if (p.id === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:4001/";
    headers["X-Title"] = "freerouter";
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

function errKind(status) {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) return "fatal-client";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "other";
}

async function handleChat(body, res) {
  if (!body?.messages || !Array.isArray(body.messages)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "messages[] required", type: "invalid_request" } }));
    return;
  }
  const chain = chainFor(body.model);
  const tried = [];
  let lastErr = { status: 503, msg: "no providers available" };

  for (const p of chain) {
    // skip exhausted / cooling without burning a call
    if (coolingUntil(p.id)) { tried.push(`${p.id}:cooldown`); continue; }
    const c = countOf(p.id);
    if ((p.daily && c.day >= p.daily) || (p.monthly && c.month >= p.monthly)) {
      tried.push(`${p.id}:budget`); continue;
    }
    if (!p.key) { tried.push(`${p.id}:nokey`); continue; }

    let r;
    try {
      r = await callProvider(p, body);
    } catch (e) {
      tried.push(`${p.id}:timeout`);
      cooldown(p.id);
      lastErr = { status: 504, msg: `${p.id} timeout` };
      continue;
    }

    if (r.ok) {
      const tokens = 0;
      bump(p.id, tokens);
      if (body.stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-freerouter-provider": p.id,
        });
        // pass SSE through, then close
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(dec.decode(value, { stream: true }));
          }
        } catch { /* client hung up */ }
        try { res.end(); } catch { }
        return;
      }
      const data = await r.json().catch(() => ({}));
      // token usage accounting (best effort)
      try {
        const t = data?.usage?.total_tokens || 0;
        if (t) {
          const l = readLedger();
          l.counts[p.id].tokens += t;
          writeLedger(l);
        }
      } catch { }
      data._provider = p.id;
      data._fallbacks = tried;
      const out = JSON.stringify(data);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-freerouter-provider": p.id,
      });
      res.end(out);
      return;
    }

    const text = await r.text().catch(() => "");
    const kind = errKind(r.status);
    tried.push(`${p.id}:${r.status}`);
    if (kind === "fatal-client" && r.status !== 404) {
      // bad request / bad key shape: don't waste the other 6, surface it
      if (r.status === 401 || r.status === 403) cooldown(p.id, 10 * 60 * 1000);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `[${p.id}] ${text.slice(0, 500)}`, type: "provider_error" }, _fallbacks: tried }));
      return;
    }
    // 404 (model name rejected), 429, 5xx -> bench + fail over
    cooldown(p.id, r.status === 429 ? 60 * 1000 : COOLDOWN);
    lastErr = { status: r.status, msg: `[${p.id}] ${text.slice(0, 300)}` };
  }

  res.writeHead(502, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: `all providers failed: ${lastErr.msg}`, type: "all_failed" }, _fallbacks: tried }));
}

// ---------- http ----------
function send(res, code, obj, extra = {}) {
  res.writeHead(code, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(obj));
}

async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    });
    res.end();
    return;
  }
  const url = new URL(req.url || "/", "http://x");
  res.setHeader("access-control-allow-origin", "*");

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    send(res, 200, { ok: true, service: "freerouter", time: new Date().toISOString() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    send(res, 200, {
      object: "list",
      data: [
        { id: "auto", object: "model", owned_by: "freerouter" },
        ...ordered.map((p) => ({ id: p.id, object: "model", owned_by: p.id })),
        ...ordered.map((p) => ({ id: p.model, object: "model", owned_by: p.id })),
      ],
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/usage") {
    const l = readLedger();
    send(res, 200, {
      day: l.day, month: l.month,
      providers: ordered.map((p) => {
        const c = l.counts[p.id] || { day: 0, month: 0, tokens: 0 };
        return {
          id: p.id, label: p.label, model: p.model, rank: p.rank,
          usedDay: c.day, daily: p.daily, usedMonth: c.month, monthly: p.monthly,
          tokens: c.tokens, coolingUntil: coolingUntil(p.id) || 0,
        };
      }),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    // auth
    const auth = req.headers["authorization"] || "";
    if (ROUTER_KEY && auth !== `Bearer ${ROUTER_KEY}`) {
      send(res, 401, { error: { message: "bad router key (use Authorization: Bearer sk-local)", type: "auth" } });
      return;
    }
    let raw = "";
    try {
      for await (const chunk of req) raw += chunk;
    } catch {
      send(res, 400, { error: { message: "body read failed" } });
      return;
    }
    let body;
    try { body = JSON.parse(raw || "{}"); }
    catch { send(res, 400, { error: { message: "invalid JSON" } }); return; }
    await handleChat(body, res);
    return;
  }
  send(res, 404, { error: { message: "not found" } });
}

export default handler;

// standalone server (not on Vercel)
if (!process.env.VERCEL) {
  const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("router.mjs");
  if (isMain) {
    http.createServer(handler).listen(PORT, () =>
      console.log(`freerouter on http://localhost:${PORT}  (providers: ${ordered.map((p) => p.id).join(",")})`)
    );
  }
}
