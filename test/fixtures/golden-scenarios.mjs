// ============================================================================
//  The behaviour the rewrite has to reproduce.
//
//  These are inputs, not expectations. scripts/capture-golden.mjs runs them
//  through the current analyzer and records what it produces into
//  golden-path.json; test/golden-path.test.mjs then replays them and fails on
//  any difference.
//
//  The point is that "did the TypeScript port change the behaviour?" stops
//  being a matter of opinion. Add a scenario whenever you find an input whose
//  handling you would not want to lose — that is cheaper than discovering it
//  after the migration.
//
//  Written for the students this is actually for: Indonesian, English, and the
//  code-mixed register a real pitch is delivered in.
// ============================================================================

export const ANALYSIS_SCENARIOS = [
  {
    id: 'demo-path',
    description: 'The seeded draft against the default rubric — the exact path a judge watches.',
    transcript: 'Many Indonesian students prepare important presentations alone and only receive feedback after the result is final. Talk-Active lets a student use the actual evaluation rubric while practicing a pitch. It maps each claim in the transcript to a criterion, points out what is still unsupported, and asks a judge-style follow-up question about the weakest claim. The student then retries one focused section and sees whether the evidence improved. The current implementation uses local transcript analysis, so no recording is stored.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps\nDifferentiation | unlike, competitor, existing tools, instead\nFeasibility | implementation, local, cost, timeline',
    durationSeconds: 90,
  },
  {
    id: 'every-criterion-supported',
    description: 'A pitch that names every cue. Coverage should be complete and the weakest pick still deterministic.',
    transcript: 'The problem is that students rehearse alone and the evidence shows urgency: eight in ten report no feedback before the real evaluation. Our solution maps every claim in the transcript to a rubric criterion. Unlike existing tools and every competitor we found, we start from the evaluator rubric instead of a generic delivery score. On feasibility, the implementation is local, the cost is near zero, and the timeline is four days.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps\nDifferentiation | unlike, competitor, existing tools, instead\nFeasibility | implementation, local, cost, timeline',
    durationSeconds: 75,
  },
  {
    id: 'nothing-supported',
    description: 'An on-topic pitch that supports nothing. Every criterion must report its missing cues rather than a vague low score.',
    transcript: 'Thank you all for being here today. I am really excited to share what we have been working on for the last few weeks. We think it is going to be very useful for a lot of people, and we are proud of how far it has come in such a short time. We hope you enjoy the demonstration and we look forward to your questions at the end of the session.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps\nDifferentiation | unlike, competitor, existing tools, instead\nFeasibility | implementation, local, cost, timeline',
    durationSeconds: 60,
  },
  {
    id: 'bahasa-indonesia',
    description: 'A wholly Indonesian pitch against an Indonesian rubric — the primary audience, not an edge case.',
    transcript: 'Masalahnya adalah banyak mahasiswa berlatih presentasi sendirian dan baru menerima umpan balik setelah hasilnya keluar. Bukti dari survei kami menunjukkan hal ini mendesak. Solusi kami memetakan setiap klaim dalam transkrip ke kriteria penilaian yang sebenarnya. Implementasinya berjalan lokal sehingga biayanya rendah.',
    rubricText: 'Kejelasan masalah | masalah, mahasiswa, bukti, mendesak\nKesesuaian solusi | kriteria, transkrip, memetakan, klaim\nDiferensiasi | tidak seperti, pesaing, alat lain\nKelayakan | implementasi, lokal, biaya, waktu',
    durationSeconds: 55,
  },
  {
    id: 'code-mixed',
    description: 'The register a real Indonesian pitch is delivered in. Cue matching must survive the switch mid-sentence.',
    transcript: 'Jadi the problem is mahasiswa latihan sendirian, dan evidence-nya cukup jelas dari survey kami. Our solution memetakan setiap claim ke rubric criterion yang dipakai juri. Unlike existing tools yang cuma ngukur delivery, kami mulai dari rubrik. Untuk feasibility, implementation-nya local jadi cost-nya kecil.',
    rubricText: 'Problem clarity | problem, mahasiswa, evidence, urgency\nSolution fit | rubric, criterion, claim, memetakan\nDifferentiation | unlike, existing tools, pesaing\nFeasibility | implementation, local, cost, waktu',
    durationSeconds: 50,
  },
  {
    id: 'heavy-fillers',
    description: 'Filler-dense delivery. The filler list is user-visible, so its exact contents are worth pinning.',
    transcript: 'So um, the problem is that, like, students basically rehearse alone you know, and um the evidence is, like, actually pretty clear about the urgency. Our solution um maps each claim to a criterion in the transcript, so, like, you know exactly what is missing basically.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps',
    durationSeconds: 45,
  },
  {
    id: 'rushed-pace',
    description: 'Many words in little time. The pace label is a delivery claim and must not drift.',
    transcript: 'The problem is urgent and students everywhere face it daily with clear evidence behind every part of the claim we are making here today. Our solution maps the transcript to each rubric criterion quickly and precisely. Unlike every competitor and the existing tools in this space we begin from the rubric instead. Feasibility is proven because the implementation is local, the cost is small, and the timeline is short.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps\nDifferentiation | unlike, competitor, existing tools, instead\nFeasibility | implementation, local, cost, timeline',
    durationSeconds: 20,
  },
  {
    id: 'slow-pace',
    description: 'Few words over a long duration — the other end of the pace scale.',
    transcript: 'The problem is that students rehearse alone. The evidence is clear and the urgency is real. Our solution maps each claim to a criterion.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps',
    durationSeconds: 300,
  },
  {
    id: 'single-criterion',
    description: 'A one-line rubric. The weakest-criterion pick has no alternatives to rank against.',
    transcript: 'The problem is that students rehearse alone and the evidence for the urgency of this is strong across every campus we visited this year.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency',
    durationSeconds: 30,
  },
  {
    id: 'many-criteria',
    description: 'A wide rubric closer to a real scoring matrix than the demo default.',
    transcript: 'Our problem is well evidenced among students and the urgency is documented. The solution maps every claim in the transcript to a criterion. Unlike existing tools we begin from the rubric. The implementation is local so cost stays low. The team has shipped before and the market in Indonesia is large. Our traction includes a pilot cohort.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps\nDifferentiation | unlike, existing tools, instead\nFeasibility | implementation, local, cost\nTeam | team, shipped, experience\nMarket | market, Indonesia, large\nTraction | traction, pilot, cohort',
    durationSeconds: 100,
  },
  {
    id: 'duplicate-cues-across-criteria',
    description: 'The same word serves two criteria. Records how a shared cue is attributed today.',
    transcript: 'The rubric is the centre of the product: the rubric defines the criterion, and the criterion drives the question the rubric implies.',
    rubricText: 'Rubric grounding | rubric, criterion\nQuestion quality | rubric, question',
    durationSeconds: 25,
  },
  {
    id: 'typographic-punctuation',
    description: 'Smart quotes, en dashes, and non-breaking spaces — what a paste from Word or Google Docs actually contains.',
    transcript: 'The problem — and it’s a real one — is that students rehearse alone. “Evidence” of the urgency is everywhere. Our solution maps each claim to a criterion in the transcript.',
    rubricText: 'Problem clarity | problem, students, evidence, urgency\nSolution fit | rubric, criterion, transcript, maps',
    durationSeconds: 40,
  },
];

export const DEFENSE_SCENARIOS = [
  {
    id: 'defense-fully-supported',
    description: 'An answer that names every missing cue.',
    answer: 'Unlike existing tools such as delivery coaches, and unlike every competitor we surveyed, Talk-Active starts from the evaluator rubric instead of a generic score.',
    criterion: { id: 'differentiation', label: 'Differentiation', signals: ['unlike', 'competitor', 'existing tools', 'instead'] },
  },
  {
    id: 'defense-partial',
    description: 'An answer that lands some cues and misses others.',
    answer: 'We are unlike the existing tools in this space.',
    criterion: { id: 'differentiation', label: 'Differentiation', signals: ['unlike', 'competitor', 'existing tools', 'instead'] },
  },
  {
    id: 'defense-none',
    description: 'A fluent answer that supports nothing — the case a delivery-only tool would score well.',
    answer: 'That is a great question and something we have thought about a lot as a team over the past few weeks.',
    criterion: { id: 'differentiation', label: 'Differentiation', signals: ['unlike', 'competitor', 'existing tools', 'instead'] },
  },
];

// Inputs that must fail loudly rather than return a wrong answer quietly (INV-7).
export const ERROR_SCENARIOS = [
  { id: 'empty-transcript', input: { transcript: '   ', rubricText: 'A | a', durationSeconds: 30 } },
  { id: 'empty-rubric', input: { transcript: 'A real transcript with enough words in it to analyse.', rubricText: '   ', durationSeconds: 30 } },
  { id: 'zero-duration', input: { transcript: 'A real transcript with enough words in it to analyse.', rubricText: 'A | a', durationSeconds: 0 } },
  { id: 'negative-duration', input: { transcript: 'A real transcript with enough words in it to analyse.', rubricText: 'A | a', durationSeconds: -5 } },
  { id: 'non-numeric-duration', input: { transcript: 'A real transcript with enough words in it to analyse.', rubricText: 'A | a', durationSeconds: 'ninety' } },
];
