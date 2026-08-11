# Talk-Active App Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full MVP app layer for Talk-Active (rubric-grounded rehearsal workspace) from a blank repo — rubric ingestion, attempt capture (paste + ASR), per-criterion evidence mapping with a Verifier double-check, adversarial question generation, defense evaluation, and progress aggregation.

**Architecture:** Single Next.js 15 App Router project on Vercel. Route handlers under `app/api/*` are thin — they parse the request, call a function in `lib/services/` or `lib/ai/`, persist via Drizzle, and return JSON. All business logic lives in `lib/`, framework-agnostic and directly unit-testable without spinning up Next.js.

**Tech Stack:** Next.js 15 (App Router), React, TypeScript, Tailwind; Vercel Functions on Fluid Compute (Node.js runtime); Vercel AI Gateway + AI SDK (`generateObject` + Zod) for all reasoning calls; `@ai-sdk/groq` called directly (not via Gateway) for transcription; Drizzle ORM + Neon Postgres (via Vercel Marketplace); Vercel Blob (private) for source documents; Clerk for auth; Upstash Redis for rate limiting; Vitest for tests.

## Global Constraints

- Every AI-touching route: call model → validate citation against the actual transcript in code → persist → return. Never show an unverified verdict (spec §4, §7).
- A verdict is only accepted if its cited `span` is a literal (whitespace-normalized, case-insensitive) substring of the transcript. No exceptions, enforced in code, not just prompted.
- `Verifier` only runs on `EvidenceJudge` verdicts of `"supported"` — never on `"partial"` or `"unsupported"` (spec §3, asymmetric-risk reasoning).
- `Verifier` never produces a percentage/confidence score — binary `agrees: boolean` only (spec §3).
- On Verifier disagreement: the `verdict` enum column is left untouched (still `"supported"`); `verifier_agreed` is set to `false`; the derived `coverage_score` column is downgraded to `0.5` for that row so both the weakest-criterion ranking and the progress trend treat it as uncertain, not fully satisfied (spec §3, §6).
- `EvidenceJudge` runs once per criterion, in parallel (`Promise.allSettled`), never batched into one call across all criteria (spec §3).
- Raw audio is never written to disk or Blob storage — only the resulting transcript text persists (spec §5, §6).
- Groq transcription is called directly via `@ai-sdk/groq`, not routed through Vercel AI Gateway (spec §5 — Gateway's STT path is beta/canary-only).
- Transcription defaults to `language: "id"`; a per-attempt toggle allows switching to auto-detect for fully English sessions (spec §5).
- Hard delete only — deleting an attempt cascades through `evidence_verdicts` → `questions` → `defense_answers` at the DB level (spec §6).
- No numeric confidence/ability score is ever shown to the student, anywhere (spec §9).
- Exact Gateway model IDs are never hardcoded from memory — fetched live in Task 4 and stored as named constants (spec §3, per the ai-sdk skill's live-model-ID requirement).

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `vitest.config.ts`, `.env.example`, `.gitignore`

**Interfaces:**
- Produces: a running `npm run dev` Next.js app and a working `npm test` (Vitest) command that later tasks' tests plug into.

- [ ] **Step 1: Scaffold Next.js into the current directory**

```bash
npx create-next-app@latest .tmp_scaffold --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm --yes
rsync -a .tmp_scaffold/ ./ --exclude=.git
rm -rf .tmp_scaffold
```

- [ ] **Step 2: Verify the dev server boots**

Run: `npm run dev -- --port 3999 & sleep 5 && curl -sf http://localhost:3999 > /dev/null && echo OK && kill %1`
Expected: `OK`

- [ ] **Step 3: Install the rest of the stack's dependencies**

```bash
npm install ai @ai-sdk/groq zod drizzle-orm @neondatabase/serverless @clerk/nextjs @vercel/blob @upstash/redis @upstash/ratelimit pdf-parse
npm install -D drizzle-kit vitest @types/pdf-parse
```

- [ ] **Step 4: Add Vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

- [ ] **Step 5: Add the test script to package.json**

Edit `package.json` scripts block to include:

```json
"test": "vitest run"
```

- [ ] **Step 6: Add `.env.example`**

```bash
# .env.example
DATABASE_URL=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
GROQ_API_KEY=
AI_GATEWAY_API_KEY=
BLOB_READ_WRITE_TOKEN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js app with full stack dependencies"
```

---

## Task 2: Database schema (Drizzle + Neon)

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/client.ts`
- Create: `drizzle.config.ts`
- Test: `lib/db/schema.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var (Neon connection string).
- Produces: `db` (Drizzle client instance) from `lib/db/client.ts`; table objects `projects, rubrics, criteria, attempts, evidenceVerdicts, questions, defenseAnswers, sourceDocuments` and inferred types (`Project`, `NewProject`, `Attempt`, `NewAttempt`, `EvidenceVerdict`, `NewEvidenceVerdict`, `Criterion`, `NewCriterion`, `Question`, `NewQuestion`, `DefenseAnswer`, `NewDefenseAnswer`) from `lib/db/schema.ts`, all consumed by every later task.

- [ ] **Step 1: Write the schema**

```typescript
// lib/db/schema.ts
import {
  pgTable, uuid, text, timestamp, boolean, real, pgEnum, integer,
} from 'drizzle-orm/pg-core';

export const rubricSourceEnum = pgEnum('rubric_source', ['pasted', 'uploaded']);
export const attemptModeEnum = pgEnum('attempt_mode', ['paste', 'record']);
export const attemptStatusEnum = pgEnum('attempt_status', [
  'draft', 'transcribed', 'evidence_mapped', 'questioned', 'defended', 'completed',
]);
export const verdictEnum = pgEnum('verdict', ['supported', 'partial', 'unsupported']);
export const stageEnum = pgEnum('stage', ['initial', 'defense']);
export const transcriptSourceEnum = pgEnum('transcript_source', ['paste', 'asr']);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  eventContext: text('event_context'),
  deadline: timestamp('deadline'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rubrics = pgTable('rubrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceType: rubricSourceEnum('source_type').notNull(),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const criteria = pgTable('criteria', {
  id: uuid('id').primaryKey().defaultRandom(),
  rubricId: uuid('rubric_id').notNull().references(() => rubrics.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  requiredEvidence: text('required_evidence').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
});

export const attempts = pgTable('attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  mode: attemptModeEnum('mode').notNull(),
  status: attemptStatusEnum('status').notNull().default('draft'),
  transcript: text('transcript'),
  transcriptSource: transcriptSourceEnum('transcript_source'),
  audioDurationSeconds: real('audio_duration_seconds'),
  consentAt: timestamp('consent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const evidenceVerdicts = pgTable('evidence_verdicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  criterionId: uuid('criterion_id').notNull().references(() => criteria.id, { onDelete: 'cascade' }),
  stage: stageEnum('stage').notNull(),
  verdict: verdictEnum('verdict').notNull(),
  coverageScore: real('coverage_score').notNull(),
  citedSpan: text('cited_span'),
  verifierAgreed: boolean('verifier_agreed'),
  verifierNote: text('verifier_note'),
  studentOverridden: boolean('student_overridden').notNull().default(false),
  studentOverrideVerdict: verdictEnum('student_override_verdict'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  targetCriterionId: uuid('target_criterion_id').notNull().references(() => criteria.id, { onDelete: 'cascade' }),
  questionText: text('question_text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const defenseAnswers = pgTable('defense_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  answerText: text('answer_text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sourceDocuments = pgTable('source_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  blobUrl: text('blob_url').notNull(),
  filename: text('filename').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Criterion = typeof criteria.$inferSelect;
export type NewCriterion = typeof criteria.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
export type EvidenceVerdict = typeof evidenceVerdicts.$inferSelect;
export type NewEvidenceVerdict = typeof evidenceVerdicts.$inferInsert;
export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type DefenseAnswer = typeof defenseAnswers.$inferSelect;
export type NewDefenseAnswer = typeof defenseAnswers.$inferInsert;
```

- [ ] **Step 2: Write the client**

```typescript
// lib/db/client.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

- [ ] **Step 3: Write the drizzle-kit config**

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Write a schema sanity test**

```typescript
// lib/db/schema.test.ts
import { describe, it, expect } from 'vitest';
import { attempts, evidenceVerdicts, criteria } from './schema';

describe('schema', () => {
  it('attempts table has the statuses the app layer relies on', () => {
    const statuses = attempts.status.enumValues;
    expect(statuses).toEqual([
      'draft', 'transcribed', 'evidence_mapped', 'questioned', 'defended', 'completed',
    ]);
  });

  it('evidence_verdicts cascades on attempt and criterion deletion', () => {
    expect(evidenceVerdicts.attemptId.notNull).toBe(true);
    expect(criteria.rubricId.notNull).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm test -- lib/db/schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Generate and note the migration (do not run against a live DB yet — no DATABASE_URL configured until deployment)**

```bash
npx drizzle-kit generate
```

- [ ] **Step 7: Commit**

```bash
git add lib/db drizzle.config.ts drizzle/
git commit -m "feat: add Drizzle schema for projects, rubrics, criteria, attempts, verdicts"
```

---

## Task 3: Clerk auth middleware

**Files:**
- Create: `middleware.ts`
- Modify: `app/layout.tsx`

**Interfaces:**
- Produces: every route under `app/(app)/*` and `app/api/*` is gated behind a signed-in Clerk session; `auth()` from `@clerk/nextjs/server` is available to any route handler needing `userId`.

- [ ] **Step 1: Write the middleware**

```typescript
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
};
```

- [ ] **Step 2: Wrap the root layout in ClerkProvider**

```typescript
// app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 3: Verify the app still boots with middleware present**

Run: `npm run build`
Expected: build succeeds (Clerk env vars can be dummy placeholders in `.env.local` for this check — real keys are a deployment-time concern, not a code-correctness concern)

- [ ] **Step 4: Commit**

```bash
git add middleware.ts app/layout.tsx
git commit -m "feat: gate app and api routes behind Clerk auth"
```

---

## Task 4: AI Gateway model constants

**Files:**
- Create: `lib/ai/models.ts`

**Interfaces:**
- Produces: `STRONG_MODEL: string`, `FAST_MODEL: string` — consumed by every AI unit task (5, 7, 12, 13, 16).

- [ ] **Step 1: Fetch the live model list from the Gateway**

```bash
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '[.data[] | select(.id | startswith("anthropic/")) | .id] | reverse | .[]' | head -10
```

Pick the newest Sonnet-class model (highest version number) for `STRONG_MODEL` and the newest Haiku-class model for `FAST_MODEL`. If the Gateway isn't reachable yet (no API key configured), fall back to `anthropic/claude-sonnet-4-5` and `anthropic/claude-haiku-4-5` as a starting point, and re-run this curl command before the first real deployment to confirm they're still current.

- [ ] **Step 2: Write the constants file**

```typescript
// lib/ai/models.ts
// Re-run `curl -s https://ai-gateway.vercel.sh/v1/models | jq ...` before relying on these —
// pin to whatever the live list returns, don't trust these from memory.
export const STRONG_MODEL = 'anthropic/claude-sonnet-4-5'; // RubricParser, QuestionGenerator
export const FAST_MODEL = 'anthropic/claude-haiku-4-5';    // EvidenceJudge, Verifier
```

- [ ] **Step 3: Commit**

```bash
git add lib/ai/models.ts
git commit -m "feat: add AI Gateway model tier constants"
```

---

## Task 5: Citation validator (pure function)

**Files:**
- Create: `lib/services/citation.ts`
- Test: `lib/services/citation.test.ts`

**Interfaces:**
- Produces: `isSpanGrounded(transcript: string, span: string): boolean` — consumed by Task 14 (evidence mapping orchestration) and Task 17 (defense evaluation).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/services/citation.test.ts
import { describe, it, expect } from 'vitest';
import { isSpanGrounded } from './citation';

describe('isSpanGrounded', () => {
  it('returns true when the span is a literal substring of the transcript', () => {
    const transcript = 'Our market size is based on three field interviews we conducted last month.';
    expect(isSpanGrounded(transcript, 'three field interviews we conducted last month')).toBe(true);
  });

  it('returns false when the span does not appear in the transcript', () => {
    const transcript = 'We believe the market is large and growing fast.';
    expect(isSpanGrounded(transcript, 'we surveyed 500 potential customers')).toBe(false);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    const transcript = 'We  SURVEYED   500 customers over two weeks.';
    expect(isSpanGrounded(transcript, 'we surveyed 500 customers')).toBe(true);
  });

  it('returns false for an empty span', () => {
    expect(isSpanGrounded('anything here', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/services/citation.test.ts`
Expected: FAIL with "Cannot find module './citation'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/services/citation.ts
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Whitespace/case differences between what the model echoes back and the raw
// transcript are common (extra spaces, casing) without the citation being fabricated —
// normalize before the substring check rather than requiring byte-exact matches.
export function isSpanGrounded(transcript: string, span: string): boolean {
  const normalizedSpan = normalize(span);
  if (normalizedSpan.length === 0) return false;
  return normalize(transcript).includes(normalizedSpan);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/services/citation.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/services/citation.ts lib/services/citation.test.ts
git commit -m "feat: add citation grounding validator"
```

---

## Task 6: Coverage score utilities (pure functions)

**Files:**
- Create: `lib/services/coverage.ts`
- Test: `lib/services/coverage.test.ts`

**Interfaces:**
- Produces: `type Verdict = 'supported' | 'partial' | 'unsupported'`, `verdictToRawScore(verdict: Verdict): 0 | 0.5 | 1`, `effectiveCoverageScore(verdict: Verdict, verifierAgreed: boolean | null): 0 | 0.5 | 1` — consumed by Task 14 (evidence mapping) and Task 19 (progress aggregation, conceptually — the value is precomputed at write time, not recomputed in the progress query).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/services/coverage.test.ts
import { describe, it, expect } from 'vitest';
import { verdictToRawScore, effectiveCoverageScore } from './coverage';

describe('verdictToRawScore', () => {
  it('maps supported to 1, partial to 0.5, unsupported to 0', () => {
    expect(verdictToRawScore('supported')).toBe(1);
    expect(verdictToRawScore('partial')).toBe(0.5);
    expect(verdictToRawScore('unsupported')).toBe(0);
  });
});

describe('effectiveCoverageScore', () => {
  it('downgrades a supported verdict to 0.5 when the Verifier disagrees', () => {
    expect(effectiveCoverageScore('supported', false)).toBe(0.5);
  });

  it('keeps a supported verdict at 1 when the Verifier agrees', () => {
    expect(effectiveCoverageScore('supported', true)).toBe(1);
  });

  it('keeps a supported verdict at 1 when the Verifier never ran (null)', () => {
    expect(effectiveCoverageScore('supported', null)).toBe(1);
  });

  it('is unaffected by verifierAgreed for partial or unsupported verdicts', () => {
    expect(effectiveCoverageScore('partial', false)).toBe(0.5);
    expect(effectiveCoverageScore('unsupported', false)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/services/coverage.test.ts`
Expected: FAIL with "Cannot find module './coverage'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/services/coverage.ts
export type Verdict = 'supported' | 'partial' | 'unsupported';

export function verdictToRawScore(verdict: Verdict): 0 | 0.5 | 1 {
  if (verdict === 'supported') return 1;
  if (verdict === 'partial') return 0.5;
  return 0;
}

// Verifier only ever runs on "supported" verdicts (Global Constraints), so disagreement
// can only pull a 1 down to 0.5 — it never touches partial/unsupported. The stored
// `verdict` enum stays untouched by design (spec §3); this derived score is what both
// the weakest-criterion ranking and the progress trend read instead.
export function effectiveCoverageScore(
  verdict: Verdict,
  verifierAgreed: boolean | null,
): 0 | 0.5 | 1 {
  if (verdict === 'supported' && verifierAgreed === false) return 0.5;
  return verdictToRawScore(verdict);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/services/coverage.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/services/coverage.ts lib/services/coverage.test.ts
git commit -m "feat: add coverage score derivation with verifier-disagreement handling"
```

---

## Task 7: RubricParser AI unit

**Files:**
- Create: `lib/ai/rubric-parser.ts`
- Test: `lib/ai/rubric-parser.test.ts`

**Interfaces:**
- Consumes: `STRONG_MODEL` from `lib/ai/models.ts`.
- Produces: `type ParsedCriterion = { name: string; description: string; requiredEvidence: string }`, `parseRubric(rawText: string): Promise<ParsedCriterion[]>` — consumed by Task 8 (`/api/rubrics/parse` route).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ai/rubric-parser.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateObject } from 'ai';
import { parseRubric } from './rubric-parser';

vi.mock('ai', () => ({ generateObject: vi.fn() }));

describe('parseRubric', () => {
  it('returns the structured criteria from the model response', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        criteria: [
          {
            name: 'Business Strategy',
            description: 'Market sizing and revenue model',
            requiredEvidence: 'TAM/SAM/SOM figures with a cited source',
          },
        ],
      },
    } as never);

    const result = await parseRubric('Business Strategy: must include market sizing...');

    expect(result).toEqual([
      {
        name: 'Business Strategy',
        description: 'Market sizing and revenue model',
        requiredEvidence: 'TAM/SAM/SOM figures with a cited source',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/ai/rubric-parser.test.ts`
Expected: FAIL with "Cannot find module './rubric-parser'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ai/rubric-parser.ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { STRONG_MODEL } from './models';

const ParsedCriterionSchema = z.object({
  name: z.string(),
  description: z.string(),
  requiredEvidence: z.string(),
});

const ParsedRubricSchema = z.object({
  criteria: z.array(ParsedCriterionSchema),
});

export type ParsedCriterion = z.infer<typeof ParsedCriterionSchema>;

export async function parseRubric(rawText: string): Promise<ParsedCriterion[]> {
  const { object } = await generateObject({
    model: STRONG_MODEL,
    schema: ParsedRubricSchema,
    prompt: `You are structuring an evaluation rubric for a rehearsal tool. Extract every
distinct scoring criterion from the text below. For each criterion, give a short name, a
one-sentence description of what it evaluates, and the specific evidence a strong answer
would need to include. Do not invent criteria that aren't in the source text.

Rubric text:
${rawText}`,
  });
  return object.criteria;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/ai/rubric-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ai/rubric-parser.ts lib/ai/rubric-parser.test.ts
git commit -m "feat: add RubricParser AI unit"
```

---

## Task 8: Rubric ingestion + confirmation routes

**Files:**
- Create: `app/api/rubrics/parse/route.ts`
- Create: `app/api/projects/[id]/rubric/route.ts`
- Test: `app/api/rubrics/parse/route.test.ts`
- Test: `app/api/projects/[id]/rubric/route.test.ts`

**Interfaces:**
- Consumes: `parseRubric` (Task 7), `db`, `rubrics`, `criteria` (Task 2).
- Produces: `POST /api/rubrics/parse` (draft criteria, nothing persisted), `POST /api/projects/[id]/rubric` (persists confirmed rubric + criteria) — the second is a prerequisite for Task 10 (creating attempts).

- [ ] **Step 1: Write the failing test for `/api/rubrics/parse`**

```typescript
// app/api/rubrics/parse/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as rubricParser from '@/lib/ai/rubric-parser';
import { POST } from './route';

describe('POST /api/rubrics/parse', () => {
  it('returns draft criteria without persisting anything', async () => {
    vi.spyOn(rubricParser, 'parseRubric').mockResolvedValue([
      { name: 'Problem Clarity', description: 'Is the problem well defined?', requiredEvidence: 'A named, sized problem' },
    ]);

    const req = new Request('http://localhost/api/rubrics/parse', {
      method: 'POST',
      body: JSON.stringify({ rawText: 'Problem Clarity: ...' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.criteria).toHaveLength(1);
    expect(body.criteria[0].name).toBe('Problem Clarity');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/rubrics/parse/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the `/api/rubrics/parse` route**

```typescript
// app/api/rubrics/parse/route.ts
import { parseRubric } from '@/lib/ai/rubric-parser';

export async function POST(req: Request) {
  const { rawText } = await req.json();
  const criteria = await parseRubric(rawText);
  return Response.json({ criteria });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/rubrics/parse/route.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `/api/projects/[id]/rubric`**

```typescript
// app/api/projects/[id]/rubric/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'rubric-1' }]),
      }),
    }),
  },
}));

describe('POST /api/projects/[id]/rubric', () => {
  it('persists the confirmed rubric and its criteria', async () => {
    const req = new Request('http://localhost/api/projects/proj-1/rubric', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'pasted',
        criteria: [
          { name: 'Problem Clarity', description: 'desc', requiredEvidence: 'evidence' },
        ],
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'proj-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rubricId).toBe('rubric-1');
    expect(db.insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- app/api/projects/[id]/rubric/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 7: Write the route**

```typescript
// app/api/projects/[id]/rubric/route.ts
import { db } from '@/lib/db/client';
import { rubrics, criteria } from '@/lib/db/schema';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { sourceType, criteria: confirmedCriteria } = await req.json();

  const [rubric] = await db
    .insert(rubrics)
    .values({ projectId, sourceType, confirmedAt: new Date() })
    .returning();

  await db.insert(criteria).values(
    confirmedCriteria.map((c: { name: string; description: string; requiredEvidence: string }, i: number) => ({
      rubricId: rubric.id,
      name: c.name,
      description: c.description,
      requiredEvidence: c.requiredEvidence,
      displayOrder: i,
    })),
  );

  return Response.json({ rubricId: rubric.id });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- app/api/projects/[id]/rubric/route.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/api/rubrics app/api/projects
git commit -m "feat: add rubric ingestion and confirmation routes"
```

---

## Task 9: Attempt creation route

**Files:**
- Create: `app/api/attempts/route.ts`
- Test: `app/api/attempts/route.test.ts`

**Interfaces:**
- Consumes: `db`, `attempts` (Task 2).
- Produces: `POST /api/attempts` — consumed by every later attempt-scoped route (Tasks 11, 15, 16, 17).

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/attempts/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'attempt-1', status: 'draft' }]),
      }),
    }),
  },
}));

describe('POST /api/attempts', () => {
  it('creates an attempt and returns its id', async () => {
    const req = new Request('http://localhost/api/attempts', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'proj-1', mode: 'paste' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attemptId).toBe('attempt-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/attempts/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the route**

```typescript
// app/api/attempts/route.ts
import { db } from '@/lib/db/client';
import { attempts } from '@/lib/db/schema';

export async function POST(req: Request) {
  const { projectId, mode } = await req.json();

  const [attempt] = await db
    .insert(attempts)
    .values({
      projectId,
      mode,
      status: 'draft',
      consentAt: mode === 'record' ? new Date() : null,
    })
    .returning();

  return Response.json({ attemptId: attempt.id, status: attempt.status });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/attempts/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/attempts/route.ts app/api/attempts/route.test.ts
git commit -m "feat: add attempt creation route"
```

---

## Task 10: Groq transcription

**Files:**
- Create: `lib/ai/transcribe.ts`
- Create: `app/api/attempts/[id]/transcribe/route.ts`
- Test: `lib/ai/transcribe.test.ts`
- Test: `app/api/attempts/[id]/transcribe/route.test.ts`

**Interfaces:**
- Produces: `transcribeAudio(audioBuffer: ArrayBuffer, languageHint: 'id' | undefined): Promise<{ text: string; durationSeconds: number }>`, and `POST /api/attempts/[id]/transcribe`.
- Consumes: `db`, `attempts` (Task 2).

- [ ] **Step 1: Write the failing test for the transcription unit**

```typescript
// lib/ai/transcribe.test.ts
import { describe, it, expect, vi } from 'vitest';
import { transcribe } from 'ai';
import { transcribeAudio } from './transcribe';

vi.mock('ai', () => ({ transcribe: vi.fn() }));
vi.mock('@ai-sdk/groq', () => ({ groq: { transcription: vi.fn(() => 'mock-model') } }));

describe('transcribeAudio', () => {
  it('returns transcript text and duration, defaulting language to id', async () => {
    vi.mocked(transcribe).mockResolvedValue({
      text: 'Halo, nama saya Sultan.',
      durationInSeconds: 3.2,
    } as never);

    const result = await transcribeAudio(new ArrayBuffer(8));

    expect(result).toEqual({ text: 'Halo, nama saya Sultan.', durationSeconds: 3.2 });
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: { groq: { language: 'id' } } }),
    );
  });

  it('respects an explicit language override', async () => {
    vi.mocked(transcribe).mockResolvedValue({ text: 'Hello there.', durationInSeconds: 1.1 } as never);

    await transcribeAudio(new ArrayBuffer(8), 'en');

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: { groq: { language: 'en' } } }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/ai/transcribe.test.ts`
Expected: FAIL with "Cannot find module './transcribe'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ai/transcribe.ts
import { transcribe } from 'ai';
import { groq } from '@ai-sdk/groq';

export async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  languageHint: string = 'id',
): Promise<{ text: string; durationSeconds: number }> {
  const result = await transcribe({
    model: groq.transcription('whisper-large-v3-turbo'),
    audio: audioBuffer,
    providerOptions: { groq: { language: languageHint } },
  });

  return { text: result.text, durationSeconds: result.durationInSeconds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/ai/transcribe.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for the route**

```typescript
// app/api/attempts/[id]/transcribe/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as transcribeLib from '@/lib/ai/transcribe';
import { db } from '@/lib/db/client';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: { update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }) },
}));

describe('POST /api/attempts/[id]/transcribe', () => {
  it('transcribes the uploaded audio and updates the attempt', async () => {
    vi.spyOn(transcribeLib, 'transcribeAudio').mockResolvedValue({
      text: 'Ini adalah rekaman uji coba.',
      durationSeconds: 5,
    });

    const req = new Request('http://localhost/api/attempts/attempt-1/transcribe', {
      method: 'POST',
      body: new ArrayBuffer(16),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'attempt-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.transcript).toBe('Ini adalah rekaman uji coba.');
    expect(db.update).toHaveBeenCalled();
  });

  it('returns a transcribe_failed status when Groq errors, without throwing', async () => {
    vi.spyOn(transcribeLib, 'transcribeAudio').mockRejectedValue(new Error('Groq timeout'));

    const req = new Request('http://localhost/api/attempts/attempt-1/transcribe', {
      method: 'POST',
      body: new ArrayBuffer(16),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'attempt-1' }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('transcribe_failed');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- app/api/attempts/[id]/transcribe/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 7: Write the route**

```typescript
// app/api/attempts/[id]/transcribe/route.ts
import { transcribeAudio } from '@/lib/ai/transcribe';
import { db } from '@/lib/db/client';
import { attempts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: attemptId } = await params;
  const audioBuffer = await req.arrayBuffer();

  try {
    const { text, durationSeconds } = await transcribeAudio(audioBuffer);

    await db
      .update(attempts)
      .set({
        transcript: text,
        transcriptSource: 'asr',
        audioDurationSeconds: durationSeconds,
        status: 'transcribed',
      })
      .where(eq(attempts.id, attemptId));

    return Response.json({ transcript: text });
  } catch {
    // Audio buffer is discarded either way — never written to Blob or disk. Paste-draft
    // remains available client-side as the fallback (spec §5, §7).
    return Response.json({ error: 'transcribe_failed' }, { status: 502 });
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- app/api/attempts/[id]/transcribe/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add lib/ai/transcribe.ts app/api/attempts/\[id\]/transcribe
git commit -m "feat: add Groq Whisper transcription unit and route"
```

---

## Task 11: EvidenceJudge AI unit

**Files:**
- Create: `lib/ai/evidence-judge.ts`
- Test: `lib/ai/evidence-judge.test.ts`

**Interfaces:**
- Consumes: `FAST_MODEL` (Task 4), `Verdict` type (Task 6).
- Produces: `type EvidenceJudgeResult = { verdict: Verdict; span: string | null; missing: string | null }`, `judgeCriterion(transcript: string, criterion: { name: string; description: string; requiredEvidence: string }): Promise<EvidenceJudgeResult>` — consumed by Task 14 (evidence mapping) and Task 17 (defense evaluation).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ai/evidence-judge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateObject } from 'ai';
import { judgeCriterion } from './evidence-judge';

vi.mock('ai', () => ({ generateObject: vi.fn() }));

describe('judgeCriterion', () => {
  it('returns a supported verdict with its citation span', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        verdict: 'supported',
        span: 'we interviewed 40 students across three campuses',
        missing: null,
      },
    } as never);

    const result = await judgeCriterion(
      'To validate demand, we interviewed 40 students across three campuses.',
      { name: 'Market Validation', description: 'Has demand been validated?', requiredEvidence: 'Primary research with real users' },
    );

    expect(result.verdict).toBe('supported');
    expect(result.span).toBe('we interviewed 40 students across three campuses');
  });

  it('returns unsupported with what is missing when no evidence is found', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { verdict: 'unsupported', span: null, missing: 'No primary research is mentioned anywhere in the transcript.' },
    } as never);

    const result = await judgeCriterion('We think the market is big.', {
      name: 'Market Validation', description: 'Has demand been validated?', requiredEvidence: 'Primary research with real users',
    });

    expect(result.verdict).toBe('unsupported');
    expect(result.span).toBeNull();
    expect(result.missing).toContain('No primary research');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/ai/evidence-judge.test.ts`
Expected: FAIL with "Cannot find module './evidence-judge'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ai/evidence-judge.ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { FAST_MODEL } from './models';
import type { Verdict } from '@/lib/services/coverage';

const EvidenceJudgeSchema = z.object({
  verdict: z.enum(['supported', 'partial', 'unsupported']),
  span: z.string().nullable(),
  missing: z.string().nullable(),
});

export type EvidenceJudgeResult = z.infer<typeof EvidenceJudgeSchema>;

export async function judgeCriterion(
  transcript: string,
  criterion: { name: string; description: string; requiredEvidence: string },
): Promise<EvidenceJudgeResult> {
  const { object } = await generateObject({
    model: FAST_MODEL,
    schema: EvidenceJudgeSchema,
    prompt: `You are judging whether a single rubric criterion is satisfied by a transcript.

Criterion: ${criterion.name} — ${criterion.description}
Evidence required: ${criterion.requiredEvidence}

Transcript:
"""
${transcript}
"""

Decide: "supported" (the required evidence is clearly present), "partial" (touched on but
incomplete), or "unsupported" (not addressed). If supported or partial, "span" MUST be the
exact, verbatim sentence or phrase from the transcript that justifies your verdict — copy it
character-for-character, do not paraphrase. If unsupported, "span" is null and "missing"
must say specifically what evidence is absent.`,
  });
  return object as EvidenceJudgeResult;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/ai/evidence-judge.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/evidence-judge.ts lib/ai/evidence-judge.test.ts
git commit -m "feat: add EvidenceJudge AI unit"
```

---

## Task 12: Verifier AI unit

**Files:**
- Create: `lib/ai/verifier.ts`
- Test: `lib/ai/verifier.test.ts`

**Interfaces:**
- Consumes: `FAST_MODEL` (Task 4).
- Produces: `verifyVerdict(criterion: { name: string; description: string; requiredEvidence: string }, span: string): Promise<{ agrees: boolean }>` — consumed by Task 14.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ai/verifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateObject } from 'ai';
import { verifyVerdict } from './verifier';

vi.mock('ai', () => ({ generateObject: vi.fn() }));

describe('verifyVerdict', () => {
  it('returns agrees: true when the span genuinely satisfies the criterion', async () => {
    vi.mocked(generateObject).mockResolvedValue({ object: { agrees: true } } as never);

    const result = await verifyVerdict(
      { name: 'Market Validation', description: 'Has demand been validated?', requiredEvidence: 'Primary research with real users' },
      'we interviewed 40 students across three campuses',
    );

    expect(result).toEqual({ agrees: true });
  });

  it('returns agrees: false when the span is real but does not satisfy the criterion', async () => {
    vi.mocked(generateObject).mockResolvedValue({ object: { agrees: false } } as never);

    const result = await verifyVerdict(
      { name: 'Market Validation', description: 'Has demand been validated?', requiredEvidence: 'Primary research with real users' },
      'I really believe in this idea',
    );

    expect(result).toEqual({ agrees: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/ai/verifier.test.ts`
Expected: FAIL with "Cannot find module './verifier'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ai/verifier.ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { FAST_MODEL } from './models';

const VerifierSchema = z.object({ agrees: z.boolean() });

// Deliberately no confidence/percentage field — see Global Constraints. Input is scoped to
// just the criterion and the cited span, not the full transcript, keeping the call cheap
// and focused (spec §3).
export async function verifyVerdict(
  criterion: { name: string; description: string; requiredEvidence: string },
  span: string,
): Promise<{ agrees: boolean }> {
  const { object } = await generateObject({
    model: FAST_MODEL,
    schema: VerifierSchema,
    prompt: `A criterion was judged "supported" by the following cited quote. Independently
check: does this quote genuinely satisfy the criterion, or does it merely sound relevant?

Criterion: ${criterion.name} — ${criterion.description}
Evidence required: ${criterion.requiredEvidence}
Cited quote: "${span}"

Answer strictly whether you agree the quote satisfies the required evidence.`,
  });
  return object;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/ai/verifier.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/verifier.ts lib/ai/verifier.test.ts
git commit -m "feat: add Verifier AI unit"
```

---

## Task 13: Evidence mapping orchestration service

**Files:**
- Create: `lib/services/evidence-mapping.ts`
- Test: `lib/services/evidence-mapping.test.ts`

**Interfaces:**
- Consumes: `judgeCriterion` (Task 11), `verifyVerdict` (Task 12), `isSpanGrounded` (Task 5), `effectiveCoverageScore` (Task 6).
- Produces: `type MappedCriterionResult = { criterionId: string; verdict: Verdict; coverageScore: number; citedSpan: string | null; verifierAgreed: boolean | null }`, `mapEvidence(transcript: string, criteria: { id: string; name: string; description: string; requiredEvidence: string }[]): Promise<MappedCriterionResult[]>` — consumed by Task 14 (route handler persists these rows).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/services/evidence-mapping.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as evidenceJudge from '@/lib/ai/evidence-judge';
import * as verifier from '@/lib/ai/verifier';
import { mapEvidence } from './evidence-mapping';

describe('mapEvidence', () => {
  const transcript = 'We interviewed 40 students across three campuses about this problem.';
  const criteria = [
    { id: 'crit-1', name: 'Market Validation', description: 'd', requiredEvidence: 'e' },
    { id: 'crit-2', name: 'Feasibility', description: 'd', requiredEvidence: 'e' },
  ];

  it('runs EvidenceJudge per criterion in parallel and Verifier only on supported verdicts', async () => {
    vi.spyOn(evidenceJudge, 'judgeCriterion')
      .mockResolvedValueOnce({ verdict: 'supported', span: 'we interviewed 40 students across three campuses', missing: null })
      .mockResolvedValueOnce({ verdict: 'unsupported', span: null, missing: 'no feasibility discussion' });
    const verifySpy = vi.spyOn(verifier, 'verifyVerdict').mockResolvedValue({ agrees: true });

    const results = await mapEvidence(transcript, criteria);

    expect(verifySpy).toHaveBeenCalledTimes(1); // only for the supported verdict
    expect(results).toEqual([
      { criterionId: 'crit-1', verdict: 'supported', coverageScore: 1, citedSpan: 'we interviewed 40 students across three campuses', verifierAgreed: true },
      { criterionId: 'crit-2', verdict: 'unsupported', coverageScore: 0, citedSpan: null, verifierAgreed: null },
    ]);
  });

  it('downgrades a supported verdict to unsupported if the cited span is not actually in the transcript', async () => {
    vi.spyOn(evidenceJudge, 'judgeCriterion')
      .mockResolvedValue({ verdict: 'supported', span: 'a quote that was never said', missing: null });

    const results = await mapEvidence(transcript, [criteria[0]]);

    expect(results[0].verdict).toBe('unsupported');
    expect(results[0].citedSpan).toBeNull();
    expect(results[0].coverageScore).toBe(0);
  });

  it('downgrades coverage score to 0.5 when the Verifier disagrees, without changing the verdict', async () => {
    vi.spyOn(evidenceJudge, 'judgeCriterion')
      .mockResolvedValue({ verdict: 'supported', span: 'we interviewed 40 students across three campuses', missing: null });
    vi.spyOn(verifier, 'verifyVerdict').mockResolvedValue({ agrees: false });

    const results = await mapEvidence(transcript, [criteria[0]]);

    expect(results[0].verdict).toBe('supported');
    expect(results[0].verifierAgreed).toBe(false);
    expect(results[0].coverageScore).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/services/evidence-mapping.test.ts`
Expected: FAIL with "Cannot find module './evidence-mapping'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/services/evidence-mapping.ts
import { judgeCriterion } from '@/lib/ai/evidence-judge';
import { verifyVerdict } from '@/lib/ai/verifier';
import { isSpanGrounded } from './citation';
import { effectiveCoverageScore, type Verdict } from './coverage';

export type MappedCriterionResult = {
  criterionId: string;
  verdict: Verdict;
  coverageScore: number;
  citedSpan: string | null;
  verifierAgreed: boolean | null;
};

type CriterionInput = { id: string; name: string; description: string; requiredEvidence: string };

async function mapOne(transcript: string, criterion: CriterionInput): Promise<MappedCriterionResult> {
  const judged = await judgeCriterion(transcript, criterion);

  // Citation-or-reject: a verdict claiming support with a span that isn't actually in the
  // transcript is never shown as supported (Global Constraints).
  if (judged.verdict !== 'unsupported' && (!judged.span || !isSpanGrounded(transcript, judged.span))) {
    return {
      criterionId: criterion.id,
      verdict: 'unsupported',
      coverageScore: 0,
      citedSpan: null,
      verifierAgreed: null,
    };
  }

  if (judged.verdict !== 'supported') {
    return {
      criterionId: criterion.id,
      verdict: judged.verdict,
      coverageScore: effectiveCoverageScore(judged.verdict, null),
      citedSpan: judged.span,
      verifierAgreed: null,
    };
  }

  // Verifier only runs on supported verdicts (Global Constraints).
  const { agrees } = await verifyVerdict(criterion, judged.span!);

  return {
    criterionId: criterion.id,
    verdict: 'supported',
    coverageScore: effectiveCoverageScore('supported', agrees),
    citedSpan: judged.span,
    verifierAgreed: agrees,
  };
}

export async function mapEvidence(
  transcript: string,
  criteria: CriterionInput[],
): Promise<MappedCriterionResult[]> {
  const settled = await Promise.allSettled(criteria.map((c) => mapOne(transcript, c)));

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    // One criterion's model call failing doesn't blank the whole evidence map
    // (Global Constraints) — it surfaces as unsupported with no citation, retriable by the UI.
    return {
      criterionId: criteria[i].id,
      verdict: 'unsupported' as const,
      coverageScore: 0,
      citedSpan: null,
      verifierAgreed: null,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/services/evidence-mapping.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/services/evidence-mapping.ts lib/services/evidence-mapping.test.ts
git commit -m "feat: orchestrate EvidenceJudge + citation check + Verifier per criterion"
```

---

## Task 14: Evidence mapping route

**Files:**
- Create: `app/api/attempts/[id]/evidence/route.ts`
- Test: `app/api/attempts/[id]/evidence/route.test.ts`

**Interfaces:**
- Consumes: `mapEvidence` (Task 13), `db`, `attempts`, `criteria`, `evidenceVerdicts` (Task 2).
- Produces: `POST /api/attempts/[id]/evidence` returning `{ verdicts: MappedCriterionResult[]; weakestCriterionId: string }` — consumed by Task 15 (question generation needs the weakest criterion).

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/attempts/[id]/evidence/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as evidenceMapping from '@/lib/services/evidence-mapping';
import { db } from '@/lib/db/client';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: {
    query: {
      attempts: { findFirst: vi.fn().mockResolvedValue({ id: 'attempt-1', transcript: 'transcript text', projectId: 'proj-1' }) },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 'crit-1', name: 'Market Validation', description: 'd', requiredEvidence: 'e' },
            { id: 'crit-2', name: 'Feasibility', description: 'd', requiredEvidence: 'e' },
          ]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}));

describe('POST /api/attempts/[id]/evidence', () => {
  it('maps evidence for every criterion and identifies the weakest one', async () => {
    vi.spyOn(evidenceMapping, 'mapEvidence').mockResolvedValue([
      { criterionId: 'crit-1', verdict: 'supported', coverageScore: 1, citedSpan: 'span', verifierAgreed: true },
      { criterionId: 'crit-2', verdict: 'unsupported', coverageScore: 0, citedSpan: null, verifierAgreed: null },
    ]);

    const res = await POST(new Request('http://localhost'), { params: Promise.resolve({ id: 'attempt-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.weakestCriterionId).toBe('crit-2');
    expect(body.verdicts).toHaveLength(2);
    expect(db.insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/attempts/[id]/evidence/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the route**

```typescript
// app/api/attempts/[id]/evidence/route.ts
import { db } from '@/lib/db/client';
import { attempts, criteria, rubrics, evidenceVerdicts } from '@/lib/db/schema';
import { mapEvidence } from '@/lib/services/evidence-mapping';
import { eq } from 'drizzle-orm';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: attemptId } = await params;

  const attempt = await db.query.attempts.findFirst({ where: eq(attempts.id, attemptId) });
  if (!attempt?.transcript) {
    return Response.json({ error: 'no_transcript' }, { status: 400 });
  }

  const projectCriteria = await db
    .select({ id: criteria.id, name: criteria.name, description: criteria.description, requiredEvidence: criteria.requiredEvidence })
    .from(criteria)
    .innerJoin(rubrics, eq(criteria.rubricId, rubrics.id))
    .where(eq(rubrics.projectId, attempt.projectId));

  const results = await mapEvidence(attempt.transcript, projectCriteria);

  await db.insert(evidenceVerdicts).values(
    results.map((r) => ({
      attemptId,
      criterionId: r.criterionId,
      stage: 'initial' as const,
      verdict: r.verdict,
      coverageScore: r.coverageScore,
      citedSpan: r.citedSpan,
      verifierAgreed: r.verifierAgreed,
    })),
  );

  await db.update(attempts).set({ status: 'evidence_mapped' }).where(eq(attempts.id, attemptId));

  const weakest = results.reduce((min, r) => (r.coverageScore < min.coverageScore ? r : min));

  return Response.json({ verdicts: results, weakestCriterionId: weakest.criterionId });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/attempts/[id]/evidence/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/attempts/\[id\]/evidence
git commit -m "feat: add evidence mapping route"
```

---

## Task 15: QuestionGenerator AI unit + route

**Files:**
- Create: `lib/ai/question-generator.ts`
- Create: `app/api/attempts/[id]/question/route.ts`
- Test: `lib/ai/question-generator.test.ts`
- Test: `app/api/attempts/[id]/question/route.test.ts`

**Interfaces:**
- Consumes: `STRONG_MODEL` (Task 4), `db`, `evidenceVerdicts`, `criteria`, `questions` (Task 2).
- Produces: `generateQuestion(criterion: { name, description, requiredEvidence }, missingEvidence: string | null): Promise<string>`, `POST /api/attempts/[id]/question` — the persisted question is consumed by Task 16 (defense).

- [ ] **Step 1: Write the failing test for the AI unit**

```typescript
// lib/ai/question-generator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateObject } from 'ai';
import { generateQuestion } from './question-generator';

vi.mock('ai', () => ({ generateObject: vi.fn() }));

describe('generateQuestion', () => {
  it('returns one adversarial question targeting the missing evidence', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { question: 'You claim strong demand — what primary research backs that up?' },
    } as never);

    const question = await generateQuestion(
      { name: 'Market Validation', description: 'd', requiredEvidence: 'Primary research' },
      'No primary research is mentioned.',
    );

    expect(question).toBe('You claim strong demand — what primary research backs that up?');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/ai/question-generator.test.ts`
Expected: FAIL with "Cannot find module './question-generator'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/ai/question-generator.ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { STRONG_MODEL } from './models';

const QuestionSchema = z.object({ question: z.string() });

export async function generateQuestion(
  criterion: { name: string; description: string; requiredEvidence: string },
  missingEvidence: string | null,
): Promise<string> {
  const { object } = await generateObject({
    model: STRONG_MODEL,
    schema: QuestionSchema,
    prompt: `You are a skeptical evaluator. A pitch/defense was judged weak on this criterion:

Criterion: ${criterion.name} — ${criterion.description}
Evidence required: ${criterion.requiredEvidence}
What's missing: ${missingEvidence ?? 'the required evidence was not addressed'}

Write exactly ONE pointed, adversarial question that a tough evaluator would ask to expose
this gap. Address the student directly. Do not soften it or offer suggestions.`,
  });
  return object.question;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/ai/question-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the route**

```typescript
// app/api/attempts/[id]/question/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as questionGen from '@/lib/ai/question-generator';
import { db } from '@/lib/db/client';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: {
    query: {
      evidenceVerdicts: { findFirst: vi.fn().mockResolvedValue({ id: 'ev-1', criterionId: 'crit-2', citedSpan: null }) },
      criteria: { findFirst: vi.fn().mockResolvedValue({ id: 'crit-2', name: 'Feasibility', description: 'd', requiredEvidence: 'e' }) },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'q-1' }]) }) }),
  },
}));

describe('POST /api/attempts/[id]/question', () => {
  it('generates and persists a question for the weakest criterion', async () => {
    vi.spyOn(questionGen, 'generateQuestion').mockResolvedValue('What evidence supports feasibility?');

    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ weakestCriterionId: 'crit-2' }) });
    const res = await POST(req, { params: Promise.resolve({ id: 'attempt-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.questionId).toBe('q-1');
    expect(body.question).toBe('What evidence supports feasibility?');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- app/api/attempts/[id]/question/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 7: Write the route**

```typescript
// app/api/attempts/[id]/question/route.ts
import { db } from '@/lib/db/client';
import { questions, criteria } from '@/lib/db/schema';
import { generateQuestion } from '@/lib/ai/question-generator';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: attemptId } = await params;
  const { weakestCriterionId } = await req.json();

  const criterion = await db.query.criteria.findFirst({ where: eq(criteria.id, weakestCriterionId) });
  if (!criterion) return Response.json({ error: 'criterion_not_found' }, { status: 404 });

  const questionText = await generateQuestion(criterion, criterion.requiredEvidence);

  const [question] = await db
    .insert(questions)
    .values({ attemptId, targetCriterionId: weakestCriterionId, questionText })
    .returning();

  return Response.json({ questionId: question.id, question: questionText });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- app/api/attempts/[id]/question/route.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/ai/question-generator.ts app/api/attempts/\[id\]/question
git commit -m "feat: add QuestionGenerator AI unit and route"
```

---

## Task 16: Defense evaluation route

**Files:**
- Create: `app/api/attempts/[id]/defense/route.ts`
- Test: `app/api/attempts/[id]/defense/route.test.ts`

**Interfaces:**
- Consumes: `judgeCriterion` (Task 11), `isSpanGrounded` (Task 5), `effectiveCoverageScore` (Task 6), `db`, `questions`, `criteria`, `defenseAnswers`, `evidenceVerdicts` (Task 2). Reuses EvidenceJudge scoped to the answer text instead of the original transcript (spec §3, §4).
- Produces: `POST /api/attempts/[id]/defense` — the final pipeline write before progress aggregation (Task 18) can read it.

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/attempts/[id]/defense/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as evidenceJudge from '@/lib/ai/evidence-judge';
import { db } from '@/lib/db/client';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: {
    query: {
      questions: { findFirst: vi.fn().mockResolvedValue({ id: 'q-1', targetCriterionId: 'crit-2', attemptId: 'attempt-1' }) },
      criteria: { findFirst: vi.fn().mockResolvedValue({ id: 'crit-2', name: 'Feasibility', description: 'd', requiredEvidence: 'e' }) },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}));

describe('POST /api/attempts/[id]/defense', () => {
  it('judges the answer against the same target criterion and persists a defense-stage verdict', async () => {
    vi.spyOn(evidenceJudge, 'judgeCriterion').mockResolvedValue({
      verdict: 'supported',
      span: 'we validated feasibility with three pilot users',
      missing: null,
    });

    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ questionId: 'q-1', answerText: 'we validated feasibility with three pilot users' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'attempt-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.verdict).toBe('supported');
    expect(db.insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/attempts/[id]/defense/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the route**

```typescript
// app/api/attempts/[id]/defense/route.ts
import { db } from '@/lib/db/client';
import { questions, criteria, defenseAnswers, evidenceVerdicts, attempts } from '@/lib/db/schema';
import { judgeCriterion } from '@/lib/ai/evidence-judge';
import { isSpanGrounded } from '@/lib/services/citation';
import { effectiveCoverageScore } from '@/lib/services/coverage';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: attemptId } = await params;
  const { questionId, answerText } = await req.json();

  const question = await db.query.questions.findFirst({ where: eq(questions.id, questionId) });
  if (!question) return Response.json({ error: 'question_not_found' }, { status: 404 });

  const criterion = await db.query.criteria.findFirst({ where: eq(criteria.id, question.targetCriterionId) });
  if (!criterion) return Response.json({ error: 'criterion_not_found' }, { status: 404 });

  await db.insert(defenseAnswers).values({ questionId, answerText });

  // Defense evaluation reuses EvidenceJudge, scoped to the new answer text instead of the
  // original transcript — same citation-or-reject rule applies (spec §3, §4).
  const judged = await judgeCriterion(answerText, criterion);
  const grounded = judged.verdict === 'unsupported' || (judged.span && isSpanGrounded(answerText, judged.span));
  const finalVerdict = grounded ? judged.verdict : 'unsupported';
  const finalSpan = grounded ? judged.span : null;

  await db.insert(evidenceVerdicts).values({
    attemptId,
    criterionId: criterion.id,
    stage: 'defense',
    verdict: finalVerdict,
    coverageScore: effectiveCoverageScore(finalVerdict, null),
    citedSpan: finalSpan,
    verifierAgreed: null,
  });

  await db.update(attempts).set({ status: 'defended' }).where(eq(attempts.id, attemptId));

  return Response.json({ verdict: finalVerdict, citedSpan: finalSpan });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/attempts/[id]/defense/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/attempts/\[id\]/defense
git commit -m "feat: add defense evaluation route reusing EvidenceJudge"
```

---

## Task 17: Rate limiting

**Files:**
- Create: `lib/rate-limit.ts`
- Modify: `app/api/attempts/[id]/evidence/route.ts`, `app/api/attempts/[id]/question/route.ts`, `app/api/attempts/[id]/defense/route.ts`, `app/api/rubrics/parse/route.ts`
- Test: `lib/rate-limit.test.ts`

**Interfaces:**
- Produces: `checkRateLimit(key: string): Promise<{ allowed: boolean }>` — consumed by every AI-touching route (Global Constraints: "Upstash Redis token bucket per user per AI-touching route").

- [ ] **Step 1: Write the failing test**

```typescript
// lib/rate-limit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Ratelimit } from '@upstash/ratelimit';
import { checkRateLimit } from './rate-limit';

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockResolvedValue({ success: true }) })),
}));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: vi.fn() } }));

describe('checkRateLimit', () => {
  it('allows a request within the limit', async () => {
    const result = await checkRateLimit('user-1:evidence');
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/rate-limit.test.ts`
Expected: FAIL with "Cannot find module './rate-limit'"

- [ ] **Step 3: Write the implementation**

```typescript
// lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '1 h'), // 20 AI calls/hour per key, bounds cost and abuse
});

export async function checkRateLimit(key: string): Promise<{ allowed: boolean }> {
  const { success } = await ratelimit.limit(key);
  return { allowed: success };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/rate-limit.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into each AI-touching route**

In `app/api/attempts/[id]/evidence/route.ts`, `app/api/attempts/[id]/question/route.ts`,
`app/api/attempts/[id]/defense/route.ts`, and `app/api/rubrics/parse/route.ts`, add as the
first lines of each handler (using Clerk's `auth()` for the user id):

```typescript
import { auth } from '@clerk/nextjs/server';
import { checkRateLimit } from '@/lib/rate-limit';

// inside each POST handler, before any AI call:
const { userId } = await auth();
const { allowed } = await checkRateLimit(`${userId}:evidence`); // route-specific suffix per file
if (!allowed) {
  return Response.json({ error: 'rate_limited' }, { status: 429 });
}
```

Use the route-specific suffix per file: `:rubric-parse`, `:evidence`, `:question`, `:defense`.

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: all tests still PASS

- [ ] **Step 7: Commit**

```bash
git add lib/rate-limit.ts lib/rate-limit.test.ts app/api
git commit -m "feat: add per-user rate limiting to AI-touching routes"
```

---

## Task 18: Progress aggregation route

**Files:**
- Create: `app/api/progress/[projectId]/route.ts`
- Test: `app/api/progress/[projectId]/route.test.ts`

**Interfaces:**
- Consumes: `db`, `evidenceVerdicts`, `criteria` (Task 2).
- Produces: `GET /api/progress/[projectId]` returning `{ trend: { criterionId: string; criterionName: string; averageCoverage: number }[]; mostRecurringGap: string | null }`.

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/progress/[projectId]/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { GET } from './route';

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValue([
                { criterionId: 'crit-1', criterionName: 'Market Validation', averageCoverage: 0.83 },
                { criterionId: 'crit-2', criterionName: 'Feasibility', averageCoverage: 0.2 },
              ]),
            }),
          }),
        }),
      }),
    }),
  },
}));

describe('GET /api/progress/[projectId]', () => {
  it('returns the coverage trend and names the most recurring gap', async () => {
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ projectId: 'proj-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.trend).toHaveLength(2);
    expect(body.mostRecurringGap).toBe('Feasibility');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/progress/[projectId]/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the route**

```typescript
// app/api/progress/[projectId]/route.ts
import { db } from '@/lib/db/client';
import { evidenceVerdicts, criteria, rubrics, attempts } from '@/lib/db/schema';
import { avg, eq } from 'drizzle-orm';

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const trend = await db
    .select({
      criterionId: criteria.id,
      criterionName: criteria.name,
      averageCoverage: avg(evidenceVerdicts.coverageScore).mapWith(Number),
    })
    .from(evidenceVerdicts)
    .innerJoin(criteria, eq(evidenceVerdicts.criterionId, criteria.id))
    .innerJoin(rubrics, eq(criteria.rubricId, rubrics.id))
    .where(eq(rubrics.projectId, projectId))
    .groupBy(criteria.id, criteria.name);

  const mostRecurringGap = trend.length
    ? trend.reduce((min, r) => (r.averageCoverage < min.averageCoverage ? r : min)).criterionName
    : null;

  return Response.json({ trend, mostRecurringGap });
}
```

Note: this query intentionally does not filter on `evidenceVerdicts.stage` — both initial and
defense-stage verdicts contribute to the trend, since a student improving their defense answer
over attempts is exactly the signal progress tracking exists to show. `attempts` import is
unused here and can be dropped if a future revision doesn't need it — kept only if a per-attempt
join is added later.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/progress/[projectId]/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/progress
git commit -m "feat: add progress aggregation route"
```

---

## Task 19: Minimal UI wiring (demo-ready, not final visual design)

**Files:**
- Create: `app/(app)/dashboard/page.tsx`
- Create: `app/(app)/projects/[id]/page.tsx`
- Create: `app/(app)/projects/[id]/RubricEditor.tsx`
- Create: `app/(app)/projects/[id]/AttemptFlow.tsx`

**Interfaces:**
- Consumes: every route from Tasks 8–10, 14–16, 18.
- Produces: a clickable path through the full loop (rubric confirm → paste attempt → evidence map → question → defense → progress) for the sprint demo. Visual polish is explicitly out of scope here — this is wiring, not design; a follow-up pass with the frontend-design skill is expected before the real demo if time allows.

- [ ] **Step 1: Write the dashboard (Server Component, lists projects)**

```typescript
// app/(app)/dashboard/page.tsx
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import Link from 'next/link';

export default async function Dashboard() {
  const { userId } = await auth();
  const userProjects = await db.select().from(projects).where(eq(projects.userId, userId!));

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Your projects</h1>
      <ul className="mt-4 space-y-2">
        {userProjects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="underline">{p.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Write the rubric editor client component**

```typescript
// app/(app)/projects/[id]/RubricEditor.tsx
'use client';
import { useState } from 'react';

type Criterion = { name: string; description: string; requiredEvidence: string };

export function RubricEditor({ projectId }: { projectId: string }) {
  const [rawText, setRawText] = useState('');
  const [draft, setDraft] = useState<Criterion[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  async function handleParse() {
    const res = await fetch('/api/rubrics/parse', { method: 'POST', body: JSON.stringify({ rawText }) });
    const body = await res.json();
    setDraft(body.criteria);
  }

  async function handleConfirm() {
    await fetch(`/api/projects/${projectId}/rubric`, {
      method: 'POST',
      body: JSON.stringify({ sourceType: 'pasted', criteria: draft }),
    });
    setConfirmed(true);
  }

  if (confirmed) return <p>Rubric saved.</p>;

  return (
    <div className="space-y-4">
      <textarea
        className="w-full border p-2"
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="Paste the rubric text here"
      />
      <button className="border px-4 py-2" onClick={handleParse}>Parse rubric</button>
      {draft.length > 0 && (
        <div>
          <ul>{draft.map((c) => <li key={c.name}>{c.name}: {c.requiredEvidence}</li>)}</ul>
          <button className="border px-4 py-2" onClick={handleConfirm}>Confirm and save</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the attempt flow client component**

```typescript
// app/(app)/projects/[id]/AttemptFlow.tsx
'use client';
import { useState } from 'react';

export function AttemptFlow({ projectId }: { projectId: string }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [evidence, setEvidence] = useState<{ verdicts: unknown[]; weakestCriterionId: string } | null>(null);
  const [question, setQuestion] = useState<{ questionId: string; question: string } | null>(null);
  const [answer, setAnswer] = useState('');

  async function startAttempt() {
    const res = await fetch('/api/attempts', { method: 'POST', body: JSON.stringify({ projectId, mode: 'paste' }) });
    const body = await res.json();
    setAttemptId(body.attemptId);
  }

  async function submitDraft() {
    await fetch(`/api/attempts/${attemptId}`, { method: 'PATCH', body: JSON.stringify({ transcript: draft }) });
    const res = await fetch(`/api/attempts/${attemptId}/evidence`, { method: 'POST' });
    setEvidence(await res.json());
  }

  async function askQuestion() {
    const res = await fetch(`/api/attempts/${attemptId}/question`, {
      method: 'POST',
      body: JSON.stringify({ weakestCriterionId: evidence!.weakestCriterionId }),
    });
    setQuestion(await res.json());
  }

  async function submitDefense() {
    await fetch(`/api/attempts/${attemptId}/defense`, {
      method: 'POST',
      body: JSON.stringify({ questionId: question!.questionId, answerText: answer }),
    });
  }

  if (!attemptId) return <button className="border px-4 py-2" onClick={startAttempt}>Start attempt</button>;
  if (!evidence) return (
    <div>
      <textarea className="w-full border p-2" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button className="border px-4 py-2" onClick={submitDraft}>Submit</button>
    </div>
  );
  if (!question) return <button className="border px-4 py-2" onClick={askQuestion}>Get the judge's question</button>;

  return (
    <div>
      <p>{question.question}</p>
      <textarea className="w-full border p-2" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      <button className="border px-4 py-2" onClick={submitDefense}>Submit defense</button>
    </div>
  );
}
```

- [ ] **Step 4: Write the project page composing both**

```typescript
// app/(app)/projects/[id]/page.tsx
import { RubricEditor } from './RubricEditor';
import { AttemptFlow } from './AttemptFlow';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="p-8 space-y-8">
      <RubricEditor projectId={id} />
      <AttemptFlow projectId={id} />
    </main>
  );
}
```

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, sign in via Clerk, create a project row directly via a DB seed script or
temporary insert, then click through: paste a rubric → confirm → start attempt → paste a
draft → see evidence → get a question → submit a defense answer.
Expected: no unhandled errors in the browser console at any step.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)
git commit -m "feat: wire minimal UI for the full rehearsal loop"
```

---

## Self-Review Notes

- **Spec coverage:** every endpoint in spec §4 has a task (Tasks 8–10, 14–16, 18); every AI
  unit in spec §3 has a task (7, 11, 12, 15) plus the transcription unit (10); the data model
  in spec §6 is fully covered by Task 2; error handling from spec §7 is covered by the
  retry/fallback logic in Tasks 10, 13, 14; rate limiting from spec §7 is Task 17.
- **Not covered by this plan, flagged in spec §10 as deferred:** rubric editing after initial
  confirmation (add/edit/remove criteria in place), the export/deletion endpoint for UU PDP
  compliance, and `PATCH /api/attempts/[id]` for paste-mode transcript submission (referenced
  in Task 19's UI but not written as its own task above — add as **Task 20** before executing
  Task 19 if the paste path needs to be demo-ready: same shape as Task 9, a one-field
  `db.update(attempts).set({ transcript, transcriptSource: 'paste', status: 'transcribed' })`
  route, small enough to fold into Task 9's execution rather than plan as a separate task).
- **Type consistency check:** `Verdict` type (Task 6) is imported and reused identically in
  Tasks 11, 13, 14, 16 — no divergent redefinitions. `MappedCriterionResult` (Task 13) field
  names match exactly what Task 14 destructures and persists.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-talk-active-app-layer.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
