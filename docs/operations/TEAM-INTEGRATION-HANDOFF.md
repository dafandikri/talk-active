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
`1c738eb`, `332e05c`, and `413b69a`) are not present in this clone. Do not claim they were
merged. The behaviors were verified in the current integration branch independently.

## The Vercel blocker, precisely

Vercel cannot block a Git commit or a GitHub push. It can block the automatic **deployment**
created from a private-repository commit whose author does not have the required Vercel project
access.

Use this zero-additional-seat workflow for the remaining sprint:

1. The frontend developer pushes a normal branch to the private GitHub repository.
2. The repository owner reviews the diff and integrates it.
3. The owner runs `pnpm check` and deploys the integrated commit.
4. Share the resulting Preview URL with the developer as an external preview collaborator.

This keeps GitHub authorship intact and does not require sharing a Vercel token or AI Gateway
credential. A free Viewer seat or a shared Preview link permits review and comments, but it does
not grant deployment rights.

If every private-repository commit must deploy directly under a Pro team, Vercel documents an
additional deploying Member seat at **$20/month**. Do not buy that seat for a two-day handoff.
The official finals rules already require the repository to become public before submission;
after the publication audit and captain approval, public-repository collaboration removes this
private-repository restriction.

Official references:

- <https://vercel.com/docs/git>
- <https://vercel.com/docs/deployments/troubleshoot-project-collaboration>
- <https://vercel.com/docs/deployments/sharing-deployments>
- <https://vercel.com/docs/plans/pro-plan>

## Copy-paste message for the frontend developer

> Your GitHub work is still useful; Vercel access is not required to send it. Please push your
> existing frontend branch to `origin` without rebasing or recreating the commits. Then send me
> the branch name, `git rev-parse HEAD`, `git status --short`, and the complete `pnpm check`
> result. Do not send `.env.local`, a Vercel token, or an AI key. The integration branch already
> contains B3/B4/B5, semantic provenance, rubric import, Windows path/browser fixes, and the
> macaw/favicon port, so I will compare the diff and keep only non-duplicate improvements. If
> Vercel reports that you are not a team member, ignore the deployment failure—the GitHub branch
> is the handoff. I will deploy the reviewed integration as the project owner.

## Commands after the branch arrives

```bash
git fetch origin
git log --oneline --decorate HEAD..origin/<frontend-branch>
git diff --stat HEAD...origin/<frontend-branch>
git diff HEAD...origin/<frontend-branch> -- index.html src scripts test
```

Review before merging. Never force-push, never share credentials, and do not cherry-pick a change
whose behavior already exists under a different commit.

## Publication audit completed locally

- The tracked tree and all reachable Git history were scanned for common provider, GitHub,
  Vercel, cloud, and private-key patterns.
- The only matching path was `.env.example`; every historical Gateway value there was a
  placeholder.
- `.env*` and `.vercel/` are ignored. The actual local and Vercel credentials are not tracked.
- No blob larger than 5 MB exists in reachable history.
- The repository still contains event documents, member names, and source PDFs by design. The
  captain must approve making that material public; visibility is not changed automatically.
