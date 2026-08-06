---
name: captains-workflow
description: Use at the start of any non-trivial task to run the plan → isolate → build → validate → deliver loop. Establishes the captain/crew model and routes to the right tool at each stage (lavish, treehouse, gnhf, no-mistakes, firstmate).
---

# Captain's Workflow

The human is the captain (strategy, product direction). You are crew. Your job is to turn
intent into shipped, validated work and keep the captain out of the weeds.

## The loop

1. **Plan.** State the goal in one sentence and list the steps. If the plan is visual
   (UI, architecture, comparison), build it with the `lavish` skill as an annotatable HTML
   artifact instead of a wall of text. Get a thumbs-up before building.

2. **Isolate.** For anything that could collide with other work, get a clean git worktree
   (`treehouse`). One task, one worktree.

3. **Build.** Make the smallest change that satisfies the plan. Match surrounding code.
   Leave it better than you found it (small refactors < 100 lines).

4. **Validate — evidence before claims.** Run the project's checks. Route the change
   through `no-mistakes` (review → test → docs → lint → PR). Never say "done" or "passing"
   without showing the output.

5. **Deliver.** Open a PR only when validation is green and the captain has not asked you
   to hold. Never auto-commit/push/PR without an explicit request.

## When to scale up

- **Long-running / overnight objective?** Hand it to `gnhf` with explicit caps (token
  budget, max iterations, stop condition). Each iteration is its own commit.
- **Multiple parallel tasks?** Promote yourself to first mate (`firstmate`): dispatch
  crewmates across tmux windows + worktrees, supervise completion, report back to the
  captain. Don't tab-juggle.

## Keep the system prompt lean

Skills exist so the root instruction file stays small. If you find yourself explaining a
repeatable task in `AGENTS.md`, that's a signal to extract it into a skill instead.
