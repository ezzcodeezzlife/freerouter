# Contributing to freerouter

## Add a provider

1. Add an entry to `providers.example.json` (keep `rank` order = quality first):
   ```json
   {
     "id": "myprov", "label": "MyProv Model Name",
     "base": "https://api.myprov.com/v1", "model": "model-id",
     "key": "", "env": "MYPROV_KEY",
     "hourly": 100, "daily": 1000, "monthly": 25000,
     "minIntervalMs": 2000, "rank": 12
   }
   ```
   - `env` = the env var users set instead of editing JSON (env wins over `key`).
   - Keyless APIs: set `"noKey": true` (+ `"noAuth": true` if no `Authorization` header may be sent).
   - Provider quirks go in `router.mjs` next to the existing ones (`maxOutput` clamp, `failCooldownSec`, `keepReasoning`, OpenRouter-style extra headers).
   - Non-OpenAI-compatible APIs don't fit this router — link them in the README's "see also" instead.
2. Add aliases in `router.mjs` (`ALIAS`) so `"model": "myprov"` pins it.
3. Update the README provider table + budget table.
4. Test locally: `copy providers.example.json providers.json`, add only your key, then
   `curl localhost:4001/v1/chat/completions` with `"model": "myprov"` and with `"model": "auto"`.

## Rules

- **Never commit keys.** `providers.json`, `usage.json`, `.env` are gitignored. PRs containing
  secrets will be closed. The Cloudflare entry uses a `YOUR_ACCOUNT_ID` placeholder — keep it that way.
- Keep it zero-dependency (`node router.mjs`, Node 18+). No frameworks, no build step.
- Update rate limits from the provider's docs page and link it in the PR.
