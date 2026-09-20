# freerouter — free-model quality-waterfall router

One OpenAI-compatible endpoint in front of your 7 verified free providers.
Smartest first: **zai → mistral → openrouter → agnes → hf → cloudflare → cohere**.
First one with budget left takes the request; 429/5xx/timeout fails over
automatically (failed provider cools down 60s).

## Setup (fresh clone)

`providers.json` (your keys) is gitignored. Copy the template and fill keys
(or set the env vars `ZAI_KEY`, `MISTRAL_KEY`, `OPENROUTER_KEY`, `AGNES_KEY`,
`HF_KEY`, `CLOUDFLARE_KEY`, `COHERE_KEY`, `ROUTER_KEY` — env wins):

```bat
copy providers.example.json providers.json
notepad providers.json
```

## Run (local, free forever)

```bat
cd %USERPROFILE%\Desktop\Code\freerouter
node router.mjs
REM -> http://localhost:4001
```

Use from any tool (OpenCode, Cline, Cursor, curl):

```bat
curl -s http://localhost:4001/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer sk-local" ^
  -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
```

- `"model": "auto"` (default) = waterfall, smartest-available.
- `"model": "mistral"|"glm"|"ling"|"agnes"|"hf"|"cloudflare"|"cohere"` = pin that
  provider first, still fails over to the rest.
- `GET /v1/models` — what tools auto-discover.
- `GET /usage` — live budget dashboard (requests today/month, cooldowns).
- `GET /health` — liveness.

## Budgets (edit in providers.json)

| provider | daily | monthly |
|---|---|---|
| zai | 1000 | 30000 |
| mistral | 5000 | 150000 |
| openrouter | 50 | 1500 |
| agnes | 40000 | 300000 |
| hf | 50 | 600 |
| cloudflare | 1500 | 45000 |
| cohere | 33 | 1000 |

Counters live in `usage.json` (day resets UTC midnight, month on the 1st).

## Vercel (free Hobby)

1. `vercel` in this dir (or import the repo, root = `freerouter/`).
2. Set env vars instead of committing keys: `ZAI_KEY`, `MISTRAL_KEY`,
   `OPENROUTER_KEY`, `AGNES_KEY`, `HF_KEY`, `CLOUDFLARE_KEY`, `COHERE_KEY`,
   plus `ROUTER_KEY` (replaces `sk-local`) and `VERCEL=1`.
3. Limits there: in-memory usage counters per instance (no shared ledger
   without KV), ~60s request timeout, cold starts. For a shared ledger add
   Upstash Redis and point the ledger at it.

## OpenCode

```json
// opencode.json snippet
{ "models": [{ "id": "auto", "name": "freerouter/auto",
  "api": "openai", "baseUrl": "http://localhost:4001/v1", "apiKey": "sk-local" }] }
```
