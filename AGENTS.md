# Lancar — Agent Instructions

> Scaffolded by agent-harness. This is the canonical, model-agnostic instruction file.
> Tool-specific files (`CLAUDE.md`, `GEMINI.md`, …) point here. Edit this file to make it
> yours — it is the project's memory. This file is **User Layer**: `harness update` will
> never overwrite it.

## What we're building

Lancar is a rubric-grounded rehearsal and judge Q&A workspace for Indonesian university
students. The current milestone is a usable, dependency-free browser product with
persistent projects, per-project rubrics and drafts, multi-stage practice, grounded Q&A,
and saved progress. It is not a landing-page demo or generic public-speaking scorecard.

## Stack & conventions

- Language / framework: semantic HTML, CSS, and native JavaScript ES modules on Node.js 20+.
- Package manager: pnpm. The product prototype intentionally has zero runtime or development dependencies.
- Start: `pnpm dev` (local allow-listed server on `127.0.0.1:4173`).
- Tests and repository gate: `pnpm check` (unit, HTTP security, real-browser interaction, responsive layout, and artifact health).
- Agent context: `pnpm project` (compact TOON output); `pnpm project check` for artifact health.
- Prefer pure domain logic in `src/analyzer.mjs`; keep DOM effects in `src/app.mjs`.
- Render all user-provided rubric and transcript content with `textContent`, never `innerHTML`.

## How to work here (the captain's mindset)

You are crew on this project; the human is the captain. Translate intent into shippable
work, surface trade-offs, and keep the captain focused on strategy — not babysitting.

1. **Plan before building.** For any non-trivial change, write a short plan first. Use the
   `lavish` skill for interactive HTML plans when a visual is clearer than text.
2. **Validate before declaring done.** Run the project's checks. Use the `no-mistakes`
   gate (review → test → docs → lint → PR) before raising a PR. Evidence before claims.
3. **Isolate parallel work** in git worktrees (`treehouse`); coordinate multi-agent work
   through `firstmate`.
4. **Long-running objectives** run under `gnhf` with explicit token/iteration/stop caps.

## Skills

This project uses the open agent-skill ecosystem (`npx skills`). Skills teach you specific
tasks without bloating this file. List what's installed and when to reach for each:

- `captains-workflow` — route non-trivial changes through plan → build → validate → deliver.
- `axi` — apply when changing `scripts/project.mjs` or another agent-facing command.
- `browser` — use for local visual and interaction QA when available.

## Product invariants

- The differentiating loop is project → rubric → attempt → evidence → hardest question → saved progress.
- Feedback is formative and traceable; never claim an objective confidence or ability score.
- Delivery metrics are supporting context, not the core value proposition.
- The current analyzer is deterministic prototype logic. Do not describe it as production AI.
- Raw audio is not persisted. A production implementation needs consent, expiry, and deletion.
- Body-language analysis, streaks, broad scenarios, and institutional dashboards remain out of scope until the core loop is validated.

## Guardrails

- Never auto-run git operations (commit/push/PR) unless the captain asks.
- Keep this file lean. Move task-specific detail into skills, not here.
- When you learn a durable project fact, record it here or in `.agent-harness/memory/`.
- Preserve `docs/Guidebook Registration RISTEK Hackathon.pdf` as the authoritative competition source.
- Before official hacking-period implementation, confirm the organizer's policy on AI coding assistants and required disclosure.
