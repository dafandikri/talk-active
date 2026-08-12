import Link from 'next/link';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import mascot from '../../../src/assets/mascot/kato-macaw-reading.svg';
import type { Project } from '@/lib/contracts';

const practiceLoop = [
  ['Project', 'Keep the event, deadline, and rehearsal history together.'],
  ['Rubric', 'Use the criteria the evaluator will actually apply.'],
  ['Attempt', 'Rehearse a complete answer, not an isolated speaking drill.'],
  ['Evidence', 'Inspect the exact transcript span—or the explicit gap—behind each verdict.'],
  ['Defend', 'Answer one question aimed at the weakest remaining claim.'],
] as const;

export function ProductionShell({ project }: Readonly<{ project: Project }>) {
  return (
    <main className="production-shell">
      <nav className="production-shell__nav" aria-label="Primary navigation">
        <Link className="production-shell__brand brand" href="/" aria-label="Talk-Active home">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
        <div className="production-shell__nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#grounded-review">Grounded review</a>
          <a href="#boundaries">Boundaries</a>
          <Link className="production-shell__nav-action" href="/enter">Enter workspace</Link>
        </div>
      </nav>

      <section className="production-shell__hero" aria-labelledby="production-title">
        <div className="production-shell__hero-copy">
          <p className="production-shell__eyebrow"><span aria-hidden="true" /> Rubric-grounded rehearsal</p>
          <h1 className="production-shell__title" id="production-title">
            Rehearse the claim a judge will challenge next.
          </h1>
          <p className="production-shell__lede">
            Bring the real rubric. Practise one complete attempt. Talk-Active maps each verdict
            to your exact words and turns the weakest evidence gap into a focused Q&amp;A drill.
          </p>
          <div className="production-shell__actions">
            <Link className="production-shell__action" href="/enter">
              Start with {project.title} <span aria-hidden="true">→</span>
            </Link>
            <a className="production-shell__secondary-action" href="#grounded-review">
              See an evidence review
            </a>
          </div>
          <p className="production-shell__microcopy">No raw audio is saved. A guest rehearsal can stay in this browser.</p>
        </div>

        <div className="production-shell__demo" id="grounded-review" aria-label="Example rubric evidence review">
          <div className="production-shell__demo-topline">
            <span>Example attempt review</span>
            <span className="production-shell__evidence-engine"><i /> semantic mapping</span>
          </div>
          <p className="production-shell__evidence-criterion">Criterion · Differentiation</p>
          <blockquote>
            “Unlike generic delivery coaches, Talk-Active starts from the evaluator rubric.”
          </blockquote>
          <p className="production-shell__citation">Exact words from the rehearsal transcript</p>
          <div className="production-shell__gap">
            <span>Still implicit</span>
            <strong>Name the closest alternative and the mechanism it lacks.</strong>
          </div>
          <div className="production-shell__question">
            <span aria-hidden="true">Q</span>
            <p>What makes this different from putting the same rubric into a general chat tool?</p>
          </div>
          <img src={mascot.src} alt="" />
        </div>
      </section>

      <section className="production-shell__loop" id="how-it-works" aria-labelledby="loop-title">
        <div className="production-shell__section-intro">
          <p className="production-shell__eyebrow">The differentiating loop</p>
          <h2 id="loop-title">From evaluator criteria to a harder-to-challenge answer.</h2>
          <p>Each stage preserves the evidence behind the next decision, so feedback stays inspectable.</p>
        </div>
        <ol>
          {practiceLoop.map(([title, description], index) => (
            <li className={title === 'Evidence' ? 'production-shell__evidence-step' : undefined} key={title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="production-shell__analysis" aria-labelledby="analysis-title">
        <div>
          <p className="production-shell__eyebrow">How the analysis works</p>
          <h2 id="analysis-title">A language model proposes. Code decides what can be shown.</h2>
          <p>
            When semantic analysis is configured, each criterion is judged separately. A deterministic
            grounding check rejects any citation that cannot be mapped back to the original transcript.
            If the provider is unavailable, the interface labels the deterministic fallback instead of
            silently presenting it as semantic analysis.
          </p>
        </div>
        <ol aria-label="Analysis safeguards">
          <li><span>1</span><strong>One criterion per call</strong><small>Less cross-criterion leakage.</small></li>
          <li><span>2</span><strong>Structured verdict</strong><small>Supported, partial, or unsupported.</small></li>
          <li><span>3</span><strong>Exact-span grounding</strong><small>Only transcript text reaches the evidence card.</small></li>
          <li><span>4</span><strong>Visible provenance</strong><small>Semantic and deterministic results stay distinguishable.</small></li>
        </ol>
      </section>

      <section className="production-shell__use-cases" aria-labelledby="use-cases-title">
        <div className="production-shell__section-intro">
          <p className="production-shell__eyebrow">One method, different high-stakes rooms</p>
          <h2 id="use-cases-title">Practise against the evaluation, not a generic scorecard.</h2>
        </div>
        <div>
          <article><span>01</span><h3>Competition pitch</h3><p>Connect product claims to the scoring rubric before the final Q&amp;A.</p></article>
          <article><span>02</span><h3>Scholarship interview</h3><p>Make each selection criterion explicit in the answer you rehearse.</p></article>
          <article><span>03</span><h3>Thesis defense</h3><p>Find where a method or conclusion still lacks a defensible explanation.</p></article>
        </div>
      </section>

      <section className="production-shell__boundary" id="boundaries" aria-labelledby="boundary-title">
        <div>
          <p className="production-shell__eyebrow">Boundaries stay visible</p>
          <h2 id="boundary-title">Evidence coverage is not confidence or speaking ability.</h2>
        </div>
        <p>
          Talk-Active evaluates what this transcript makes explicit. An optional experimental mode can summarize
          local face or pose landmarks and acoustic measurements, but it does not infer emotion, confidence,
          personality, health, or ability. Those observations remain supporting context and never change a rubric verdict.
        </p>
      </section>

      <section className="production-shell__final" aria-labelledby="final-title">
        <div>
          <p className="production-shell__eyebrow">Bring the hard rubric</p>
          <h2 id="final-title">Know which claim needs work before the room asks.</h2>
        </div>
        <Link className="production-shell__action" href="/enter">Enter the workspace <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="production-shell__footer">
        <Link className="production-shell__brand brand" href="/" aria-label="Talk-Active home">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
        <p>Rubric-grounded rehearsal for answers that need evidence.</p>
      </footer>
    </main>
  );
}
