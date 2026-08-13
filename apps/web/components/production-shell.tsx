import Link from 'next/link';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import mascot from '../../../src/assets/mascot/kato-macaw-reading.svg';
import type { Project } from '@/lib/contracts';

const practiceLoop = [
  ['Create your project', 'Keep the event, deadline, and rehearsal history together.'],
  ['Set up the rubric', 'Use the criteria the evaluator will actually apply.'],
  ['Start speaking', 'Rehearse a complete answer, not an isolated speaking drill.'],
  ['Review your result', 'Inspect the exact transcript span—or the explicit gap—behind each verdict.'],
  ['Defend your idea', 'Answer one question aimed at the weakest remaining claim.'],
] as const;

export function ProductionShell({ project }: Readonly<{ project: Project }>) {
  return (
    <main className="production-shell">
      <header className="production-shell__nav">
        <Link className="production-shell__brand brand" href="/" aria-label="Talk-Active home">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
      </header>

      <section className="production-shell__hero" aria-labelledby="production-title">
        <div className="production-shell__hero-copy">
          <h1 className="production-shell__title" id="production-title">
            Rehearse the claim a judge will challenge next.
          </h1>
          <p className="production-shell__lede">
            Practice your rubric-grounded answer with <b>Katoo</b>, our AI rehearsal coach.
          </p>
          <div className="production-shell__actions">
            <Link className="production-shell__action" href="/enter">
              Start practicing <span aria-hidden="true">→</span>
            </Link>
            <a className="production-shell__secondary-action" href="#how-it-works">
              How it works
            </a>
          </div>
        </div>

        <div
          className="production-shell__demo"
          id="grounded-review"
          aria-label={`Example rubric evidence review for ${project.title}`}
        >
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
          <h2 id="loop-title">How it works</h2>
        </div>
        <ol>
          {practiceLoop.map(([title, description], index) => (
            <li className={title === 'Review your result' ? 'production-shell__evidence-step' : undefined} key={title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="production-shell__use-cases" aria-labelledby="use-cases-title">
        <div className="production-shell__section-intro">
          <h2 id="use-cases-title">One method, different high-stakes scenarios.</h2>
        </div>
        <div>
          <article><h3>Competition pitch</h3><p>Connect product claims to the scoring rubric before the final Q&amp;A.</p></article>
          <article><h3>Scholarship interview</h3><p>Make each selection criterion explicit in the answer you rehearse.</p></article>
          <article><h3>Thesis defense</h3><p>Find where a method or conclusion still lacks a defensible explanation.</p></article>
          <article><h3>and more…</h3><p>Any room where a written rubric decides the outcome.</p></article>
        </div>
      </section>

      <section className="production-shell__final">
        <Link className="production-shell__action" href="/enter">Start practicing now <span aria-hidden="true">→</span></Link>
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
