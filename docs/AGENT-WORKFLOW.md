# Talk-Active agent workflow

This repository uses agents to ship verifiable work; it does not make the product claim that
Talk-Active is an autonomous agent. The working model follows the practical distinctions and
patterns in Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):
use the simplest pattern that fits, compose explicit workflows for predictable work, reserve
open-ended autonomy for genuinely open-ended tasks, and keep the human able to inspect and
redirect the process.

## The default is a workflow

Most repository work is predictable enough to use a fixed path:

```text
captain intent
  → plan and scope checkpoint
  → isolated worktree
  → bounded implementation
  → tests + browser + artifact evidence
  → human review
  → commit / push / PR only when requested
```

This is prompt chaining with gates. A failed gate returns work to implementation; it never
gets relabelled as complete. `pnpm check` is the final programmatic gate.

## When parallel workers are appropriate

First-mate may section independent work across isolated workers when ownership can be stated
before implementation. Each worker receives:

- one concrete objective and an explicit file boundary;
- the relevant invariants and active spec;
- a validation command;
- a stop condition and a no-expansion rule;
- a required handoff: changed files, evidence, risks, and unresolved items.

The orchestrator integrates and validates the result. Workers do not merge themselves, and
they do not treat another worker's intent as evidence.

Use evaluator-style parallel review only when the perspectives are genuinely independent,
such as accessibility, security, and product-invariant review. Do not multiply agents for a
single small edit.

## Ground truth and transparency

An agent checks the environment after every meaningful step. Ground truth is:

- current file and git state;
- command output and automated tests;
- browser-visible state at the required viewport;
- generated artifacts that can be opened and inspected;
- external state from the authoritative service or source.

A plan, confident sentence, or another agent's summary is not ground truth. Progress reports
name what has been observed and what remains unverified. User-facing product claims stay
bounded by INV-1 through INV-8.

## Stop conditions and human control

Every delegated task stops when one of these occurs:

1. its objective and validation are complete;
2. it reaches its declared iteration or time cap;
3. a permission, scope, destructive-action, or product decision needs the captain;
4. the same blocker prevents meaningful progress;
5. continuing would overlap another worker's ownership.

Agents pause at strategy checkpoints and surface trade-offs. They never infer permission to
commit, push, open a PR, merge, submit, send a message, or broaden product scope.

## Tool and interface design

Agent-facing commands should be simple, well documented, and difficult to misuse. Inputs use
clear names and explicit boundaries; outputs expose enough detail to diagnose failure. New or
changed agent-facing CLI commands follow the `axi` skill and are covered by tests. The command
surface should shrink ambiguity rather than hide it behind a framework.

## Pattern selection

| Situation | Pattern |
|---|---|
| Small, well-defined edit | One workflow; no delegation |
| Fixed multi-step transformation | Prompt chain with gates |
| Independent files or review dimensions | Parallel sectioning with one integrator |
| Unknown multi-file implementation | Orchestrator-workers with bounded ownership |
| Output improves against explicit criteria | Evaluator-optimizer with a hard iteration cap |
| Open-ended trusted task | Autonomous loop with environment feedback and stop conditions |

Complexity must earn itself through better observable outcomes. A simpler pattern wins when
it can satisfy the same acceptance criteria with lower latency, cost, and failure surface.

## Repository enforcement map

The workflow is integrated only when its instructions, skill, and gates agree. A generated
manifest entry by itself is not proof that a capability works; the repository tests the files
and commands that agents and contributors actually execute.

| Contract | Repository source | Executable enforcement |
|---|---|---|
| Model-agnostic instructions | `AGENTS.md` plus the Claude, Gemini, Qwen, and Copilot adapters | `test/harness-integration.test.mjs` |
| Captain/crew delivery loop | `.agents/skills/captains-workflow/SKILL.md` | `test/harness-integration.test.mjs` |
| One definition of done | `pnpm check` in `package.json` | unit, invariant, browser, demo, project, and finals gates |
| Block a broken push locally | `.githooks/pre-push` | runs `pnpm check`; installed with `pnpm setup:hooks` |
| Re-run the same gate remotely | `.github/workflows/check.yml` | every push and pull request; fails when browser gates skip |
| Preserve review discipline | `.github/pull_request_template.md` | requires green checks and prohibits weakened tests |
| Keep finals evidence current | `docs/rubrics/2026-finals.json` and `docs/finals-readiness.json` | `pnpm finals` |

`pnpm check` is the single integration command. A new skill, adapter, or quality gate is not
finished until it is reachable from the canonical instructions, represented in this map, and
covered by an executable test. Git operations remain a separate human authorization step even
after the gate is green.
