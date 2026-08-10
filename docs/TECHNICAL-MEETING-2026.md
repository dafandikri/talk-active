# RISTEK Hackathon 2026 — Technical Meeting Record

- **Status:** official-event source transcription for agents
- **Meeting date:** 10 August 2026
- **Source artifacts:** 20 local screenshots in `docs/Technical Meeting Slides/` (intentionally Git-ignored)
- **Enforcement:** [`test/technical-meeting.test.mjs`](../test/technical-meeting.test.mjs) runs in `pnpm check`

This file is the searchable, agent-readable record of the supplied technical-meeting slides.
Text is normalized for line wrapping, punctuation, and table layout; requirements, dates,
weights, names, and penalties preserve the source meaning. Every section names its local
source screenshot. When this record and a later direct organizer instruction conflict, stop and ask
the organizer; do not silently choose the more convenient rule.

## Enforced finals rubric

The official scoring categories and weights are encoded in
[`docs/rubrics/2026-finals.json`](rubrics/2026-finals.json) as three evaluated surfaces:
**Final Product**, **Product Presentation**, and **Booth Exhibition**. The companion
[`docs/finals-readiness.json`](finals-readiness.json) ledger requires concrete evidence for
every criterion and operational requirement.

- `pnpm rubric` shows weighted readiness by surface.
- `pnpm check` fails if official weights, categories, requirements, ownership, or evidence
  obligations drift.
- `pnpm finals` is the strict pre-submission gate. It fails until every item is marked
  `verified` with concrete evidence; pending work is reported as a gap, never as a pass.

The official slides provide category names and weights, not detailed scoring descriptors.
The rubric labels its acceptance evidence as a project-internal proof standard so agents do
not misrepresent it as additional organizer guidance.

## Binding requirement register

The tests use these IDs to protect the high-risk rules from disappearing or drifting.
“Binding” means the slide uses language such as *must*, *required*, *may not*, or specifies a
penalty. “Operational” is a fixed event fact the team must plan around. “Recommended” is the
organizer's suggested deck structure, not a mandatory submission condition.

| ID | Level | Requirement | Source slide |
|---|---|---|---|
| TM-SUB-001 | Binding | Submit through Google Classroom by **Thursday, 13 August 2026 at 18.00 WIB**. | 11 |
| TM-SUB-002 | Binding | Submit the presentation deck as **PDF or PPTX**. | 11 |
| TM-SUB-003 | Binding | The cover slide must state the **team name, member names, product name, and logo**. | 11 |
| TM-SUB-004 | Binding | Put the **official RISTEK Hackathon 2026 logo** on the cover slide. | 11 |
| TM-SUB-005 | Binding | Include a direct link to the final product (live website or app). | 11 |
| TM-SUB-006 | Binding | Include a public, accessible GitHub repository link in the slides. | 11 |
| TM-BOOTH-001 | Binding | Arrive on schedule for booth setup and bring the team's own display/demo devices. | 12 |
| TM-BOOTH-002 | Binding | At least **50% of the team** must attend and represent the team at the Innovation Forum; remaining members staff the booth. | 12 |
| TM-PITCH-001 | Binding | On-site participants attend the entire event and notify the committee before leaving. | 13 |
| TM-PITCH-002 | Binding | Dress is formal; shorts, sandals, sleeveless clothing, and clothing with offensive content are prohibited. | 4, 13, 19 |
| TM-PITCH-003 | Operational | Presentation allocation is **2 minutes preparation, 7 minutes presentation, and 3 minutes Q&A**. | 13 |
| TM-PITCH-004 | Operational | A committee timekeeper controls the timer; the bell and MC enforce a hard stop when time expires. | 14 |
| TM-PITCH-005 | Operational | The operator, not the presenting team, shares the submitted deck. | 14 |
| TM-INTEGRITY-001 | Binding | Do not plagiarize, fabricate data or sources, use prohibited third-party involvement, or commit academic misconduct; each carries disqualification. | 18 |
| TM-SCORE-001 | Operational | Final-presentation weights are 15/15/10/30/10/20 and sum to 100%. | 15 |
| TM-SCORE-002 | Operational | Exhibition weights are 20/30/30/20 and sum to 100%. | 16 |
| TM-DAY5-001 | Operational | Participant arrival begins **06.30 on 14 August 2026**; booth preparation begins 07.30. | 9 |
| TM-DAY5-002 | Operational | Innovation Forum runs 09.00–11.00 while exhibition visits run 09.00–12.00. | 9 |
| TM-TEAM-001 | Operational | Team **fam** is assigned manager **Najwa Salsabil** and mentor **I Made Indra**. | 20 |

### Explicit ambiguity boundary

- The slides impose a **−1 point** penalty for an incorrect file naming format, but the
  supplied screenshots do not state the required naming pattern. Confirm the exact pattern
  in Google Classroom or with the team manager before submission; agents must not invent it.
- The slides prohibit unauthorized outside assistance and third-party involvement, but do
  not define the event's AI-assistance policy. Disclose assistance accurately and confirm the
  organizer's interpretation before final submission.
- Slide 4 states the Grand Final event window as 07.30–16.00 WIB; Slide 9 schedules
  participant arrival from 06.30–07.30. Treat 06.30 as the required arrival window before
  the published event programme begins.

## Full normalized transcription

### Slide 1 — Title

**RISTEK Hackathon 2026 — Technical Meeting Presentation**

Source artifact: `Screenshot 2026-08-10 at 12.51.20.png` (local screenshot; Git-ignored)

### Slide 2 — About RISTEK Hackathon 2026

**Description.** RISTEK Hackathon 2026 is a competition organized by RISTEK Fasilkom UI
and the Division of Research, Innovation, Community Engagement, and Academic Partnerships
Fasilkom UI for undergraduate students at Universitas Indonesia. Under the theme “Tech for
Good,” participants build a functional final working product to present at Innovation Week
2026.

**Objective.** The competition aims to provide a platform for undergraduate students to
apply their academic knowledge to real-world challenges. It helps participants develop
end-to-end product development skills while honing their teamwork, problem-solving, and
pitching abilities. Ultimately, it strives to bridge digital innovation with human empathy
and prepare participants to launch their innovations into real startups through UI Incubate.

Source artifact: `Screenshot 2026-08-10 at 12.51.24.png` (local screenshot; Git-ignored)

### Slide 3 — Timeline

| Milestone | Date |
|---|---|
| Grand Finalist Announcement | 9 August 2026 |
| Final Round Technical Briefing | 10 August 2026 |
| Innovation Week Day 1–4 (Mentoring) | 10–13 August 2026 |
| Grand Final Submission Deadline | 13 August 2026, 18.00 WIB |
| Innovation Week Day 5 (Innovation Forum & Exhibition) | 14 August 2026 |
| Final Presentation & Awarding Ceremony | 14 August 2026 |

Source artifact: `Screenshot 2026-08-10 at 12.51.25.png` (local screenshot; Git-ignored)

### Slide 4 — Grand Final

| Field | Detail |
|---|---|
| Day, date | Friday, August 14 2026 |
| Time | 07.30–16.00 WIB |
| Location | Faculty of Computer Science, Universitas Indonesia |
| Google Maps | <https://maps.app.goo.gl/TwklvtSoZiHuNuJW9> |
| Dress code | Formal |
| Permitted | Formal shirt, blazer, formal trousers or skirt, and formal shoes |
| Not permitted | Shorts, sandals, sleeveless clothing, and clothing containing offensive content |
| Needlist | You may bring your own laptop and clicker if necessary |

Source artifact: `Screenshot 2026-08-10 at 12.51.27.png` (local screenshot; Git-ignored)

### Slide 5 — Rundown Day 1 (10 August 2026)

| Time | Agenda |
|---|---|
| 08.30–09.00 | Opening and final round technical briefing |
| 11.00–12.00 | Team discussion |
| 12.00–13.00 | Break |
| 13.00–16.00 | Asynchronous Product Development Session |
| 19.00–Finish | Mentoring Session 1 |

**Target:** Participants grasp the event flow and goals, align with mentors, and kickstart
their product or prototype development.

Source artifact: `Screenshot 2026-08-10 at 12.51.28.png` (local screenshot; Git-ignored)

### Slide 6 — Rundown Day 2 (11 August 2026)

| Time | Agenda |
|---|---|
| 11.00–12.00 | Team discussion |
| 12.00–13.00 | Break |
| 13.00–16.00 | Asynchronous Product Development Session |
| 19.00–Finish | Mentoring Session 2 |

**Target:** Teams refine their solutions based on feedback, show progress from Day 1, and
begin preparing exhibition materials.

Source artifact: `Screenshot 2026-08-10 at 12.51.29.png` (local screenshot; Git-ignored)

### Slide 7 — Rundown Day 3 (12 August 2026)

| Time | Agenda |
|---|---|
| 11.00–12.00 | Team discussion |
| 12.00–13.00 | Break |
| 13.00–16.00 | Asynchronous Product Development Session |
| 19.00–Finish | Mentoring Session 3 |

**Target:** Teams solidify their target user base, refine core product components, and craft
their exhibition narrative.

Source artifact: `Screenshot 2026-08-10 at 12.51.30.png` (local screenshot; Git-ignored)

### Slide 8 — Rundown Day 4 (13 August 2026)

| Time | Agenda |
|---|---|
| 11.00–12.00 | Team discussion |
| 12.00–13.00 | Break |
| 13.00–16.00 | Asynchronous Product Development Session |
| 18.00 | Final Product & Presentation Materials Submission Deadline |
| 19.00–Finish | Mentoring Session 4 |

**Target:** Teams complete their products, finalize all presentation assets, and ensure
readiness for the final showcase.

Source artifact: `Screenshot 2026-08-10 at 12.51.31.png` (local screenshot; Git-ignored)

### Slide 9 — Rundown Day 5 (14 August 2026), part 1

| Time | Agenda |
|---|---|
| 06.30–07.30 | Participant Arrival |
| 07.30–09.00 | Exhibition Preparation |
| 09.00–11.00 | Innovation Forum |
| 09.00–12.00 | Exhibition Visit |
| 12.00–13.00 | Break |
| 13.00–13.25 | Pitching briefing |
| 13.25–13.30 | Team Preparation |
| 13.30–13.40 | Pitching by Team 1 |
| 13.40–13.50 | Pitching by Team 2 |

Source artifact: `Screenshot 2026-08-10 at 12.51.32.png` (local screenshot; Git-ignored)

### Slide 10 — Rundown Day 5 (14 August 2026), part 2

| Time | Agenda |
|---|---|
| 13.50–14.00 | Pitching by Team 3 |
| 14.00–14.10 | Pitching by Team 4 |
| 14.10–14.20 | Pitching by Team 5 |
| 14.20–14.30 | Pitching by Team 6 |
| 14.30–14.40 | Pitching by Team 7 |
| 14.40–14.50 | Pitching by Team 8 |
| 14.50–15.00 | Pitching by Team 9 |
| 15.00–15.10 | Pitching by Team 10 |
| 15.10–15.30 | Judges Deliberation |
| 15.30–16.00 | Awarding & Closing Ceremony |

Source artifact: `Screenshot 2026-08-10 at 12.51.33.png` (local screenshot; Git-ignored)

### Slide 11 — Final Submission Guidelines

**Submission platform**

- Platform: Google Classroom.
- Deadline: Thursday, 13 August 2026 at 18.00 WIB.
- File format: Presentation Deck (PDF or PPTX).

**Presentation slide format**

- Cover page requirement: Must clearly state the Team Name, Member Names, Product Name,
  and Logo on the first / cover slide.
- Official asset: Attach the official logo on the cover slide. Download:
  <https://ristek.link/RISTEKHackathon2026Logo>.
- Final product link: Include direct links to the Final Product (Live Website or App).
- Mandatory GitHub repository link: Must attach a public/accessible GitHub repository link
  in the slides.
- Purpose of the repository link: Used by judges/committee to verify commit history during
  the 4-day hacking period and ensure no unauthorized external code or outside assistance
  was used.

**Recommended slide structure**

- Cover: Team Name, Member Names, & Official Logo.
- Problem & Urgency: Validated user pain points and problem scope.
- Proposed Solution: Core features, value proposition, and alignment with sub-theme.
- Technical Architecture: Tech stack, database, and system data flow.
- Live Product Link / Demo: Direct link to the final product.
- Future Roadmap & Impact: Scaling potential and post-hackathon vision.

Source artifact: `Screenshot 2026-08-10 at 12.51.35.png` (local screenshot; Git-ignored)

### Slide 12 — Exhibition & Innovation Forum Rules

**Preparation & Booth Setup**

- Location: Canteen, Faculty of Computer Science UI.
- All teams must arrive on time according to the schedule to set up their exhibition booth.
- The committee provides 1 table and 2 chairs per team.
- Teams are free to personalize their booth (e.g., adding banners, posters, UI mockups, or
  decorative items).
- Teams are required to bring their own laptops, tablets, or demo devices for display purposes.

**Innovation Forum**

- Location: Ruang Sidang (A.409), 4th Floor, Faculty of Computer Science UI.
- The Innovation Forum is conducted in a seminar-style session.
- Each team must split their members; at least 50% of the team must attend and represent the
  group at the Innovation Forum.

**Team Division & Execution**

- Remaining team members will stay at the booth to handle visitors, present interactive
  demos, and answer judges' questions during the exhibition.
- Teams are encouraged to maintain active engagement across both the exhibition area and
  the Innovation Forum simultaneously.

Source artifact: `Screenshot 2026-08-10 at 12.51.36.png` (local screenshot; Git-ignored)

### Slide 13 — Final Presentation Rules

- Location: Ruang Sidang (A.409), 4th Floor, Faculty of Computer Science UI.
- All participants on-site are expected to attend the entire event, from the exhibition up
  to the awarding session.
- Participants may not leave the room unless for general reasons such as going to the
  restroom. Leaving without notice to the committee is subject to penalties.
- Presentations may be delivered in either English or Bahasa Indonesia. Presenting in
  English earns a bonus point of +1.
- Teams may use clickers, notes, or presentation aids.
- Presentation order will be randomized on the event day.
- All team members may participate in the Q&A session.
- Responses should be concise and supported by evidence whenever possible.
- Judges' decisions are final. Direct or indirect attempts to lobby or influence them
  outside the official evaluation process are strictly prohibited.

**Time allocation:** 2 minutes preparation; 7 minutes presentation; 3 minutes Q&A.

Source artifact: `Screenshot 2026-08-10 at 12.51.37.png` (local screenshot; Git-ignored)

### Slide 14 — Final Pitch Presentation Rules

**Time warnings**

- There will be a timekeeper from the organizing committee.
- A tablet timer will be placed in front of the presenting team.
- Once the timer is up, the bell will ring. The MC will enforce a hard stop, and the
  participant must stop speaking.

**Slide control**

- Screensharing of the deck will come from the operator.

Source artifact: `Screenshot 2026-08-10 at 12.51.38.png` (local screenshot; Git-ignored)

### Slide 15 — Scoring Matrix: Final Presentation

| Scope | Area | Weight |
|---|---|---:|
| Final Product | Problem Identification | 15% |
| Final Product | Solution Alignment | 15% |
| Final Product | Innovation & Uniqueness | 10% |
| Final Product | Technical Execution | 30% |
| Final Product | Design & User Experience | 10% |
| Presentation | Pitching and Q&A Response | 20% |

Source artifact: `Screenshot 2026-08-10 at 12.51.40.png` (local screenshot; Git-ignored)

### Slide 16 — Scoring Matrix: Exhibition

| Area | Weight |
|---|---:|
| Booth & Visual Display | 20% |
| Interactive Demo & Prototype | 30% |
| Communication & Engagement | 30% |
| Product Impact & Innovation | 20% |

Source artifact: `Screenshot 2026-08-10 at 12.51.41.png` (local screenshot; Git-ignored)

### Slide 17 — Penalties: Submission Violations

| Violation | Penalty |
|---|---|
| Incorrect file naming format | −1 point |
| Late submission (<2 hours) | −2 points per 5 minutes |
| Late submission (>=2 hours) | Final Product receives 0 score |
| Changing presentation content after deadline | −5 points |

Source artifact: `Screenshot 2026-08-10 at 12.51.42.png` (local screenshot; Git-ignored)

### Slide 18 — Competition Integrity Violations

| Violation | Penalty |
|---|---|
| Plagiarism or unoriginal work | Disqualification |
| Fabrication of data or sources | Disqualification |
| Third-party involvement in preparing solutions | Disqualification |
| Academic misconduct | Disqualification |

Source artifact: `Screenshot 2026-08-10 at 12.51.43.png` (local screenshot; Git-ignored)

### Slide 19 — Event-Day Violations and Finality Clause

| Violation | Penalty |
|---|---|
| Leaving the venue without notifying the committee | −2 points |
| Failure to comply with dress code | −2 points |
| Excessive presentation time | −1 point per minute |
| Disruptive behavior during competition | Committee discretion |
| Failure to attend assigned presentation slot | Disqualification |

**Finality clause.** All decisions made by the Organizing Committee and Board of Judges are
final, binding, and cannot be appealed. Any situation not explicitly covered in this
handbook shall be resolved at the discretion of the Organizing Committee and Board of Judges.

Source artifact: `Screenshot 2026-08-10 at 12.51.44.png` (local screenshot; Git-ignored)

### Slide 20 — Team Manager Division

After this, each team will be added to their individual WhatsApp group with their respective
Team Manager.

| Team | Manager | Mentor |
|---|---|---|
| SEMUA MUA 😳 YANG AKU MAU 😜 ADA PADAMU 😘 KOK BISA GITU 🤨 A ADUH PUSING KEPALA 🧐 | Sultan Noor Dafiq | Vincent Suryakim |
| fam | Najwa Salsabil | I Made Indra |
| kicau mania | Razan Lesmana | Faatihah Tharra |
| Lefi Calon President RISTEK | Rania Aqila | Mariana Salma |
| ATURLAH | Rakhel Aqeela Hapsari Ariwibowo | Davyn Reinhard |
| PPL Startup Early Access | Najwa Salsabil | Andrew Jeremy |
| GabisaNgoding | Razan Lesmana | Marcellino Chris |
| GrabakGrubuk | Rania Aqila | Bryan Tjandra |
| komcildus | Sultan Noor Dafiq | Marvel Subekti |
| ceo masa depan | Rakhel Aqeela Hapsari Ariwibowo | Jeremy Alva |

Source artifact: `Screenshot 2026-08-10 at 12.51.45.png` (local screenshot; Git-ignored)
