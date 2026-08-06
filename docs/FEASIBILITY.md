# Lancar — Product and Feasibility Brief

**Updated:** 2026-08-07  
**Decision:** Build a recurring rehearsal workspace, not a speaking-score landing page.

## User and problem

The initial user is an Indonesian university student preparing for a high-stakes,
rubric-driven evaluation with limited mentor access: a hackathon pitch, scholarship panel,
or thesis defense. The problem is not merely nervous delivery. The student often does not
know which important claim is unsupported until an evaluator challenges it.

The useful product behavior is therefore:

> Keep each event, rubric, draft, attempt, judge defense, and recurring weakness together
> so the student always knows what to rehearse next.

## Product choice

Lancar now opens as a persistent workspace. The user can create projects, maintain each
rubric, practice a saved draft, inspect traceable evidence, answer one grounded question,
save the session, and track progress. The interface contains no marketing hero or scripted
“show the MVP” path.

This choice makes repeated use testable. A user can return tomorrow and continue from real
state instead of replaying a canned scenario.

## Why the scope is feasible

The product prototype is semantic HTML, CSS, and native JavaScript modules with no runtime
dependencies. Browser `localStorage` provides real persistence without requiring an
account system. Browser speech recognition is optional; pasting a transcript is the
reliable path. Analysis remains deterministic and explainable.

This keeps the hard product question visible: does rubric-grounded rehearsal change what a
student fixes before Q&A? Infrastructure can expand only after that behavior is useful.

## Honest boundaries

- Cue matching detects declared words, not semantic truth or argument quality.
- Evidence coverage is formative transcript context, not a confidence or ability score.
- Seeded workspace history exists so the returning-user state can be inspected immediately.
- Device-local persistence is useful for this prototype but is not cross-device storage.
- Dictation support depends on the browser and may be unavailable.
- No raw audio is stored.
- Production accounts need consent, expiry, export, and deletion controls.

## Validation plan

Give five students their actual event rubric and ask them to use Lancar across at least two
practice sessions. Observe whether they can create the project, represent the rubric,
understand the weakest claim, answer the judge question, and return later without help.

The strongest success signal is not “the UI looks impressive.” It is that the student
changes a specific claim because the rubric evidence review exposed a weakness, then uses
the saved history to continue preparation.

Key interview questions:

1. Did the workspace replace any part of your current preparation process?
2. Was the weakest-claim diagnosis credible when compared with your actual rubric?
3. Did the judge question reveal a gap you had not rehearsed?
4. Was the saved session useful when you returned for a second attempt?
5. What private material would you refuse to store or upload?

## Production architecture direction

Retain the current pure analyzer boundary and DOM safety rules. Replace local cue matching
behind that boundary with grounded semantic analysis; require every critique to cite the
criterion and transcript span. Add accounts, explicit retention controls, secure document
and audio storage, transcription, and deletion only with a clear consent model.

The authoritative competition source remains
`docs/Guidebook Registration RISTEK Hackathon.pdf`. Before official implementation, obtain
written clarification on permitted AI coding assistance and disclosure.
