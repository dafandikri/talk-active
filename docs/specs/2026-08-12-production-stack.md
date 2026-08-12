# Talk-Active — Production stack amendment

**Date:** 2026-08-12 · **Status:** active
**Amends:** [`2026-08-11-target-architecture.md`](2026-08-11-target-architecture.md) and
[`2026-08-11-ai-layer.md`](2026-08-11-ai-layer.md). Everything in those documents stands
except where contradicted here.

This is an amendment, not a replacement. The target architecture is sound — single Next.js
App Router project, Postgres via Drizzle, per-criterion evidence judging, deterministic
grounding, no LLM verifier. Those arguments were re-checked today and survive. What follows
is the part that needed version-pinning, the one decision that needs overturning, and three
production concerns neither document covers.

**Framing:** hackathon constraints do not apply here. This describes what Talk-Active should
be built on as a product with real users, not what survives a four-day sprint.

---

## 1. What changed since 11 August

| Area | Was | Now | Why |
|---|---|---|---|
| Next.js | "App Router" | **16.3.0**, Cache Components on | 16.3 shipped 3 Aug 2026; `use cache` replaces route-segment config |
| Structured output | "constrained decoding" | **`Output.object()` + Zod** (AI SDK v7) | current structured output lives on `generateText`/`streamText` |
| Provider failover | hand-rolled only | **hand-rolled *and* gateway** | they trigger on different failures; see §3 |
| Auth | Clerk | **Better Auth** | Clerk has no Indonesian or regional data residency; see §2 |
| ORM | Drizzle | Drizzle — **unchanged** | still the 2026 default for Next.js + Neon on Vercel |
| Tailwind | dropped | dropped — **unchanged** | the CSS custom-property system has a test proving fidelity |

Everything else in the two source documents is unchanged.

---

## 2. Clerk → Better Auth

**This overturns `body.tex` Table 3 and §10 of the target architecture. It is the only
decision here that reverses a previous one, so the reasoning is given in full.**

Talk-Active is built for Indonesian university students and both existing specs commit the
product to **UU PDP No. 27/2022** — including hard delete via cascade, explicitly chosen over
soft-delete flags. That commitment is the reason this changes.

UU PDP became fully effective 17 October 2024 and binds any party processing the data of
Indonesian data subjects, wherever that processing happens. Cross-border transfer is lawful
by exactly three routes: an **adequacy** finding for the recipient country, **binding
safeguards**, or the data subject's **consent**. The Indonesian government has issued no
implementing guidance on what satisfies adequacy or what instruments count as adequate and
binding.

**Clerk stores user data in the United States and offers no regional data residency option as
of 2026.** Two of the three lawful routes are therefore unavailable to us by construction —
we cannot claim adequacy Indonesia has not granted, and we cannot point to binding
instruments the regulator has not defined. Every account would rest on consent alone, for a
transfer that buys the product nothing a local session table would not.

Better Auth keeps sessions and identity in the Postgres deployment we choose rather than in
an auth vendor's fixed US region. The chosen Neon region is Singapore (`ap-southeast-1`), so
this is still a cross-border transfer from Indonesia and must use a lawful transfer mechanism
and be disclosed at collection. The benefit is control and data minimisation, not a claim that
the transfer disappears. The Auth.js team joined Better Auth in September 2025, so this is the
maintained successor to the Next.js default rather than a fringe pick.

**The honest cost.** Better Auth ships no drop-in UI, so sign-in and account screens are ours
to build and to keep accessible. Clerk would have given us those free. We are trading a few
days of interface work for not having to explain, to a regulator or a university partner, why
Indonesian students' identities live in Virginia. For this product that trade is obviously
right; for a different product it might not be.

**What does not change.** The guest path stays. A visitor still reaches the product without
an account — that was the correct instinct at the booth and it is the correct default in
production. Accounts exist to sync work across devices, not to gate the first run.

**Still crossing the border: model inference.** Transcripts go to model providers outside
Indonesia and no auth choice changes that. That transfer is consented, disclosed at the point
of use, and minimised — one criterion per call, the transcript never stored by the provider,
`disallowPromptTraining` set on the gateway. Moving auth in-region is not a claim that
everything is in-region, and the privacy copy must not imply it.

---

## 3. The AI layer, corrected for AI SDK v7

The design in [`2026-08-11-ai-layer.md`](2026-08-11-ai-layer.md) is unchanged. Only the
transport is restated.

### 3.1 Two failover mechanisms, not one

The AI layer spec argues for a hand-rolled failover chain and warns against assuming an SDK
replaces it. That argument is right and gets sharper now that the gateway's own fallback is
explicit in the API. **They catch different failures and both are needed.**

```ts
const result = await generateText({
  model: 'anthropic/claude-sonnet-4.6',
  output: Output.object({ schema: EvidenceVerdict }),
  providerOptions: {
    gateway: {
      models: ['openai/gpt-5.4-mini', 'google/gemini-3-flash'], // transport failover
      disallowPromptTraining: true,
      providerTimeouts: { anthropic: 8_000 },
    },
  },
});
```

| Failure | Caught by |
|---|---|
| Provider down, rate-limited, timing out | **Gateway** `models[]` — transport concern, no application code |
| HTTP 200 carrying an invented quote | **Us** — `spanIsGrounded` fails, retry stricter, then next vendor, then deterministic |

The gateway will never retry a well-formed response containing a fabricated citation, because
nothing at the transport layer knows the citation is false. That is precisely this product's
most valuable retry trigger, and it stays application logic. Deleting the hand-rolled chain
because "the gateway does failover now" would remove the only defence against the failure mode
that matters most.

One simplification is real: the hand-rolled chain no longer needs to enumerate vendors for
*availability*. It handles grounding failure; the gateway handles availability. The chain gets
shorter, not absent.

### 3.2 Constrained decoding earns the envelope, not the content

Schema-valid output is effectively solved: constrained decoding masks invalid tokens during
generation and guarantees the shape, where prompt-based JSON lands somewhere in the 80–95%
range and fails silently at the edges. Use it.

But the literature also reports accuracy costs from format restriction — *Let Me Speak Freely?*
([arXiv 2408.02442](https://arxiv.org/abs/2408.02442)) finds reasoning degradation under
constrained formats, and JSONSchemaBench ([arXiv 2501.10868](https://arxiv.org/abs/2501.10868))
measures the efficiency/quality frontier across engines. So constrained decoding is not free
and it is not a correctness guarantee.

**This matters here because the property we actually need is one no schema can express.** A
JSON Schema can require that `citedSpan` is a string. It cannot require that the string appears
verbatim in the transcript. Only `spanIsGrounded` can check that, in code, after the fact.

The division stands:

- **Schema** guarantees we can parse the answer.
- **`spanIsGrounded`** guarantees the answer is about the student's actual words.
- **The student** decides whether the evidence is sufficient.

Keep the schema minimal — verdict, span, missing cues — so the model spends its budget on
finding the span rather than on filling fields.

### 3.3 Model selection stays a tier, not an ID

Unchanged, and worth restating because it is the rule most likely to be broken by someone
copying a model string from a blog post: pin *tiers*, resolve IDs at build time, record the
chosen ID and the date it was verified in `.env.example`. The small tier's selection criterion
is **verbatim reproduction**, not benchmark score. A model that paraphrases while quoting
fails grounding on every call and silently degrades the product to deterministic mode.

---

## 4. Retaining the information

Neither source document covers what happens to work that already exists. Every current user's
projects, rubrics, drafts, and session history live in one browser's `localStorage` under
`talkactive.workspace.v1`. A migration that loses them is a migration that punishes the people
who used the product earliest.

**Three obligations, in order of importance.**

**4.1 Nothing is lost at cutover.** On first load of the new build, if
`talkactive.workspace.v1` is present, offer an explicit import: *"You have N projects saved in
this browser. Bring them into your account?"* Import is a real endpoint that validates and
inserts, not a silent read. On success the local blob is kept, not deleted, until the user
confirms — a failed import that also destroyed the source would be unforgivable.

The guest path keeps working without an account. Local-only stays a supported mode, not a
legacy one.

**4.2 The user can get their data out.** UU PDP grants access and portability. One endpoint
returning the full workspace as JSON — projects, rubrics, criteria, attempts, verdicts,
questions, answers. This is also the honest answer to "what if I stop using this?", and it is
listed as an unresolved open question in the target architecture. It is not optional.

**4.3 Deletion is real deletion.** Hard delete via cascade, already the schema's design.
Deleting an account removes the rows; no soft-delete flag, no tombstone with the transcript
still in it. Raw audio never enters the schema at all, by construction — the Web Speech API
never hands the application a buffer, which makes the promise structural rather than a policy
someone has to remember.

---

## 5. What production adds that a prototype does not

The three gaps that separate this from a demo, none of which either source document addresses.

**5.1 You cannot fix what you cannot see.** The single most useful number for this product is
the **grounding rejection rate** — how often the model claims support and `spanIsGrounded`
throws the verdict away. It is the direct measure of whether the AI layer is working, it is
already computed on every request, and right now it is discarded. Log it per criterion with
the model ID. When it moves, the model changed or the prompt drifted, and you will know within
a day instead of after a user tells you.

Also worth emitting: latency per unit, fallback-to-deterministic rate, cost per attempt.
Vercel's built-in observability covers the transport; these are domain events and are ours.

**5.2 Rate limiting is a cost control, not a security feature.** Per-user and per-IP limits on
the AI endpoints. An attempt fans out to N model calls, so one script can spend real money
quickly. Upstash Redis is already in the proposal's stack for this.

**Implemented 12 August 2026.** Each paid route has its own Upstash token bucket. Evidence
review is weighted at five tokens because it fans out; rubric parsing, question generation,
defense judging, and a rejected-evidence re-judge cost one. Guests are limited by an
HMAC-pseudonymized Vercel IP; signed-in users must pass both that IP bucket and a separately
pseudonymized user bucket. Raw IPs and user IDs are never Redis keys. Missing credentials,
an unassignable request identity, Redis failure, or the SDK's timeout-bypass result all return
a typed `503` before model spend. An exhausted bucket returns `429` with `Retry-After`.
Accepted evidence confirmations make no model call and consume no token.

**5.3 The invariants have to survive the port.** This is the part most likely to be quietly
dropped, and it is the reason the product scored the way it did.

| | Survives how |
|---|---|
| INV-2 | The overclaim and account-vocabulary scans in `test/invariants.test.mjs` re-point at `app/**` and `components/**`. They are grep over source; the port is a path change. |
| INV-3 | Grounding stays in code, not in a prompt. |
| INV-5 | React escapes by default. Ban `dangerouslySetInnerHTML` with a lint rule, not a convention. |
| INV-7 | Typed errors across the FE/BE contract; Zod at the boundary. |
| INV-8 | `design-system.test.mjs` is what *proves* the visual port is faithful rather than eyeballed. It must pass against the new build before cutover. |

---

## 6. The stack, stated once

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16.3, App Router, Cache Components | `use cache` over route-segment config |
| Language | TypeScript, `strict` | no `any`; infer or define |
| Styling | existing CSS custom properties, imported unchanged | not Tailwind — documented deviation |
| Database | Postgres on Neon, Singapore (`ap-southeast-1`) | chosen in §8; still cross-border from Indonesia |
| ORM | Drizzle | schema in TS, migrations checked in |
| Auth | Better Auth | §2; guest path preserved |
| AI | AI SDK v7 via Vercel AI Gateway | `Output.object()`; `zeroDataRetention` routing |
| Files | Vercel Blob (private) | source documents only |
| Cache / limits | Upstash Redis | rate limiting, prompt cache keys |
| STT | Web Speech API | never hands us an audio buffer — see target arch §6 |
| Validation | Zod, shared FE/BE | one schema, both sides |
| Tests | Node test runner + Playwright | port `design-system` and `invariants` first |

---

## 7. What is deliberately not in this stack

Saying no is the more useful half of a stack document.

- **An agent framework.** This pipeline has fixed steps, a known order, and no tool selection.
  It is a workflow, not an agent, and the distinction is Anthropic's own. Adding an agent
  runtime would buy dynamism the product does not want and cost determinism it depends on.
- **A vector database.** The proposal mentions retrieval selecting candidate spans; at
  realistic transcript lengths (~900 words) the whole transcript fits in context, and chunking
  it would *break* verbatim span reproduction — the one property the design rests on. Revisit
  only if transcripts get long enough that context becomes the binding constraint. This
  deviation from `body.tex` is recorded, not silent.
- **An LLM verifier.** Argued at length in the AI layer spec §9.6 and unchanged. Deterministic
  grounding plus the student's own judgement is stronger and cheaper than a second model
  grading the first.
- **Client-side analytics.** Adds a third-party origin to a page whose privacy claim is that
  work stays on the device. Server-side domain events (§5.1) give better data with no such
  claim to walk back.

---

## 8. Closed prerequisite and remaining open questions

**P0-5 closed on 12 August 2026 — use Neon Singapore (`ap-southeast-1`).** Neon's official
regional status inventory and latency dashboard list Singapore and Sydney as its Asia-Pacific
database regions and do not list Jakarta. Singapore is the nearest supported choice and can
be paired with Vercel `sin1`. This choice does **not** create Indonesian data residency: it is
a cross-border transfer, so consent/disclosure and the applicable UU PDP transfer mechanism
remain required. Re-check availability before provisioning production; a future Jakarta
region would justify a migration, not a silent privacy-copy change.

Remaining open questions:

1. **Better Auth sign-in UI** needs designing to match the frozen visual system. Not hard, but
   it is real work Clerk would have absorbed, and it is not yet scoped.
2. **Grounding rejection rate has never been measured.** §5.1 makes it observable; someone
   still has to look at the first week of data and decide what "normal" is.
3. **Model IDs** in §3.1 are illustrative. Resolve against the live model list at build time.

---

## Sources

- [Next.js 16.3 release](https://nextjs.org/blog/next-16-3) · [Cache Components migration guide](https://nextjs.org/docs/app/guides/migrating-to-cache-components)
- [AI SDK — AI Gateway provider options](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) · [structured output](https://ai-sdk.dev/cookbook/node/generate-object)
- [Better Auth vs Clerk, data residency](https://makerkit.dev/blog/tutorials/better-auth-vs-clerk) · [auth library comparison 2026](https://blog.logrocket.com/best-auth-library-nextjs-2026/)
- [UU PDP cross-border transfer requirements](https://www.makarim.com/news/personal-data-protection-law-cross-border-transfer-requirements) · [Indonesia cross-border data transfer](https://rouse.com/insights/news/2023/cross-border-data-transfer-indonesia)
- [Let Me Speak Freely? — arXiv 2408.02442](https://arxiv.org/abs/2408.02442) · [JSONSchemaBench — arXiv 2501.10868](https://arxiv.org/abs/2501.10868)
- [Drizzle vs Prisma 2026](https://www.turbostarter.dev/blog/drizzle-vs-prisma-typescript-orm-2026)
- [Neon regional status inventory](https://neon.com/docs/introduction/status) · [Neon regional latency dashboard](https://neon.com/demos/regional-latency)
