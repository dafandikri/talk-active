# RISTEK Hackathon 2026 — Preliminary Proposal

LaTeX source for the Talk-Active preliminary-round proposal.

## Before you submit

Edit **`teaminfo.tex`** only. Replace every `«PLACEHOLDER»`: team name, leader
(must be Fasilkom UI), and members. If you have four or five members, flip
`\ShowFourfalse` / `\ShowFivefalse` to `\ShowFourtrue` / `\ShowFivetrue`.

Then:

```bash
./build.sh
```

That compiles the PDF, names it `Preliminary_RistekHackathon2026_<TeamName>.pdf`
as the guidebook requires, and verifies the format rules. It warns if any
placeholder is still present.

## Format rules this enforces

Every rule comes from the guidebook's Format Guideline table (p.15–16) and is
checked automatically by `build.sh`:

| Rule | Implementation |
| --- | --- |
| Times New Roman | Real Monotype TTFs in `assets/fonts/`, loaded via `fontspec`. The PDF embeds no other font. |
| Title 14 pt bold, body 12 pt | `titlesec` for headings; `\documentclass[12pt]`. |
| 1.5 line spacing | `setspace` `\onehalfspacing`. |
| Justified | LaTeX default, stated explicitly via `ragged2e`. |
| Page number bottom-right | `fancyhdr` `\fancyfoot[R]`. Verified at 3.00 cm from the right edge. |
| 3 cm margins | `geometry`; header and footer sit inside the margin band, so the text block is exactly 3 cm on all sides. Microtype protrusion is disabled so no ink crosses the line. |
| Max 10 pages | Body is exactly 10 numbered pages. Cover, references, and appendices are excluded by the rule itself. |
| Logo on every page | All three logos from the official folder (`ristek.link/RISTEKHackathon2026Logo`) render in the `fancyhdr` header of every page. |
| English / PDF | Throughout. |

## Structure

```
main.tex        document root
preamble.tex    every format rule, commented with its guidebook source
teaminfo.tex    >>> THE ONLY FILE YOU NEED TO EDIT <<<
cover.tex       cover page (logos, product name, team name)
body.tex        sections 1-8, the 10 counted pages
backmatter.tex  references + appendices A-B
fig-*.tex       TikZ figures
assets/         logos, fonts, product screenshots
```

Appendices are excluded from the page limit, which is why the supporting
material lives there.

The **Originality Statement is not in this PDF** — submit it separately as a
signed copy of the committee's template
(`ristek.link/RISTEKHackathon2026Originality`).

## Sources

- Logos were downloaded from the official `ristek.link` short link.
- Every statistic in the proposal is cited in the References section.

## Regenerating the screenshot

`assets/screens/crop-evidence.png` is a real capture of the running prototype,
produced by the repository's own browser gate:

```bash
cd ../..
node scripts/browser-check.mjs --screenshot docs/proposal/assets/screens/shot.png
```

## Open items before submitting

1. Fill in `teaminfo.tex`.
2. Cite `talk-active-id.vercel.app` as the deployed URL. Two near-misses belong
   to unrelated sites and must never reach the deck, the one-pager, or the QR
   code: `lancar.vercel.app` serves a shoe retailer, and `talk-active.vercel.app`
   is someone else's app that returns 200 on every path, so it looks like ours
   until a judge actually reads the page.
3. Submit the signed Originality Statement separately.
4. Confirm the organizer's policy on AI coding assistance and disclose it
   accurately — the originality statement covers "misrepresentation of AI usage."
