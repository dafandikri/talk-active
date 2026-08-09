#!/usr/bin/env bash
# ============================================================================
#  Seed the Innovation Week sprint board.
#
#  Creates one GitHub issue per task in docs/specs/2026-08-10-innovation-week.md,
#  with track and priority labels, so the board matches the spec exactly.
#
#    ./scripts/seed-issues.sh --dry-run   # print what would be created
#    ./scripts/seed-issues.sh             # actually create them
#
#  Requires the GitHub CLI, authenticated:  gh auth login
#  Safe to re-run: it skips any issue whose title already exists.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

if ! command -v gh >/dev/null; then
  echo "gh (GitHub CLI) not found. Install it, or create the issues by hand from"
  echo "docs/specs/2026-08-10-innovation-week.md section 5."
  exit 1
fi

if [[ $DRY_RUN -eq 0 ]] && ! gh auth status >/dev/null 2>&1; then
  echo "Not authenticated. Run: gh auth login"
  exit 1
fi

SPEC="docs/specs/2026-08-10-innovation-week.md"

# id | track | priority | title | definition of done
TASKS=$(cat <<'ROWS'
A1|track:A|demo-critical|API analyze function + AI Gateway wired|curl returns the analyzer shape; no key in the client bundle; pnpm check green
A2|track:A|demo-critical|Prompt and schema for semantic evidence mapping|Structured output validated server-side; a response missing a span is rejected and logged
A3|track:A|demo-critical|Server-side validator and deterministic fallback wrapper|Unit test: malformed model output falls back and sets mode=deterministic; never throws to client
A4|track:A|demo-critical|Client integration behind SEMANTIC_ANALYSIS flag with mode badge|Toggling the flag swaps engines with no UI change; badge reads semantic or offline
A5|track:A|p1|Response cache keyed by hash of transcript and rubric|Second identical analysis returns in under 100ms; verified in the demo gate
A6|track:A|demo-critical|Rubric import: paste a scoring matrix, confirm structured criteria|Pasting the guidebook finals matrix yields at least 5 criteria with sensible cues; user can edit before saving
B1|track:B|demo-critical|Make the deployment publicly reachable for the exhibition|A stranger on their own phone can open the URL and use it, with no credentials
B2|track:B|p1|QR code to the live URL, printed for the booth|Scanned successfully from three different phones
B3|track:B|demo-critical|Kiosk reset control for between visitors|Reset restores seed projects in under 1s; covered by the demo gate
B4|track:B|p1|Empty, error and loading states for every view|No blank panel is reachable; a slow API shows a spinner, not a freeze
B5|track:B|demo-critical|Mobile pass at 390px across the full judge path|Demo gate runs the full path at 390px with zero overflow and zero console errors
B6|track:B|demo-critical|Extend demo gate to cover semantic mode, fallback and kiosk reset|Gate fails if fallback does not engage when the API is stubbed to error
C1|track:C|p1|Visual pass on workspace, evidence review and judge room|Consistent spacing, type scale and colour; reviewed on the actual demo screen
C2|track:C|p1|Make the evidence citation visually unmissable|A visitor identifies "this quote is why" without being told
C3|track:C|p2|Booth display: looping hero screen and value proposition|Legible from 2m on the venue screen; no motion that distracts from the live demo
C4|track:C|p2|Printed one-pager: problem, loop diagram, QR, team|A visitor who reads only this can explain what we do
D1|track:D|demo-critical|7-minute pitch script with hero moment at minute 4|Three consecutive runs land between 6:15 and 6:45
D2|track:D|demo-critical|Demo choreography and API-failure recovery line|Rehearsed once with the network physically off
D3|track:D|p1|Q&A bank with answers under 30 seconds|At least 20 questions; every mentor question from Days 1-4 added
D4|track:D|p1|Drill Q&A using Talk-Active against the finals rubric|Every criterion reaches defensible; screenshot kept as evidence
D5|track:D|p1|Pitch deck matching the guidebook required content list|Covers value proposition, tech stack, architecture, core features, live demo
E2|track:E|p1|Nightly full gate run and known-good tag|A tagged commit exists each night that we could demo from
E3|track:E|demo-critical|Prepare the offline demo laptop|Full demo runs with wifi physically disabled
E4|track:E|blocker|Final submission package by 13 Aug 23.55|Submitted, with a screenshot of the confirmation
ROWS
)

# Labels are created once; ignore "already exists".
for label in demo-critical blocker p1 p2 nice-to-have track:A track:B track:C track:D track:E; do
  if [[ $DRY_RUN -eq 0 ]]; then
    gh label create "$label" --force >/dev/null 2>&1 || true
  fi
done

existing=""
if [[ $DRY_RUN -eq 0 ]]; then
  existing=$(gh issue list --limit 200 --state all --json title --jq '.[].title' 2>/dev/null || true)
fi

created=0
skipped=0
while IFS='|' read -r id track priority title dod; do
  [[ -z "${id:-}" ]] && continue
  full_title="[$id] $title"

  if grep -Fxq "$full_title" <<<"$existing" 2>/dev/null; then
    echo "  skip (exists)  $full_title"
    skipped=$((skipped + 1))
    continue
  fi

  body="**Definition of done**
$dod

Track \`$track\` · see [$SPEC]($SPEC) section 5.

Not done until \`pnpm check\` is green."

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  would create   $full_title   [$track, $priority]"
  else
    gh issue create --title "$full_title" --body "$body" \
      --label "$track" --label "$priority" >/dev/null
    echo "  created        $full_title"
  fi
  created=$((created + 1))
done <<<"$TASKS"

echo
if [[ $DRY_RUN -eq 1 ]]; then
  echo "dry run: $created issues would be created. Re-run without --dry-run to apply."
else
  echo "done: $created created, $skipped skipped."
  echo "Next: create a Project board with columns Todo / Doing / Blocked / Done and add these issues."
fi
