# Team integration handoff — 12 August 2026

This is the current integration instruction. The earlier frontend report remains at
`docs/PROGRESS-2026-08-12.md`, but several of its source observations are now stale.

## What the current branch already contains

| Work | Current evidence |
|---|---|
| B3 kiosk reset | Demo gate restores the seed project and sessions, clears in-memory practice state, and survives reload. |
| B4 empty/loading states | Browser gate reaches the empty states; demo gate observes the accessible analysis busy state. |
| B5 mobile path | The complete judge path runs at 390 px without clipping or overflow. |
| P0-1 through P0-4 | Client/server time budgets, quote normalization, per-criterion provenance, and the named minimum span are implemented and tested. |
| A6 rubric import | The browser and API both import a pasted matrix into editable criteria. |
| B6 semantic/fallback gate | Semantic mode, deterministic fallback, cache behavior, and evidence provenance are enforced. |
| Windows gate fixes | URL backslashes are normalized safely; Chrome and Edge discovery covers standard Windows installations. |
| BR-2 and BR-3 | The macaw mark is wired into all public surfaces and the head-only favicon is shipped. |

The six commit IDs named in the frontend report (`9e5fe00`, `ac8145c`, `5879d4e`,
`1c738eb`, `332e05c`, and `413b69a`) arrived on `origin/main` during the integration audit.
Merge `b401bc3` preserves those commits in repository history. Where the two tracks touched the
same lines, the resolution retained the larger semantic, fallback, rubric-import, booth, and
mobile gate while carrying forward the frontend track's two-attempt trend rule and 44 px mobile
tap-target requirement.

## The Vercel blocker is removed

Vercel cannot block a Git commit or a GitHub push. It can block the automatic **deployment**
created from a private-repository commit whose author does not have the required Vercel project
access.

The repository owner approved public visibility on 12 August 2026. GitHub reports the repository
as `PUBLIC`, and an unauthenticated request to `https://github.com/dafandikri/talk-active`
returned HTTP 200. No additional Vercel seat is needed for the remaining collaboration workflow:

1. The frontend developer pushes a normal branch to the public GitHub repository.
2. The repository owner reviews the diff and integrates it.
3. The owner runs `pnpm check` and deploys the integrated commit.
4. Share the resulting Preview URL with the developer as an external preview collaborator.

This keeps GitHub authorship intact and does not require sharing a Vercel token or AI Gateway
credential. A free Viewer seat or a shared Preview link permits review and comments, but it does
not grant deployment rights.

Do not buy another Vercel seat for a two-day handoff. Contributors do not need deployment rights
to preserve authorship or submit reviewable GitHub branches, and the integration owner can deploy
the accepted release.

Official references:

- <https://vercel.com/docs/git>
- <https://vercel.com/docs/deployments/troubleshoot-project-collaboration>
- <https://vercel.com/docs/deployments/sharing-deployments>
- <https://vercel.com/docs/plans/pro-plan>

## Copy-paste message for the frontend developer

> Your frontend branches arrived and are now preserved in the integration history—thank you.
> B3, B4, B5, and the Windows portability work are included. I resolved the overlapping lines
> with the semantic/fallback, rubric-import, booth, and production work, and retained your
> two-attempt trend rule plus the 44 px mobile target. The repository is now public, and you do
> not need a paid Vercel seat for the remaining handoff. Keep pushing normal GitHub branches and
> send the branch name, commit hash,
> and complete `pnpm check` result; I will review and deploy the integrated owner commit. Please
> never send `.env.local`, a Vercel token, or an AI key.

## Commands after the branch arrives

```bash
git fetch origin
git log --oneline --decorate HEAD..origin/<frontend-branch>
git diff --stat HEAD...origin/<frontend-branch>
git diff HEAD...origin/<frontend-branch> -- index.html src scripts test
```

Review before merging. Never force-push, never share credentials, and do not cherry-pick a change
whose behavior already exists under a different commit.

## Publication and branch audit completed

- Every remote feature branch named in the frontend report is an ancestor of the release.
- Every surviving backend topic patch is patch-equivalent to an integrated release commit. The
  early A1 branch's Gateway fix is patch-equivalent; its ignore/example-file changes are
  superseded by the stricter current `.gitignore` and documented `.env.example`.
- The public remote history was scanned with Gitleaks and targeted provider, GitHub, Vercel,
  cloud, and private-key patterns; Gitleaks scanned 50 commits and found no leaks.
- The only matching path was `.env.example`; every historical Gateway value there was a
  placeholder.
- `.env*` and `.vercel/` are ignored. The actual local and Vercel credentials are not tracked.
- No blob larger than 5 MB exists in the public remote history.
- The repository still contains event documents, member names, and source PDFs by design. The
  captain approved making that material public on 12 August 2026.
