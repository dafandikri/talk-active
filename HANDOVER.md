# Handover — 12 August 2026

**Read `AGENTS.md` and `docs/specs/2026-08-10-innovation-week.md` first.** The active,
detailed integration record is `docs/operations/TEAM-INTEGRATION-HANDOFF.md`; the frontend
developer's point-in-time report remains at `docs/PROGRESS-2026-08-12.md`.

**Deadline:** submission 13 August at 18.00 WIB · internal target 17.00 WIB · finals 14 August.

## Current release

- `origin/main` and `origin/finals-hardening-integration` point to the same known-good release.
- B3 kiosk reset, B4 empty/loading states, B5 mobile 390 px, Windows gate portability,
  P0 semantic hardening, A6 rubric import, B6 fallback proof, and the macaw identity are all
  integrated.
- The frontend commits named in the progress report are preserved as ancestors of the release.
  The older backend topic branches are patch-equivalent to integrated commits; do not merge or
  cherry-pick them again.
- The GitHub repository is public and returned HTTP 200 anonymously on 12 August 2026.
- Production is `https://talk-active-id.vercel.app`. Semantic analysis uses the capped finals AI
  Gateway key and degrades visibly to deterministic cue matching when the API is unavailable.

The last complete gate on the known-good release passed 161 unit/invariant checks, 18 browser
checks, all 16 demo stages, zero console errors, and all 19 artifact checks. Run `pnpm check`
again after every change; this statement is not permission to skip the gate.

## What remains human-owned

No outstanding feature branch needs integration. The remaining work is physical or organizer
evidence recorded in `docs/operations/FINAL-SUBMISSION-CHECKLIST.md` and
`docs/finals-readiness.json`:

1. Confirm the exact filename format and AI-assistance policy with the organizer.
2. Complete three timed pitch runs, the operator handoff, Q&A drill, and Wi-Fi-off rehearsal.
3. Open the exact submitted deck/PDF and click both production and GitHub links anonymously.
4. Print and test booth artifacts, confirm staffing/dress, upload before 17.00 WIB, and retain
   submission evidence.

`pnpm finals` must remain strict: it is expected to stay red until those witness-backed actions
actually happen. Never convert a blank checklist into a claim.

## Safe collaboration from here

Because the repository is public, contributors can push normal GitHub branches without buying a
Vercel seat. A contributor branch does not need its own Vercel deployment. Send the branch name,
commit hash, and `pnpm check` result to the integration owner; the owner reviews, integrates, runs
the gate, and deploys the accepted commit. Never share `.env.local`, Vercel tokens, or Gateway
credentials.
