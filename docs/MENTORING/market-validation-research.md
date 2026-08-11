# Talk-Active — Market & Positioning Validation

**Date:** 2026-08-12 · **Status:** research, adversarial · **Scope:** competitive landscape, defensibility,
market sizing, pricing, GTM, problem evidence
**Sources:** every external claim carries a URL. Statements marked *[inference]* are mine, not sourced.
**Inputs read:** `docs/proposal/body.tex`, `docs/MENTORING/Talk-Active_Grill_Findings.md`,
`docs/specs/2026-08-11-ai-layer.md`

---

## 1. Verdict

The differentiation claim as written in Table 2 of the proposal — that no competitor evaluates
against a user-supplied rubric — **is false, and it is falsifiable in under two minutes by a judge
with a phone.** Yoodli's own documentation says its Custom Goals feature exists to "import your own
rubric," with per-goal weighting; Yoodli published a buyer's guide on 11 August 2026 arguing that a
fixed rubric is a defect and that good feedback must "reference specific moments in the conversation."
That is Talk-Active's pitch, written by the incumbent, one day before finals. Worse, the competitor
table omits the actual competitive set: at least four Indonesian AI thesis-defense simulators
(Sidangin, DOSPEM, SidangAI, Skripsita) and at least five Indonesian AI scholarship-interview
simulators (Terang.ai, Latihan.io, Teman Beasiswa, Cakrawala AI, prepinterview.ai) are live, priced,
and selling to two of the three named personas today. Two of the three personas are contested by
local products the proposal does not mention; the one persona nobody serves — the competition
pitcher — is the smallest and the one with the least willingness to pay. The market sizing survives
scrutiny at the top (PDDikti and LPDP figures check out) but breaks in the middle: the "6.7%
interview pass rate" is not an interview pass rate, and the SAM of ~2.0M is roughly 60% above the
best available graduate-flow figure. Pricing at Rp39k/month is defensible against consumer anchors
but is structurally the wrong *shape* for this market: every local competitor charges per event, per
minute, or per two weeks, because the buyer's need lasts one cycle, not one year. The honest,
defensible position is narrower than the proposal claims and still worth claiming: **the only tool
that makes a specific published evaluator's rubric the primary object, refuses any verdict without a
verbatim transcript span, and does this for Indonesian competition and scholarship contexts.** Say
that. Do not say "no competitor does rubrics."

---

## 2. Findings

### Task 1 — Competitor landscape, current as of August 2026

#### 2.1 The three named incumbents

| Tool | Status | Pricing (verified) | Rubric support |
|---|---|---|---|
| **Yoodli** | Alive and very well funded. $40M Series B announced 2 Dec 2025 (WestBridge Capital, Neotribe, Madrona); ~$60M raised total; 900% revenue growth reported | Free: 5 lifetime sessions. Pro: $8/mo billed annually (10 roleplays/week). Advanced: $20/mo billed annually (unlimited). Team/Enterprise: custom | **Yes — Enterprise.** "Custom goals allow you to import your own rubric" |
| **Orai** | Alive. 450,000+ iOS/Android users claimed | ~$9.99/mo or $39.99/yr per third-party reviews; official page reported as $10/user/mo Pro, Enterprise custom, $200 one-time 4-week program | No evidence of user-supplied rubric found |
| **Poised** | **Acquired by Deepgram, 14 May 2024.** Product still live at poised.com with free trial and a recent Product Hunt banner; Deepgram links in footer | Not published on homepage | No evidence found |

Sources: [Yoodli Series B (GeekWire)](https://www.geekwire.com/2025/ai-roleplay-startup-yoodli-raises-40m-reports-900-revenue-growth/) ·
[Yoodli official Series B post](https://yoodli.ai/blog/yoodli-raises-40-million-series-b-to-lead-the-future-of-experiential-learning) ·
[Yoodli pricing](https://yoodli.ai/pricing) ·
[Orai official site](https://orai.com/) ·
[Orai pricing review](https://www.toolworthy.ai/tool/orai) ·
[Deepgram acquires Poised](https://deepgram.com/learn/deepgram-acquires-poised-elevating-real-time-voice-ai-communication) ·
[poised.com](https://www.poised.com/)

**Listing Poised as a live independent competitor is stale.** It has been a Deepgram asset for over
two years. A judge who knows the space will notice.

#### 2.2 The falsification: Yoodli already does user-supplied rubrics

This is the single most important finding in this document.

Yoodli's own support documentation states, verbatim:

> "As part of an Enterprise organization, you can create custom goals for scenarios. These custom
> goals allow you to **import your own rubric** and better align the feedback Yoodli gives to your
> organization's priorities and training materials."
> — [Custom Goals | Yoodli Support](https://support.yoodli.ai/en/articles/9628254-custom-goals)

Goal types include binary pass/fail ("Mention the agenda"), rated 1–10 for qualitative skills,
compound goals blending several criteria, and knowledge-based goals grounded in an uploaded document.
Admins choose which goals to score on and **how to weight each goal in the rubric**.
— [Creating Custom Goals](https://support.yoodli.ai/en/articles/11556965-creating-custom-goals) ·
[Customizing Practice](https://support.yoodli.ai/en/articles/9628260-customizing-practice)

On **11 August 2026 — one day before this research** — Yoodli published a buyer's framework for AI
roleplay platforms that argues, in substance, Talk-Active's thesis:

> "Scoring and feedback should align to your sales methodology… A fixed rubric produces feedback
> that does not match how your team actually sells."
> "[Strong feedback] reference[s] specific moments in the conversation — not just overall
> performance." Example given: *"You asked three closed-ended questions in the first four minutes.
> That limited how much the prospect shared,"* versus useless feedback like *"your discovery was weak."*
> — [How to Evaluate AI Roleplay Platforms](https://e.yoodli.ai/blog/how-to-evaluate-ai-roleplay-platforms) ·
> [PRNewswire announcement](http://www.prnewswire.com/news-releases/as-ai-roleplay-tools-flood-the-enterprise-yoodli-publishes-a-buyer-first-framework-for-separating-platforms-that-change-behavior-from-tools-that-go-unused-302848640.html)

Yoodli also added **Indonesian** practice support on 3 July 2025:
> "Practice now available in Indonesian, Greek, Latin American Spanish, UK English, Australian
> English, & Canadian French languages."
> — [Yoodli Release Notes](https://support.yoodli.ai/en/articles/9048809-yoodli-release-notes)

**What survives.** Three things I could *not* find in any Yoodli material:
1. No documentation states that Yoodli quotes or cites the **verbatim transcript span** behind a
   criterion verdict. Its release notes contain no mention of transcript citation, and its Custom
   Goals docs describe feedback *types* but never an evidence contract. *[inference: absence of
   documentation is weak evidence of absence — do not claim Yoodli "cannot" do this on stage.]*
2. Custom rubrics are **Enterprise-only**. An Indonesian undergraduate cannot import a rubric at
   $8/month. The consumer tiers are delivery coaching plus roleplay scenarios.
3. Yoodli's rubric framing is entirely **organisation-supplied** (an L&D team defines the rubric for
   its reps). Talk-Active's framing is **individual-supplied** (the student pastes the evaluator's
   published rubric for a one-off event). That is a genuinely different buyer and workflow.

#### 2.3 The competitive set the proposal does not mention: Indonesian direct competitors

Search in Indonesian and the picture changes completely.

**Thesis defense — "the defender" persona. At least four live products.**

| Product | What it does | Pricing (verified from site) |
|---|---|---|
| [**Sidangin**](https://www.sidangin.id/) | Upload thesis PDF; AI examiner generates dynamic follow-up questions on methodology/results/contribution; feedback on answer quality, clarity, confidence; **progress tracking across sessions**; ID/EN/AR/ZH/JA | Free 5 min; Rp19,990 / 10 min; Rp31,980 / 20 min; Rp74,950 / 50 min. GoPay, OVO, DANA, QRIS |
| [**DOSPEM**](https://www.dospem.id/fitur/simulasi-sidang) | Five sequential defense rounds (foundations, theory, methodology, results, panel); per-answer scored feedback; ships **"grounding gate, contradiction check, and critical weakness tracking"**; "Sidang Ready" verdict when no critical weakness remains | Free tier; Rp39,000 / 2 weeks; Rp129,000 / 2 weeks (incl. 3x exam simulation) — [pricing](https://www.dospem.id/harga) |
| [**SidangAI**](https://sidangah.meowlabs.id/) | Voice-call examiner personas, question bank | Free |
| [**Skripsita**](https://www.skripsita.com/en/simulasi-sidang-skripsi) | 5 AI lecturer personas, "trained to mimic Indonesian lecturers' questioning style" | Not checked |

**DOSPEM is the closest thing to a direct architectural competitor found anywhere.** "Grounding
gate" and "critical weakness tracking" are, on their face, the same two mechanisms as
`spanIsGrounded()` and the recurring-weakness view in `docs/specs/2026-08-11-ai-layer.md`. It also
serves the whole thesis workflow (drafting, references, PPT generation, humanizer), so the defense
simulator is a retention feature attached to a product students already pay for. *[inference: I could
not verify from public pages whether DOSPEM's grounding gate enforces a verbatim span the way the
Talk-Active spec does. Treat it as a claimed capability, not a proven one.]*

**Scholarship / job interview — "the applicant" persona. At least five live products.**

| Product | Notes | Pricing |
|---|---|---|
| [**Terang.ai**](https://terang.ai/ai-interview-lpdp) | Self-described "#1 LPDP interview simulator in Indonesia"; natural-voice ID + EN; also targets Chevening, Fulbright, CPNS, UTBK | Not published on the pages fetched |
| [**Latihan.io**](https://www.latihan.io/) | AI interviewer for scholarships (LPDP, Chevening), internships, jobs; per-answer structured feedback | **Rp100,000/interview standard; Rp25,000 promo; Rp50,000 signup credit** |
| [**Teman Beasiswa**](https://www.temanbeasiswa.id/) | AI interview simulation + essay review "designed by scholarship awardees" | Not checked |
| [**Cakrawala AI**](https://interview.cakrawala.ai/products/Vw1BViHufy42NJSCvzWY) | 15-minute LPDP interview format | Not checked |
| [**prepinterview.ai**](https://prepinterview.ai/products/28) | "Beasiswa LPDP (Bahasa Indonesia)" product | Not checked |
| [**terusmengudara.id**](https://interview.terusmengudara.id/) | ID/EN scholarship interview practice | Not checked |

**Competition pitching — "the competitor" persona (the declared beachhead). No Indonesian AI product
found.** The nearest global analogue is [PitchDesk](https://pitchdesk.in/features/ai-pitch-simulator)
— AI VC judges that ask tough questions, with a score, transcript, and progress tracking — but its
pages do not offer user-supplied judging criteria. *[inference: this is a real, defensible gap, and
it is the one segment the proposal already names as beachhead. Lead with it.]*

**Adjacent: rubric graders already normal in edtech.** [CoGrader](https://cograder.com/ai-grading/),
[EduSageAI](https://www.edusageai.com/blogs/best-ai-rubric-checker-tools-for-teachers-in-2026),
[GPTZero AI Reviewer](https://gptzero.me/ai-reviewer), [RubriCheck](https://rubricheck.com/), and
[Rubric AI](https://www.rubricai.app/) all let a user upload an arbitrary rubric and return
per-criterion comments. They grade **written work for teachers**, not spoken rehearsal for students —
but "paste your rubric, get per-criterion feedback" is a commodity interaction in 2026, not a novel
one. Any judge from an edtech background knows this.

---

### Task 2 — Is the differentiation defensible?

**Short answer: not as an architecture claim. Partly, as a market-position claim. Barely, as a moat.**

The proposal's callout says the rubric-as-primary-key design "is why it is hard to clone by adding a
feature to a delivery coach." Test that against evidence:

- **Yoodli already shipped it** for enterprise buyers (§2.2). It did not require re-architecting into
  a rubric-primary system; it was added as "Custom Goals" attached to scenarios. So the empirical
  answer to "can a delivery coach bolt on rubrics?" is: yes, and one already has.
- **Per-criterion grading against an arbitrary uploaded rubric is a solved, commoditised LLM pattern**
  in written-assessment edtech (five vendors listed above).
- **A local competitor already claims the mechanism.** DOSPEM's public feature list names a "grounding
  gate" and "critical weakness tracking."

What is actually hard to copy, ranked by how much I believe it:

1. **The refusal contract, if you can demonstrate it live.** "A verdict with no verbatim span is
   discarded by application code, not discouraged in a prompt" (`ai-layer.md` §4, P1/P3) is a product
   *commitment* that costs a vendor conversion — it makes the tool say "I don't know" more often.
   Incumbents optimising for engagement rarely ship it. This is defensible not because it is
   technically hard but because it is **commercially unattractive to a growth-stage competitor.**
   That is a better argument than "hard to build," and it is one you can prove on stage in ten
   seconds by showing a rejected verdict. *[inference]*
2. **Indonesian evaluation-context knowledge.** LPDP's three-component substance selection, thesis
   examination form structure, PKM assessment formats, and code-mixed ID/EN speech. The grill session
   already relocated the moat here (locked decision #5) and that was the right call. But note the
   caveat in §5 below: the local competitors *already have* this context, so it separates you from
   Yoodli, not from Sidangin or Terang.ai.
3. **Rubric-as-primary-key architecture: weakest of the three.** It is a good design decision and it
   makes the product coherent. It is not a moat. Do not build the pitch on it.

**Recommendation.** Rewrite the differentiation callout from *"no one else does rubrics"* to
*"everyone else's rubric is the organisation's; ours is the evaluator's, and we will not return a
verdict we cannot quote."* The first sentence is false and checkable. The second is true and
demonstrable.

---

### Task 3 — Market sizing sanity check

#### What verifies

- **Total higher-education enrolment 9,949,502; S1 8,281,591; D3 543,693; S2 379,666; profesi 341,879**
  (PDDikti, 2025). Verified via
  [GoodStats Data — Jumlah Mahasiswa S1 Tembus 8,2 Juta Tahun 2025](https://data.goodstats.id/statistic/jumlah-mahasiswa-s1-tembus-82-juta-tahun-2025-Y7SPD).
  Primary source is the [Buku Statistik Pendidikan Tinggi 2025](https://kemdiktisaintek.go.id/library/book/statistik-pendidikan-tinggi-2025)
  (data snapshot December 2025). **The proposal's headline numbers are correct.**
- **LPDP applicant growth: 25,329 (2022) → 33,396 (2023) → 52,839 (2024) → ~78,000 (2025).** Verified via
  [Kompas — Penerima LPDP 2025 Dibatasi Hanya 4.000 Orang dari 78.000 Pendaftar](https://nasional.kompas.com/read/2025/09/18/07364041/penerima-lpdp-2025-dibatasi-hanya-4000-orang-dari-78000-pendaftar).
  **The proposal's growth claim is correct and conservative.**
- **LPDP Tahap 2 2025: 37,459 registrants, 2,511 passed substance selection.** Verified against the
  primary source: [LPDP Sambut 2.511 Peserta Lolos Seleksi Substansi Tahap 2 Tahun 2025](https://lpdp.kemenkeu.go.id/informasi/berita/lpdp-sambut-2511-peserta-lolos-seleksi-substansi-tahap-2-tahun-2025/).
  The numbers are right. **The interpretation is not** — see below.

#### What does not verify

**A. "An interview-stage pass rate near 6.7%" is not an interview-stage pass rate.**
2,511 ÷ 37,459 = 6.70%, but 37,459 is the number who **registered** for Tahap 2. Between registration
and the interview sit administrative selection and the 120-minute scholastic aptitude test (SBS, held
15–25 September 2025, results 2 October 2025). LPDP does not publish how many candidates reached
seleksi substansi, and I could not find that figure in any source. So 6.7% is the **end-to-end
registration-to-award rate**, and the true interview conversion rate is necessarily *higher* —
possibly much higher. At least one preparation vendor claims 40–50% pass at the substance stage
([jadibeasiswa.id](https://jadibeasiswa.id/bagaimana-seleksi-substansi-lpdp/) — commercial source,
treat as unreliable, but it is exactly what a judge would find). **Risk: a judge who does the
arithmetic finds you attributed a whole-funnel rate to one stage to make the interview look decisive.**
Fix: say "roughly 5% of LPDP applicants receive an award (4,000 of ~78,000 in 2025)" — same emotional
weight, verified against Kompas, and unattackable.

**B. SAM ~2.0M is above the best available graduate-flow number.**
The grill session locked SAM at ~2.07M by dividing 8.28M undergraduates by a four-year programme.
PDDikti's own reported output is **~1.26 million sarjana graduates per year**, reported via
[Kemdiktisaintek](https://kemdiktisaintek.go.id/news/article/wamendiktisaintek-dorong-lulusan-kampus-untuk-persiapkan-diri-hadapi-tantangan-masa-depan)
*(article returned HTTP 403 to direct fetch; figure taken from the search index snippet — **verify
this number from the PDF before putting it on a slide**)*. The gap is real and expected: median
time-to-degree in Indonesia exceeds four years and attrition is non-trivial, so enrolment ÷ 4
overstates the graduating cohort by roughly 60%. **A judge does not need to know that to sense the
problem; they only need to ask "how many students graduate each year?"**
Fix: state SAM as ~1.26M final-year students in an active defense cycle. It is smaller, it is
sourced, and it removes an attack surface for nothing you actually lose.

**C. The beachhead is far smaller than the proposal implies.**
PKM 2025 — the flagship national student competition, and the archetypal published-rubric event —
funded **1,590 proposals involving 7,171 students**, with Rp11.2 billion allocated
([Media Indonesia](https://mediaindonesia.com/humaniora/824506/direktorat-belmawa-catat-ada-1590-proposal-pkm-yang-didanai-dan-melibatkan-7171-mahasiswa) ·
[Jabar Ekspres](https://jabarekspres.com/berita/2025/10/28/pkp2-pkm-2025-ditutup-1-590-proposal-didanai-7-171-mahasiswa-unjuk-kreativitas-di-beragam-bidang-ilmu/)).
I could not find the total number of proposals **submitted** in 2025 in any public source, so the
addressable competitor pool is genuinely unknown — but the funded, rubric-defended cohort is
~7,000 students nationally. *[inference: the competitor persona is the right beachhead for
credibility and for demo narrative, and the wrong one for volume. Own that explicitly rather than
letting a judge find it.]*

**D. SOM 60,000 depends on an unstated assumption that is now more fragile.**
The grill locked SOM at 60,000 driven by 10–15 partner campuses. That assumption now competes with
DOSPEM's claimed presence across "50+ universities including UI, UGM, ITB, IPB"
([dospem.id](https://www.dospem.id/)). Partner-campus expansion is not a blank field.

#### Overall verdict on sizing

Top-line enrolment: **verified, keep.** LPDP growth: **verified, keep, it is your strongest number.**
SAM: **inflated ~60%, fix downward to ~1.26M.** 6.7%: **misattributed to the wrong funnel stage,
replace with the ~5% award rate.** SOM 60,000: **unverifiable either way — it is a plan, not a
measurement, and should be labelled as such on the slide.**

---

### Task 4 — Pricing validation

#### Consumer anchors (Indonesia, 2026)

| Service | Price | Source |
|---|---|---|
| Spotify Premium Standard | Rp59,900/mo (student Rp29,900/mo) | [Kompas Tekno, Jul 2026](https://tekno.kompas.com/read/2026/07/28/14350057/daftar-harga-paket-spotify-terbaru-di-indonesia-per-juli-2026) |
| Netflix Mobile / Basic | Rp54,000 / Rp65,000 per month | [Kompas Tekno, Jul 2026](https://tekno.kompas.com/read/2026/07/29/15350077/harga-langganan-netflix-per-juli-2026-di-indonesia-mulai-rp-50-ribuan-) |
| Ruangguru learning packages | from ~Rp300,000 per package | [ruangguru.com](https://www.ruangguru.com/blog/informasi-produk-ruangguru-yang-jadi-unggulan) |

**Rp39,000/month sits below the Spotify standard tier and just above the Spotify student tier. As a
price point in isolation, it is realistic.**

#### Competitor anchors, converted

At an assumed **Rp16,000–16,500/USD** *(FX rate assumed, not verified)*:

- Yoodli Pro $8/mo ≈ **Rp128k–132k/mo**; Advanced $20/mo ≈ **Rp320k–330k/mo**
- Orai ~$10/mo ≈ **Rp160k–165k/mo**

Talk-Active Pro at Rp39k is **~3.3× cheaper than the cheapest incumbent tier**. That is a real
positioning advantage and it is honest to state.

#### The anchor that matters most: what the applicant persona already pays

A **jadibeasiswa.id** LPDP package listed at **Rp1,200,000 (discounted Rp905,000)** for five months,
including materials, 1× 1-on-1 essay guidance, and **3× 1-on-1 mock interviews**
([app.jadibeasiswa.id/paket](https://app.jadibeasiswa.id/paket)).
**Latihan.io charges Rp100,000 per interview** (Rp25,000 promotional)
([latihan.io](https://www.latihan.io/)).

Against that, Rp39,000/month for unlimited analysed sessions is not merely acceptable — it may be
**materially underpriced for the applicant persona**, and it is the tier the grill session already
identified as the actual revenue driver (locked decision #7). *[inference: this is the strongest
pricing argument available and it is currently not in the proposal at all.]*

#### The structural problem: the *shape* is wrong, not the number

Every Indonesian competitor in this exact niche prices per consumption, not per month:

- Sidangin: per minute (Rp19,990 / 10 min … Rp74,950 / 50 min)
- Latihan.io: per interview (Rp25k–100k)
- DOSPEM: per **two weeks** (Rp39,000 / Rp129,000)

This is not a coincidence. Indonesia is characterised as a **high-volume, low-ARPU market (0.7×
pricing index) where "weekly plans, lower price points, and Android-first distribution are the right
strategies"** ([Adapty, 2026](https://adapty.io/blog/fastest-growing-app-markets-2026/)).
And the proposal's own persona definition says the need lasts **four to eight weeks** (§2.2). A
monthly recurring subscription sold against a one-off event has a built-in churn cliff at month two,
which is exactly the mechanism the grill session flagged in locked decision #7 and then accepted.

**Recommendation.** Keep Rp39,000 as the number and change the unit: sell an **"Event Pass" — one
project, unlimited analysed sessions, 30 days, Rp39,000**, with an optional Rp99,000 season pass for
applicants running parallel applications. Same headline price, no churn story to defend, and it
matches how DOSPEM, Sidangin, and Latihan.io have all independently converged. Note the coincidence a
judge may spot: **DOSPEM charges Rp39,000 for two weeks.** Being at the same number for a longer
window is a good look; being at the same number by accident is not — know the comparison.

#### Campus tier

The grill locked cost-plus math arriving at Rp25–40M and flagged the Rp50M ceiling as unjustified.
Against institutional software procurement, the tier is **cheap, not expensive**: a Turnitin
institutional licence is quoted by an Indonesian reseller at **USD 9,783 for 200 users for one year
≈ Rp140M** ([plagiarism.web.id](https://plagiarism.web.id/turnitin/harga-resmi-turnitin/) — commercial
reseller, low reliability, treat as indicative only). I could not find an LPSE tender line item to
confirm this independently. *[inference: Rp25–50M/year per faculty is defensible and possibly
conservative; the risk on this tier is not price, it is procurement cycle length and the fact that
you have zero institutional references.]*

---

### Task 5 — The unresolved grill finding: beachhead vs. revenue driver

**The misalignment is real and the research makes it worse, then offers a way out.**

Worse, because: the applicant persona — the one that pays — is the **most contested** segment in
Indonesia (six live AI competitors found, §2.3) *and* the persona for whom the "the rubric is already
public" premise is weakest. LPDP's substance selection is publicly described as three components
(essay on the spot, Leaderless Group Discussion, individual interview) with a reported maximum of
1,500 points, but **every description I found came from preparation vendors, not from LPDP itself**
([jadibeasiswa.id](https://jadibeasiswa.id/panduan-seleksi-substansi-lpdp/)). LPDP does not publish an
interview scoring rubric. Grill locked decision #4 scoped v1 to "explicitly public rubrics" and
assumed that covered the applicant persona. **It does not.** For LPDP you would be parsing a
community-reconstructed rubric, which is a materially different and weaker claim.

A way out, because: the applicant channels are unusually reachable, concentrated, and free.

| Channel | Reach | Source |
|---|---|---|
| @indbeasiswa (Instagram) | **746K followers** | [instagram.com/indbeasiswa](https://www.instagram.com/indbeasiswa/) |
| @pejuangbeasiswalpdp (Instagram) | **152K followers** | [instagram.com/pejuangbeasiswalpdp](https://www.instagram.com/pejuangbeasiswalpdp/) |
| @telering.id — Telegram Beasiswa LPDP (Unofficial) | 11K IG followers fronting a Telegram community | [instagram.com/telering.id](https://www.instagram.com/telering.id/) |
| @schoters.id, @beasiswakuliah, LPDP campus communities (e.g. @lpdp.monash.indonesia) | listed among the standard scholarship-info channels | [EKSAM — 7 Platform untuk Cari Info Beasiswa](https://eksam.id/blog/7-platform-untuk-cari-info-beasiswa-terbaru-jangan-sampai-ketinggalan/) |

**Recommendation — resolve the open item as follows.**

1. **Keep the competitor as beachhead #1 and say why out loud.** It is the only segment with *no*
   Indonesian AI incumbent, the only one where the rubric is genuinely published verbatim (competition
   guidebooks), and the one you can demo with the RISTEK guidebook itself. That is a credibility
   beachhead, not a revenue beachhead, and calling it that is a strength on stage.
2. **Run a separate, earlier applicant motion — but for a rubric that is actually public.** Do not
   lead with LPDP interviews, where the rubric is reconstructed and six competitors already sit.
   Lead with **published scholarship criteria that are genuinely documents**: Chevening's published
   selection criteria, Australia Awards, and LPDP's *essay/study-plan* requirements (which are
   published), rather than the unpublished interview scoring. Then move to the interview once you
   have the essay users.
3. **Acquisition motion: one partnership, not paid ads.** A single content collaboration with
   @indbeasiswa or @pejuangbeasiswalpdp reaches more of this persona than the entire UI student-org
   network. Offer them the product free for their community during an LPDP cycle in exchange for
   distribution. Zero CAC, and it is exactly the "communities already gather in organised groups"
   argument §6.1 already makes but never operationalises.
4. **Fix Table 1's ordering to match.** Rank the competitor #1 as *acquisition and proof*, the
   applicant #2 as *revenue*, and the defender #3 as *deferred pending institutional access* (which
   grill decision #4 already established, and which §2.3 shows is the most crowded segment anyway).
   The current ordering invites exactly the question the mentor asked.

---

### Task 6 — Problem-statement evidence

#### The "81% report speaking anxiety" citation is the single most fragile claim in the proposal

Verified details of the source (`educasia2024`):

> **Halimah & Nuraida**, "Exploring Public Speaking Anxiety among the First-Year College Students in
> West Java Indonesia," *Educasia: Jurnal Pendidikan, Pengajaran, dan Pembelajaran* **10(1), 83–94**
> — [educasia.or.id](https://educasia.or.id/index.php/educasia/article/view/300) ·
> [PDF](https://educasia.or.id/index.php/educasia/article/download/300/131)
>
> - **n = 27** (21 female, 6 male), ages 18–19
> - **One private university**, Faculty of Teacher Training and Education, **Cianjur, West Java**
> - Academic year 2023/2024, PRPSA (McCroskey 2009), 34 items, 5-point Likert
> - Findings: 18% high, 63% moderate, 19% low

**A 27-student single-faculty convenience sample at one private university is being used to
characterise 9.9 million students.** The proposal's own INV-1 says every external fact must be
traceable to a source; it is traceable, and that is precisely the problem — the trace ends somewhere
a judge can dismiss in one sentence. The second citation (`leea2023`, 53.33% high) is **n = 60**
psychology students and has the same defect.

Better-powered Indonesian evidence found, still small but stronger:

- **n = 288** English Language Education students: 56.8% moderate, 18.3% high, 24.9% low.
- **n = 51**, fourth-semester public speaking class, Kediri; FLCAS (Horwitz et al.); published
  *Journal on English as a Foreign Language* 15(2), September 2025, 785–805 —
  [JEFL 9982](https://e-journal.iain-palangkaraya.ac.id/index.php/jefl/article/view/9982)
- **Cross-national (Indonesia + Bangladesh)**, *Current Psychology* (Springer, 2025),
  [10.1007/s12144-025-08433-3](https://link.springer.com/article/10.1007/s12144-025-08433-3) —
  paywalled; I could not retrieve sample size or findings. **Worth 10 minutes of a team member's time
  via UI library access**; a Springer-indexed cross-national study is a far better citation than a
  local journal with n=27.

**Recommendation:** demote the anxiety statistic from a headline to a supporting line, or cite the
n=288 study instead. Better still — see below — replace it with a structural statistic that no judge
can wave away.

#### The 6.7% LPDP figure

Covered in Task 3A. Numerator and denominator verify; the **stage attribution does not**. Replace.

#### Stronger evidence the deck does not currently use

**1. Graduate unemployment is *higher* than for less-educated Indonesians (BPS).**
As of November 2025, 7.35 million Indonesians were unemployed. Open unemployment rate by education:

| Education level | Open unemployment rate (Nov 2025) |
|---|---|
| SMK | 8.45% |
| SMA | 6.55% |
| **S1/S2/S3** | **5.38%** |
| Diploma I/II/III | 4.22% |
| SMP | 3.76% |
| SD and below | 2.29% |

— [Detik EDU, citing BPS, 5 Feb 2026](https://www.detik.com/edu/detikpedia/d-8341899/bps-7-35-juta-orang-ri-menganggur-lulusan-smk-atau-sarjana-yang-terbanyak)
(February 2025 university-graduate figure was 5.25% —
[Liputan6](https://www.liputan6.com/bisnis/read/6035469/sarjana-menganggur-ini-fakta-mengejutkan-dari-data-bps-2025)).

**Why this is the better problem slide:** a degree-holder is *more* likely to be unemployed than
someone who finished only junior high. That is a selection-and-signalling failure, not a knowledge
failure, and it points directly at the interview and the defense — the moments where a qualified
person fails to demonstrate it. It is BPS data, it is national, and no judge will dispute it.

**2. The LPDP funnel, stated correctly.**
78,000 applicants in 2025 against a cap of **4,000 recipients — roughly 5%** — up from 25,329
applicants in 2022. Applicants tripled in three years while the award cap was *reduced*
([Kompas](https://nasional.kompas.com/read/2025/09/18/07364041/penerima-lpdp-2025-dibatasi-hanya-4000-orang-dari-78000-pendaftar) ·
[Kompas — Kuota Dikurangi padahal Pendaftar Bertambah](https://www.kompas.com/edu/read/2025/10/02/124357871/kuota-beasiswa-lpdp-dikurangi-padahal-pendaftar-bertambah-kenapa)).
**Competition intensity rising and capacity falling** is a stronger, cleaner story than a
misattributed stage rate.

**3. Higher education is expanding into a market that cannot absorb it.**
Gross participation rate (APK) for higher education reached 32.89%, and 11% of the Indonesian
population has completed tertiary education as of 2025
([GoodStats](https://goodstats.id/article/lulusan-perguruan-tinggi-ri-terus-bertambah-tembus-11-pada-2025-QJFFO)).
Roughly 1.26 million sarjana graduate each year *(verify from the PDDikti PDF before use)*. More
graduates, same number of seats, harder selection.

**4. A real, checkable case study is available and free — use PKM.**
PKM 2025: **1,590 proposals funded, 7,171 students, Rp11.2 billion**, with national assessors scoring
presentations across 21 concurrent online rooms over five days, and a published assessment guide
([Media Indonesia](https://mediaindonesia.com/humaniora/824506/direktorat-belmawa-catat-ada-1590-proposal-pkm-yang-didanai-dan-melibatkan-7171-mahasiswa) ·
[Panduan Umum PKM 2025 PDF](https://cdn.undiksha.ac.id/wp-content/uploads/2025/08/14124543/Panduan-Program-Kreativitas-Mahasiswa-Tahun-2025.pdf)).
The mentor asked for a case study. **PKM is the case study**: a national, government-run, published-rubric,
oral-defense competition with thousands of students and a rubric anyone can download. Load the PKM
assessment guide into Talk-Active on stage next to the RISTEK guidebook. That is a case study *and* a
demo *and* a beachhead, in one move.

**5. Employability tracer data exists but is thin.** Reported figures include ~3.9 months average
waiting time to first job (2023–2025 tracer studies) and >60% of 2023 graduates working outside their
field ([validnews.id](https://validnews.id/opini/lulusan-bekerja-tak-sesuai-jurusan-cerminan-pendidikan-tinggi-indonesia)).
*[inference: these came from an opinion piece aggregating tracer studies; I did not verify against a
primary tracer-study report. Do not put them on a slide without tracing them.]*

---

## 3. Claims in the proposal that would not survive a skeptical judge

Ranked by risk = (probability a judge checks) × (damage if they do).

| # | Claim | Where | Why it fails | Fix |
|---|---|---|---|---|
| **1** | "Claims cited to a criterion: **No** / **No** / **No**" and "The evaluator's rubric" as a uniquely-ours primary input | Table 2, §3.2 | **False.** Yoodli Custom Goals: "allow you to import your own rubric," with per-goal weighting. Yoodli published a rubric-customisation buyer's guide on 11 Aug 2026. One search falsifies it | Re-scope to: rubric is *organisation*-supplied elsewhere, *evaluator*-supplied here; and no competitor documents a verbatim-span refusal contract |
| **2** | Competitive set = Yoodli, Orai, Poised | Table 2 | Omits ≥4 Indonesian thesis-defense simulators and ≥6 Indonesian scholarship-interview simulators, all live and priced. A local judge finds them instantly by searching in Indonesian. Also, Poised has been a Deepgram asset since May 2024 | Add a second table: "Indonesian direct competitors." Naming them and stating why you still win is *stronger* than omitting them |
| **3** | "an interview-stage pass rate near 6.7%" | §2.1 | 37,459 is Tahap 2 **registrations**, not interview attendees. Admin and scholastic stages sit in between. LPDP never publishes the substansi entry count. The true interview rate is higher | "~5% of LPDP applicants receive an award: 4,000 of ~78,000 in 2025" (Kompas). Same weight, unattackable |
| **4** | "63% moderate and 18% high… so 81% of the cohort was affected" | §2.1 | Sample is **n = 27**, one private university's education faculty in Cianjur. Second citation is n = 60 | Demote to supporting, cite the n=288 study, and lead the problem slide with BPS graduate-unemployment data instead |
| **5** | "it is an architecture in which the rubric, not the audio, is the primary key. That is why it is hard to clone" | §3.2 callout | An incumbent already cloned it as a feature, without re-architecting. The claim invites "so what stops Yoodli shipping this next quarter?" and the honest answer is "nothing technical" | Move the moat argument to the refusal contract and Indonesian evaluation context, as grill decision #5 already directed. Delete "hard to clone" |
| **6** | SAM ~2.0M | Fig. 6 / §6.1 | Derived as enrolment ÷ 4. PDDikti's reported annual graduate output is ~1.26M. Overstated ~60% by a question a judge asks in five words: "how many graduate per year?" | Restate SAM as ~1.26M. Losing 0.8M costs nothing and removes an attack |
| **7** | "Indonesian evaluation context: Yoodli **Limited**" | Table 2 | Yoodli added Indonesian practice on 3 July 2025. The *context* claim is still defensible; the row as phrased reads as a language claim and is checkable | Rename the row "Indonesian **evaluation** context (LPDP / thesis / PKM formats)" so it says what you actually mean |
| **8** | Rp39,000/month subscription | Table 5 | Every local competitor sells per event / per minute / per two weeks; the persona's need is 4–8 weeks; Indonesia is a 0.7× ARPU market where weekly and low price points win. Grill decision #7 accepted the weak upgrade forcing function without fixing the unit | Keep the number, change the unit to a 30-day Event Pass. Add the bimbel comparison (Rp905k–1.2M) — it makes Rp39k look like a bargain rather than an unproven subscription |
| **9** | "Because rubrics are institution-specific, a global competitor cannot replicate that library from outside Indonesia" | §8 | True of a *global* competitor, irrelevant to DOSPEM (claims 50+ Indonesian universities), Sidangin, or Terang.ai. Grill decision #5 already retired the library-as-moat claim; §8 still contains it | Delete or rewrite to name the actual local competitive threat |
| **10** | "explicitly public rubrics… covers the competitor and applicant personas" | Grill decision #4 | LPDP publishes selection *components*, not an interview scoring rubric. Every description of the substansi rubric traces to preparation vendors | Scope the applicant persona v1 to genuinely published criteria (Chevening, Australia Awards, LPDP essay/study-plan requirements), not the interview rubric |

---

## 4. Concrete additions to strengthen the deck

Slide-ready, each with a citation the team can drop into a footnote.

**Problem slide — replace the anxiety headline with this.**
> In November 2025, 7.35 million Indonesians were unemployed. The open unemployment rate for
> university graduates was **5.38%** — higher than for those who finished only junior high (3.76%)
> or primary school (2.29%).
> *Source: BPS, via [Detik EDU, 5 Feb 2026](https://www.detik.com/edu/detikpedia/d-8341899/bps-7-35-juta-orang-ri-menganggur-lulusan-smk-atau-sarjana-yang-terbanyak)*
>
> The failure is not knowledge. It is the moment you have to prove it.

**Problem slide, second beat — the funnel, stated correctly.**
> LPDP applicants: 25,329 (2022) → 33,396 (2023) → 52,839 (2024) → **~78,000 (2025)**.
> 2025 recipient cap: **4,000**. Roughly **1 in 20**.
> *Source: [Kompas, 18 Sep 2025](https://nasional.kompas.com/read/2025/09/18/07364041/penerima-lpdp-2025-dibatasi-hanya-4000-orang-dari-78000-pendaftar)*
>
> Applicants tripled in three years. The quota was cut.
> *Source: [Kompas, 2 Oct 2025](https://www.kompas.com/edu/read/2025/10/02/124357871/kuota-beasiswa-lpdp-dikurangi-padahal-pendaftar-bertambah-kenapa)*

**Problem slide, third beat — the verified LPDP stage figure, used honestly.**
> LPDP Tahap 2, 2025: **37,459 registered. 2,511 received an award.**
> *Source: [LPDP official, 8 Dec 2025](https://lpdp.kemenkeu.go.id/informasi/berita/lpdp-sambut-2511-peserta-lolos-seleksi-substansi-tahap-2-tahun-2025/)*
> (Do **not** call this an interview pass rate.)

**Market slide — corrected.**
> TAM: **9,949,502** students in Indonesian higher education; **8,281,591** undergraduates (PDDikti, Dec 2025).
> *Source: [GoodStats / PDDikti](https://data.goodstats.id/statistic/jumlah-mahasiswa-s1-tembus-82-juta-tahun-2025-Y7SPD)*
> SAM: **~1.26M** students graduating each year, each facing a rubric-scored defense.
> *(verify the 1.26M figure against the [Buku Statistik Pendidikan Tinggi 2025](https://kemdiktisaintek.go.id/library/book/statistik-pendidikan-tinggi-2025) PDF before use)*
> SOM: 60,000 — **labelled as a three-year plan assuming 10–15 partner campuses**, not a measurement.

**Case-study slide — PKM as proof the category exists at national scale.**
> PKM 2025: **1,590 funded proposals · 7,171 students · Rp11.2 billion**, assessed by national panels
> across 21 concurrent online rooms over five days — against a rubric published in the
> [Panduan Umum PKM 2025](https://cdn.undiksha.ac.id/wp-content/uploads/2025/08/14124543/Panduan-Program-Kreativitas-Mahasiswa-Tahun-2025.pdf).
> *Source: [Media Indonesia, Oct 2025](https://mediaindonesia.com/humaniora/824506/direktorat-belmawa-catat-ada-1590-proposal-pkm-yang-didanai-dan-melibatkan-7171-mahasiswa)*
>
> Demo move: load the PKM rubric live, beside the RISTEK guidebook.

**Competitor slide — add a second table and win by naming them.**
> **Global delivery coaches:** Yoodli ($40M Series B, Dec 2025 · $8–20/mo · rubric import on
> **Enterprise only** · Indonesian added Jul 2025), Orai (~$10/mo, 450k users), Poised (acquired by
> Deepgram, May 2024).
> **Indonesian AI rehearsal tools:** Sidangin (thesis, Rp19,990/10 min), DOSPEM (thesis, Rp39k/2 weeks),
> Terang.ai and Latihan.io (scholarship interviews, Rp25k–100k per interview).
> **Competition pitching against a published rubric: nobody.**
> *Sources: [Yoodli Custom Goals](https://support.yoodli.ai/en/articles/9628254-custom-goals) ·
> [Yoodli pricing](https://yoodli.ai/pricing) · [Deepgram/Poised](https://deepgram.com/learn/deepgram-acquires-poised-elevating-real-time-voice-ai-communication) ·
> [Sidangin](https://www.sidangin.id/) · [DOSPEM pricing](https://www.dospem.id/harga) ·
> [Latihan.io](https://www.latihan.io/) · [Terang.ai](https://terang.ai/ai-interview-lpdp)*

**Differentiation slide — the sentence to replace the "hard to clone" callout.**
> Everyone who does rubrics does the **organisation's** rubric, sold to the organisation.
> We do the **evaluator's** rubric, given to the student.
> And we are the only one that discards a verdict it cannot quote — enforced in application code,
> not in a prompt. *(demonstrate live: show a rejected verdict.)*

**Pricing slide — the anchor that reframes Rp39k as cheap.**
> An LPDP preparation package with 3× one-on-one mock interviews: **Rp905,000–1,200,000**.
> *Source: [jadibeasiswa.id](https://app.jadibeasiswa.id/paket)*
> Latihan.io: **Rp100,000 per interview**. *Source: [latihan.io](https://www.latihan.io/)*
> Yoodli Pro: **$8/month ≈ Rp130,000**. *Source: [yoodli.ai/pricing](https://yoodli.ai/pricing)*
> Talk-Active: **Rp39,000, 30 days, unlimited analysed sessions.**

**Go-to-market slide — name the channel, with its size.**
> @indbeasiswa: **746,000 followers**. @pejuangbeasiswalpdp: **152,000**. Plus @schoters.id,
> @beasiswakuliah, and unofficial LPDP Telegram communities.
> One community partnership during an LPDP cycle reaches more applicants than every student
> organisation at UI combined.
> *Sources: [@indbeasiswa](https://www.instagram.com/indbeasiswa/) ·
> [@pejuangbeasiswalpdp](https://www.instagram.com/pejuangbeasiswalpdp/) ·
> [EKSAM channel roundup](https://eksam.id/blog/7-platform-untuk-cari-info-beasiswa-terbaru-jangan-sampai-ketinggalan/)*

---

## 5. Things I could not verify — do not assert these

- **~1.26M annual sarjana graduates.** Appears in the search index attributed to Kemdiktisaintek/PDDikti;
  the article returned HTTP 403 and the statistics PDF exceeded the fetch size limit. **Pull the number
  from the PDF by hand before it goes on a slide.**
- **How many candidates actually reached LPDP seleksi substansi in 2025.** Not published by LPDP; not
  found anywhere credible. This is why the 6.7% stage attribution cannot be defended.
- **Total PKM proposals submitted (as opposed to funded) in 2025.** Not found in public sources.
- **Whether Yoodli's feedback cites verbatim transcript spans.** No documentation says it does; no
  documentation says it doesn't. Its Aug 2026 buyer's guide praises "reference[ing] specific moments,"
  which suggests intent. **Do not claim on stage that Yoodli cannot cite evidence.** Claim only that
  Talk-Active enforces it as a hard rejection rule.
- **Whether DOSPEM's "grounding gate" enforces verbatim spans** the way `ai-layer.md` §4 does. Claimed
  on their feature page; mechanism not documented.
- **Turnitin's actual institutional price in Indonesia.** The USD 9,783 / 200 users figure is from a
  commercial reseller blog, not a tender document or Turnitin itself.
- **Terang.ai, Teman Beasiswa, Cakrawala AI, prepinterview.ai pricing and traction.** Pages fetched
  returned little content; existence is confirmed, commercial scale is not.
- **USD→IDR conversions in §Task 4** assume Rp16,000–16,500/USD. I did not verify the spot rate.
