# AI cost controls — finals production

Snapshot: **12 August 2026, Asia/Jakarta**. This is an operating control, not a
claim that AI availability is guaranteed. If any paid call fails, Talk-Active
returns the complete deterministic review and labels the engine honestly.

## Enforced layers

| Layer | Finals setting | Failure behaviour |
|---|---|---|
| Gateway key quota | Dedicated `talk-active-finals-2026` key; **USD 5 hard cap**, no refresh; alerts at 50%, 75%, and 100%; expires 19 August 2026 WIB | Gateway rejects further paid calls; product falls back |
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

- exactly one active finals key;
- hard quota USD 5, refresh `none`, alerts 50/75/100;
- expiry remains after 14 August and before the next development cycle;
- `AI_GATEWAY_API_KEY` is Sensitive in Preview and Production;
- Development may show as encrypted rather than Sensitive because Vercel does
  not permit Sensitive variables for that environment;
- automatic Gateway credit top-up remains disabled for the hackathon;
- the `/api/` WAF rule remains published, not merely saved as a draft.

Do not put the key in a screenshot, chat message, repository file, browser
bundle, or teammate's local environment. Rotate it after the finals.
