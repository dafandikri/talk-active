# Lancar Rehearsal Workspace — Product Contract

**Updated:** 2026-08-07  
**Status:** Device-local product prototype implemented

## Product definition

Lancar is a persistent preparation workspace for a student who expects to practice more
than once. Each project owns its event context, deadline, evaluator rubric, current draft,
and session history. A practice session turns one transcript into a traceable evidence map,
one hard judge question, one evaluated answer, and a saved progress point.

The interface must feel like an authenticated application even though this implementation
is device-local. It must never present itself as a demo, explain its startup wedge before
letting the user work, or require a canned walkthrough.

## Core jobs

1. Organize preparation by real event or evaluation context.
2. Keep the evaluator's actual criteria close to every practice attempt.
3. Find the weakest unsupported claim in the latest transcript.
4. Rehearse the question a skeptical evaluator would ask about that claim.
5. Save attempts and reveal recurring gaps across sessions.

## Product requirements

### Workspace

- A returning user lands on the current project, last coverage, recurring weakness,
  deadline, recommended next session, rubric readiness, and recent activity.
- Users can create and switch projects without losing existing work.
- Project data persists across a browser reload.

### Rubric

- Every project has its own editable criteria and evidence cues.
- Users can add and remove criteria.
- Analysis cannot run without at least one criterion.
- User-entered criterion content is rendered with `textContent`, never `innerHTML`.

### Practice

- A session has explicit setup, attempt, review, and defense stages.
- A transcript can be pasted or dictated when browser speech recognition is available.
- The draft and supplied duration persist locally while the student works.
- The review exposes criterion coverage, transcript evidence, missing cues, pace, potential
  fillers, the weakest claim, and one focused drill.
- Evidence coverage is clearly labeled as transcript/rubric evidence—not a confidence or
  ability score.

### Judge defense

- The question is grounded only in the current weakest criterion.
- Answer feedback names which declared cues were explicit and which remain missing.
- A second pushback question appears after evaluation.
- The session can also be saved without completing Q&A.

### Progress

- Saving a session creates a durable history entry for the current project.
- Progress shows latest evidence coverage, change from the prior attempt, the most recurring
  gap, a chart, and the full local session archive.
- Project creation, rubric edits, drafts, and sessions survive a page reload.

## Current architecture

```text
index.html
  └─ src/app.mjs              routes, workspace state, local persistence, DOM effects
       └─ src/analyzer.mjs    pure rubric parsing and deterministic analysis

scripts/serve.mjs             allow-listed local static server
scripts/browser-check.mjs     complete CDP product and responsive gate
scripts/project.mjs           agent-facing context and artifact doctor
test/*.test.mjs               analyzer, CLI, and HTTP boundary tests
```

The workspace snapshot is stored under `lancar.workspace.v1` in browser `localStorage`.
Raw audio is never created or stored by the application.

## Acceptance evidence

- [x] No marketing hero, “run demo,” or friend-demo controls remain.
- [x] Home, Practice, Rubric, and Progress are functional application areas.
- [x] A project can be created and selected.
- [x] Rubric criteria can be edited, added, removed, and saved per project.
- [x] A saved draft can be reviewed against four rubric criteria.
- [x] The weakest criterion generates one grounded judge question.
- [x] A defense answer reports matched/missing evidence and follow-up pressure.
- [x] Saving adds a session and progress chart point.
- [x] Projects, rubric edits, drafts, and sessions survive reload.
- [x] Dynamic user content uses safe DOM text assignment.
- [x] Desktop and 390px mobile layouts have no horizontal overflow.
- [x] One repository command verifies domain logic, HTTP boundaries, full product workflow,
  responsive behavior, persistence, and artifact health.

## Production next steps

1. Replace local workspace identity with consent-aware accounts and explicit deletion.
2. Add rubric/proposal/deck ingestion with structured review before saving.
3. Add recording, transcription, expiry, and deletion controls.
4. Replace cue matching with semantic evidence mapping that cites rubric and transcript.
5. Add recorded judge answers and project-level export.
6. Validate the recurring workflow with real students over multiple preparation sessions.

Body-language scoring, gamified streaks, broad generic scenarios, and institutional
dashboards remain out of scope until repeated use validates the core loop.
