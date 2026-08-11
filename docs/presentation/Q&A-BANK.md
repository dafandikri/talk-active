# Talk-Active — finals judge Q&A bank

Use each answer as a **20–35 second spine**, not a paragraph to memorise. Lead with the answer, then point to the named evidence. Never improvise a number.

## Product and differentiation

### 1. “Yoodli already supports custom rubrics. What is different?”

Yes—Yoodli’s Enterprise Custom Goals can import an organisation’s scorecard or rubric. Talk-Active is narrower: an Indonesian student loads the evaluator’s published rubric, and a supporting verdict is discarded unless it can quote the student’s transcript. Our differentiator is the student/evaluator context plus the refusal contract, not the existence of rubric import.

**Evidence:** [Yoodli Custom Goals](https://support.yoodli.ai/en/articles/11556965-creating-custom-goals); `src/semantic.mjs` grounding validator.

### 2. “DOSPEM and other Indonesian tools already rehearse defenses. Why Talk-Active?”

We do not claim the defense or scholarship segments are empty. Our beachhead is competition pitching, where the published judging rubric is the primary input. DOSPEM proves that Indonesian students will use focused rehearsal; Talk-Active’s observable distinction is criterion-by-criterion transcript evidence and the next judge question.

**Evidence:** [`docs/specs/2026-08-12-positioning.md`](../specs/2026-08-12-positioning.md); [`docs/MENTORING/market-validation-research.md`](../MENTORING/market-validation-research.md).

### 3. “What stops Yoodli from adding this next sprint?”

Nothing technical makes us uncopyable, and we should not pretend otherwise. Our near-term advantage is execution speed, Indonesian evaluation-context knowledge, and a product contract that prefers refusing a verdict over showing unsupported feedback. The durable advantage has to be earned through rubric partnerships and measured outcome data.

**Evidence:** positioning decision and roadmap in [`docs/MENTORING/Talk-Active_Grill_Findings.md`](../MENTORING/Talk-Active_Grill_Findings.md).

### 4. “Why is this not just a prompt wrapper?”

Because the critical behavior is enforced in code, not requested in a prompt. The server validates the response schema, checks every quoted span against the transcript, discards invalid rows, keeps per-criterion provenance, caches only successful semantic results, and falls back to a pure deterministic analyzer.

**Evidence:** `src/semantic.mjs`, `api/analyze.mjs`, and semantic/API tests.

### 5. “Why not just use ChatGPT with the rubric?”

A general chat can produce useful advice, but it does not guarantee the rehearsal workflow or the refusal contract. Talk-Active persists a project, maps each criterion, exposes the supporting transcript span or missing cues, selects the hardest next question, saves progress, and visibly degrades when semantic analysis is unavailable.

**Evidence:** the live judge path and `scripts/demo-gate.mjs`.

### 6. “What is the single innovation?”

The evidence-to-defense handoff. Every criterion verdict must point to the student’s words or list the missing evidence; the weakest criterion then becomes the next judge question. The innovation is observable in the loop, not a claim that the model is uniquely intelligent.

**Evidence:** live Review and Defend screens.

## Accuracy, AI, and failure

### 7. “How do you stop the model from hallucinating quotes?”

The model is not trusted to verify itself. Server code normalises both strings and checks that the proposed span exists in the original transcript. An ungrounded supporting row is discarded; if the semantic pass cannot ground evidence, the product falls back instead of presenting the claim.

**Evidence:** `spanIsGrounded` and semantic fallback tests in `src/semantic.mjs` and `test/semantic.test.mjs`.

### 8. “Can the model still misunderstand a real quote?”

Yes. The current validator proves that the quote exists, not that every semantic interpretation is correct. That boundary is why we call the result evidence coverage, not a confidence or ability score. A measured human-labelled evaluation set is post-hackathon work.

**Evidence:** product boundary in the review screen and target architecture.

### 9. “Why use AI at all if deterministic matching works?”

Deterministic matching is reliable but literal; it misses paraphrases. Semantic mapping can recognise equivalent evidence even when the student does not repeat rubric keywords. We keep deterministic analysis because availability is more important than hiding the limitation.

**Evidence:** semantic/deterministic comparison fixtures and visible provenance labels.

### 10. “What happens if the API fails during the demo?”

The request has a total server budget, and the client visibly switches to the deterministic analyzer. The same rubric, evidence cards, hardest-question flow, save, and reload path still complete. We also cache the rehearsed semantic request so a repeated stage demo returns without a new model call.

**Evidence:** `scripts/demo-gate.mjs`; cached and degraded API tests.

### 11. “Does offline mode still work?”

Yes for the differentiating product loop. The static product and deterministic analyzer have no external runtime dependency, and the demo gate covers practice, analysis, defense, save, and reload without a model response. Semantic mapping is an enhancement, not a dependency.

**Evidence:** demo-gate no-external-dependencies and offline stages.

### 12. “How accurate is rubric import?”

We do not yet claim an accuracy percentage. The shipped importer structures a pasted scoring matrix into editable criteria, and the user confirms the result before practice. A labelled test set and a predeclared accuracy threshold are roadmap items, not current evidence.

**Evidence:** rubric import screen, tests, and roadmap.

### 13. “How accurate is Indonesian speech-to-text?”

We have not benchmarked speech-to-text accuracy, so we do not claim a number. Browser dictation is optional convenience; pasted text is always available and is the controlled finals path. A production speech pipeline would need consent and a measured Indonesian/code-mixed benchmark.

**Evidence:** practice interface and explicit product boundary.

## Privacy and security

### 14. “Do you store students’ audio?”

No raw audio is persisted in this build. Projects, rubric text, transcripts, and progress stay on the device. A production audio feature would require explicit consent, retention expiry, and deletion before rollout.

**Evidence:** current browser-only persistence and privacy statement in the product/deck.

### 15. “Where is the AI key?”

Only in the Vercel Function environment. The browser calls `/api/analyze`; it never receives the AI Gateway credential. The route also limits payload size, returns typed errors, and uses security headers.

**Evidence:** `api/analyze.mjs`, `vercel.json`, and deployment security tests.

### 16. “Can someone abuse the public API and drain your credit?”

The production route is rate-limited per client, the AI Gateway key itself has a five-dollar hard budget with no refresh, and cached repeated inputs avoid new model spend. If the budget is exhausted, the product still completes locally in deterministic mode.

**Evidence:** production firewall verification, Gateway budget settings, and fallback path.

### 17. “Can a malicious rubric inject code?”

Rubrics and transcripts are treated as text, never markup. The interface uses text rendering rather than `innerHTML`, and the invariant suite rejects unsafe DOM APIs. The Content Security Policy also blocks external scripts and objects.

**Evidence:** INV-5 tests and `vercel.json` CSP.

## Cost and business model

### 18. “What does one analysis cost?”

On the current primary model, a short attempt is estimated at about $0.0027 and a seven-minute, ten-criterion attempt at about $0.006. A typical run is roughly $0.004. This is token-based planning math, not a guaranteed invoice, so the production account also has a hard cap.

**Evidence:** worked estimate in [`docs/MENTORING/ai-layer-research.md`](../MENTORING/ai-layer-research.md) and current model chain in `src/semantic.mjs`.

### 19. “Why is the hackathon AI budget only $5?”

At the typical $0.004 estimate, five dollars covers roughly 1,250 analyses—far beyond the event requirement. A larger balance would not improve the demo but would increase abuse exposure. Alerts at 50, 75, and 100 percent provide an early stop signal.

**Evidence:** Gateway hard-budget configuration and slide 9 cost model.

### 20. “Your proposal says Rp900–1,800 per session. Why is today’s call cheaper?”

Today’s build performs one evidence-mapping call, estimated around Rp45–99 at the planning exchange rate used in our research. The proposal number is a deliberately conservative upper bound for a future full pipeline: stronger rubric parsing, question generation, transcription, retry headroom, and price movement. We would rather over-budget the cost line than discover it.

**Evidence:** full cost breakdown in [`docs/MENTORING/ai-layer-research.md`](../MENTORING/ai-layer-research.md).

### 21. “Why Rp39,000?”

We keep the number but price it as a 30-day Event Pass, not an indefinite subscription. The need arrives around a specific competition, defense, or application, and Indonesian competitors also use event-length units. The free path proves the loop; the pass is for a concentrated period of repeated analysis.

**Evidence:** pricing correction in [`docs/specs/2026-08-12-positioning.md`](../specs/2026-08-12-positioning.md).

### 22. “Who pays first?”

Competition communities are the acquisition beachhead because published rubrics are accessible and the segment is underserved. The higher-frequency revenue persona is the applicant, reached separately through scholarship communities. Campus licensing is later and requires institutional evidence, not a finals-stage assumption.

**Evidence:** beachhead decision in the positioning correction and grill findings.

### 23. “How large is the market?”

We will not defend the proposal’s old two-million SAM; the review found it overstated. The safer annual graduate base is around 1.26 million and still requires primary-source verification before use on stage. For the finals pitch we focus on the beachhead and the working product, not a fragile top-down number.

**Evidence:** [`docs/specs/2026-08-12-positioning.md`](../specs/2026-08-12-positioning.md). Do not add the number to the spoken pitch until verified against PDDikti.

## Impact, validation, and scope

### 24. “Where does the 81% speaking-anxiety claim come from?”

It came from a study of only 27 students at one private university faculty, so it is not strong enough for our headline and we retired it. We lead with national BPS context and the observable product problem instead. If asked, we disclose the sample size rather than defend a weak generalisation.

**Evidence:** source audit in [`docs/MENTORING/market-validation-research.md`](../MENTORING/market-validation-research.md).

### 25. “Is the LPDP interview pass rate really 6.7%?”

No. That denominator was Tahap 2 registrations, not interview attendees, so calling it an interview-stage rate was wrong and we retired the claim. The defensible end-to-end figure is roughly 4,000 awards from 78,000 applicants in 2025, but it is not needed in this pitch.

**Evidence:** source correction in the positioning report.

### 26. “What validation do you have with real users?”

We have product and reliability validation, not outcome validation. The build is production-deployed and the full judge path is automated, but we do not yet claim student improvement. The next evidence step is a ten-student pilot with predeclared measures and human review of criterion coverage.

**Evidence:** validation report and slide 10 roadmap.

### 27. “What is explicitly out of scope?”

Body-language scoring, generic speaking drills, streaks, institutional dashboards, and numeric ability or confidence scores. Private thesis rubrics are also deferred until institutional access and consent exist. The narrow scope protects the evidence loop and the live demo.

**Evidence:** active Innovation Week plan and project invariants.

### 28. “What is your post-hackathon priority?”

Measurement before more features: a labelled dataset of attempts and human-reviewed criterion verdicts, then a ten-student pilot to test whether evidence coverage improves over repeated rehearsal. Consent, expiry, and deletion controls come before any persisted audio workflow.

**Evidence:** slide 10 roadmap and target architecture.

## Team, integrity, and event execution

### 29. “Was this really built during the four-day sprint?”

The public repository and commit history are included in the submitted slides for committee review. We disclose assistance through the required originality statement and will confirm the organiser’s AI-assistance interpretation rather than inventing a policy. The product claims only capabilities present in the submission state.

**Evidence:** public repository link, originality statement, and technical-meeting integrity rules.

### 30. “Why should we trust the demo?”

Because the exact judge path is executable as a gate: cold start, rubric import, practice, semantic or deterministic analysis, evidence inspection, defense, save, reload, kiosk reset, and 390-pixel mobile use. The latest submission state passes more than 150 tests, 18 real-browser checks, and 16 demo stages with zero console errors.

**Evidence:** `pnpm check` and `scripts/demo-gate.mjs` on the submission state.

### 31. “What remains unproven today?”

Real-user outcome improvement, rubric-import accuracy, Indonesian speech benchmark quality, institutional willingness to pay, and production retention controls. Those are stated roadmap items. The shipped claim is narrower: the product completes a rubric-grounded, traceable rehearsal loop and survives semantic failure.

**Evidence:** finals readiness ledger and slide 10 boundary.

## Mentor-question log

Add every new mentoring and booth question before the final rehearsal. Never delete a difficult question; improve the answer and attach evidence.

| Date | Asked by | Exact question | Answer owner | Evidence added | Rehearsed |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
