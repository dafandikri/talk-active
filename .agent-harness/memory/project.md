# Project Memory

> Durable facts about THIS project that are not obvious from the code or git history.
> Convert relative dates to absolute. One fact per bullet. Link related facts.
> This is User Layer — never auto-overwritten by `harness update`.

## Decisions

- Use this workspace as the Lancar product repository rather than creating a second repo — it already contains the authoritative guidebook and prior concept research (2026-08-06).
- Target rubric-driven Indonesian student evaluations, beginning with competition pitches — a generic speaking coach overlaps too heavily with Yoodli, Orai, and Speeko (2026-08-06).
- Make the invariant product loop rubric → evidence → hardest question → focused retry — this is more defensible and demoable than filler-word or body-language scoring (2026-08-06).
- Ship a dependency-free, deterministic browser product before integrating transcription or an LLM — first validate repeated use and disclose that it is not production AI (2026-08-06; scope corrected 2026-08-07).
- Treat body-language feedback, streaks, daily topics, teams, and dashboards as roadmap only — they do not prove the core wedge (2026-08-06).
- Keep the Judge Room as a normal practice stage between review and saved progress; it must work with the user's answer and must not be a scripted friend-demo transition (2026-08-07).
- Treat Lancar as a recurring product workspace, not a product-demo page: users keep projects, rubrics, drafts, attempts, Q&A defenses, and progress across browser reloads. Marketing hero copy and scripted demo controls are explicitly rejected (2026-08-07).

## Gotchas

- Yoodli has supported Indonesian practice since 2025 and already offers AI follow-up questions and computer-vision feedback; localization and multimodality alone are not differentiation.
- Speech-to-text systems may normalize away non-lexical fillers such as “um” and “eee”; transcript-only filler counts must be labeled approximate and manually evaluated.
- The guidebook's outside-assistance rule makes AI-generated implementation compliance ambiguous; obtain organizer confirmation before the official hacking period.
- The current workspace was not a Git repository when the Lancar product work began.

## Glossary

- Evidence map — criterion-level links from an evaluator rubric to exact claims in the student's attempt.
- Grounded question — a judge-style follow-up generated from missing or contradictory evidence, with rubric and transcript references.
- Focused retry — a short second attempt addressing only the weakest criterion.
- Evidence score — transparent prototype cue coverage, never a universal public-speaking grade.
- Product prototype — a usable, persistent local version of the recurring workflow without production infrastructure.
