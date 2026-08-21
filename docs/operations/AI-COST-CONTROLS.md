# AI cost controls — finals production

Snapshot: **21 August 2026, Asia/Jakarta** (first written 12 August; key
rotated and the expiry check added after the 19 August outage recorded below).
This is an operating control, not a claim that AI availability is guaranteed.
If any paid call fails, Talk-Active returns the complete deterministic review
and labels the engine honestly.

## Enforced layers

| Layer | Finals setting | Failure behaviour |
|---|---|---|
| Gateway key quota | Dedicated `talk-active-2026` key; **USD 5 hard cap**, no refresh; alerts at 50%, 75%, and 100%; **no expiry** — see the incident below | Gateway rejects further paid calls; product falls back |
| Vercel WAF | `/api/` limited to 20 requests per 60 seconds using IP and JA4 | Excess requests receive 429 before a model call |
| Prompt ceiling | 12,000 transcript characters; 8,000 rubric characters; at most 20 criteria | Typed 400 response before a model call; no silent truncation |
| Semantic cache | Repeated analysis and repeated rubric imports are cached in a warm function instance | Exact stage replays do not create a second model call |
| Provider chain | Haiku primary, nano and flash-lite fallbacks, total chain budget 22 seconds | Complete deterministic result if every provider fails |

The CLI audit found one active key, no leak marker, a non-refreshing USD 5
quota, and USD 0.03105 spent at the time of inspection. The absolute worst-case
Gateway exposure for this key is therefore the remaining quota, not the credit
balance or an unlimited auto top-up.

Production deployment `dpl_F6bERTGpG4ma8X6BiAv7z6S47kZB`, built from runtime
commit `a0e51aa17adac351a05ba5af3a5c8c19dbfdd398`, was smoke-tested on 12 August:
semantic analysis returned through Haiku and replayed with `cached:true`; rubric
import also replayed with `cached:true`; a 12,001-character transcript returned
typed HTTP 400 before reaching a provider.

## Captain checks

Run these without copying or printing the key value:

```bash
vercel ai-gateway api-keys list
vercel ai-gateway budgets list
vercel env ls
```

Accept only this state before the public demo:

- exactly one active key;
- hard quota USD 5, refresh `none`, alerts 50/75/100;
- `pnpm check:gateway` reports `status: passed` — this replaces the hand-read
  expiry line that failed to prevent the 19 August outage;
- `AI_GATEWAY_API_KEY` is Sensitive in Preview and Production;
- Development may show as encrypted rather than Sensitive because Vercel does
  not permit Sensitive variables for that environment;
- automatic Gateway credit top-up remains disabled for the hackathon;
- the `/api/` WAF rule remains published, not merely saved as a draft.

Do not put the key in a screenshot, chat message, repository file, browser
bundle, or teammate's local environment.

## Incident — semantic tier dark, 19 to 21 August 2026

`talk-active-finals-2026` was created on 12 August with `--expiration 7d` and
expired at 02.19 on 19 August. Its last successful call was 18 August, 16.31.
From then until 21 August every model call returned HTTP 401, so
`judgeCriterion` classified the failure as `provider_unavailable` and returned
the deterministic reading — correct behaviour, and completely silent. Production
`/api/analyze` served `mode: deterministic` for roughly two days.

Three things were true at once, and all three had to change:

1. **The fuse was documented, not enforced.** The expiry lived in the table
   above and in nothing that runs. `pnpm check:gateway` now reads key expiry
   from the Vercel CLI and fails when no key has runway left.
2. **The replacement carries no expiry.** The USD 5 hard cap is what bounds
   exposure; a wall-clock fuse only bounded availability.
3. **The interface kept advertising the tier.** `/api/capabilities` answered
   from environment-variable presence alone. It now also consults observed
   health (`apps/web/lib/ai/semantic-health.ts`), which withdraws the claim
   after a real authentication failure.

`AI_GATEWAY_API_KEY` had also never been set for Preview, so preview
deployments had never run semantic analysis at all. It is now set, Sensitive,
for both Production and Preview.

Development still holds the dead key and is non-Sensitive by Vercel's rule, so
local `pnpm dev` runs deterministic until someone pulls a fresh value.
