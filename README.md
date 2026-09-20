# freerouter: one free endpoint for all your free LLM keys

One OpenAI-compatible endpoint in front of **11 free LLM providers**.
Smartest first, automatic failover, per-provider budgets: point any
OpenAI-compatible tool at it and stop thinking about rate limits.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ezzcodeezzlife/freerouter)

```bash
git clone https://github.com/ezzcodeezzlife/freerouter.git
cd freerouter
cp providers.example.json providers.json   # Windows: copy providers.example.json providers.json
node router.mjs                            # -> http://localhost:4001 (works with ZERO keys)
```

> **Free-LLM** ([nejib1/Free-LLM](https://github.com/nejib1/Free-LLM)) tells you
> *where* the free APIs are: a maintained directory of 40+ providers with limits
> and signup links. **freerouter is the complementary runtime**: it *uses* those
> APIs behind a single endpoint with quality-waterfall routing and failover, so
> your tools keep working when any single free tier throttles. Use Free-LLM to
> find keys, freerouter to serve them.

## How it works

Requests (`"model": "auto"`, the default) walk the waterfall **smartest first**:

**zai → groq → mistral → gemini → openrouter → agnes → hf → cloudflare → cerebras → cohere → pollinations**

- First provider with budget left takes the request.
- `429` / `5xx` / timeout / `400` (provider quirk) → short bench + fail over to the next.
- `401/403` (bad key) → surfaced immediately so you fix config instead of burning fallbacks.
- Everything parked (budgets/cooldowns) → `429 + retry-after` with seconds until recovery, so loops back off instead of failing.
- Per-provider **hourly/daily/monthly budgets** + **pacing** (`minIntervalMs` gaps) so agent bursts don't self-inflict 429s.
- Reasoning chatter (`reasoning_content`, `thinking`, …) is stripped for non-reasoning providers that would `400` on it.
- Providers without a key are skipped; except **Pollinations**, which is keyless and acts as last resort. A fresh clone answers requests with zero configuration.

## Setup

**Zero-key mode:** just run it. Only Pollinations is eligible; great for a smoke test.

**Full mode:** add keys: copy the template and fill in what you have (missing keys are simply skipped):

```bash
cp providers.example.json providers.json
```

or set env vars (env wins over JSON: this is how Vercel works, no keys in the repo):

| Env var | Get a key | What you get |
|---|---|---|
| `ZAI_KEY` | [z.ai](https://z.ai/) | GLM-4.5-Flash free tier |
| `GROQ_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | Llama 3.3 70B, no card, generous |
| `MISTRAL_KEY` | [console.mistral.ai](https://console.mistral.ai/) | Mistral Small, free tier |
| `GEMINI_KEY` | [aistudio.google.com](https://aistudio.google.com/) | Gemini 2.0 Flash, no card |
| `OPENROUTER_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) | `:free` models, 50 req/day |
| `AGNES_KEY` | [apihub.agnes-ai.com](https://apihub.agnes-ai.com/) | Agnes 2.0 Flash free tier |
| `HF_KEY` | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | Serverless inference credits |
| `CLOUDFLARE_KEY` | [dash.cloudflare.com](https://dash.cloudflare.com/) → Workers AI | 10k neurons/day, no card; also replace `YOUR_ACCOUNT_ID` in the base URL |
| `CEREBRAS_KEY` | [cloud.cerebras.ai](https://cloud.cerebras.ai/) | Llama 3.3 70B free tier |
| `COHERE_KEY` | [dashboard.cohere.com/api-keys](https://dashboard.cohere.com/api-keys) | Command R7B trial, no card |
| `ROUTER_KEY` | (you choose) | Replaces the default `sk-local`; clients send `Authorization: Bearer <key>` |

Rate limits change: verify against the provider docs (or Free-LLM) and tune budgets in `providers.json`.

## Use it from anything

Anything speaking OpenAI (`baseURL` + `apiKey`) works. Router key defaults to `sk-local`.

**curl:**

```bash
curl -s http://localhost:4001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'
```

**Python (openai lib):**

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:4001/v1", api_key="sk-local")
print(client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "hi"}],
).choices[0].message.content)
```

**opencode** (`opencode.json`):

```json
{ "models": [{ "id": "auto", "name": "freerouter/auto",
  "api": "openai", "baseUrl": "http://localhost:4001/v1", "apiKey": "sk-local" }] }
```

**Cursor / Cline / Aider / Codex CLI:** set custom OpenAI endpoint to `http://localhost:4001/v1`, key `sk-local`, model `auto`.

**Pin a provider** (`"model": "groq"` tries Groq first, still fails over to the rest).
Aliases: `glm/zai, groq/llama, gemini/google, mistral, ling/openrouter, agnes,
hf/huggingface, cloudflare/cf, cerebras, cohere/r7b, pollinations/pollen`.

## Endpoints

| Endpoint | What |
|---|---|
| `POST /v1/chat/completions` | Chat (streaming supported, `x-freerouter-provider` header tells you who answered, `_fallbacks` in body shows the chain) |
| `GET /v1/models` | `auto` + every provider id/model for tool auto-discovery |
| `GET /usage` | Live budget dashboard (used hour/day/month, tokens, cooldowns) |
| `GET /ready` | `{ok, eligible[], retryAfterSec}`: poll before batch work; sleep `retryAfterSec` when `ok` is false |
| `GET /health` | Liveness |

## Deploy

**Local (free forever):** `node router.mjs` (Node 18+, zero dependencies). Windows: `start.cmd`, macOS/Linux: `sh start.sh`.

**Vercel (free Hobby):** click Deploy above or `vercel` in this dir, then set env vars
(`ZAI_KEY`, `GROQ_KEY`, … + `ROUTER_KEY`, `VERCEL=1`). Caveats: in-memory usage
counters per instance (no shared ledger without KV), ~60s function timeout, cold
starts. The router ships an embedded no-key catalog so serverless works with env
vars alone.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Provider PRs welcome: schema, budgets from
docs, aliases, README table row. **Never commit keys** (`providers.json`,
`usage.json`, `.env` are gitignored).

## License

MIT: see [LICENSE](LICENSE).
