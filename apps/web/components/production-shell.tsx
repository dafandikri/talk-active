import Link from 'next/link';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import type { Project } from '@/lib/contracts';

export function ProductionShell({ project }: Readonly<{ project: Project }>) {
  return (
    <main className="production-shell">
      <nav className="production-shell__nav" aria-label="Primary navigation">
        {/* The landing had lost its mark in the port and shipped a bare text
            link. The visual system is frozen, so the lockup is restored here in
            the same shape the workspace uses. */}
        <Link className="production-shell__brand brand" href="/" aria-label="Talk-Active home">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
        <Link href="/workspace">Open workspace</Link>
      </nav>

      <section className="production-shell__hero" aria-labelledby="production-title">
        <p className="production-shell__eyebrow">Rubric-grounded rehearsal</p>
        <h1 className="production-shell__title" id="production-title">
          Practise the evidence your evaluator expects.
        </h1>
        <p className="production-shell__lede">
          Bring a real rubric, rehearse one attempt, inspect the exact sentence behind each
          verdict, then answer the hardest remaining question.
        </p>
        <div className="production-shell__actions">
          <Link className="production-shell__action" href="/workspace">
            Continue {project.title}
          </Link>
        </div>
        <p className="production-shell__boundary">
          Evidence coverage is formative feedback, not confidence or speaking ability.
          The production migration keeps deterministic cue matching available while the
          grounded semantic pipeline is evaluated criterion by criterion.
        </p>
      </section>

      <section className="production-shell__status" aria-label="Migration safeguards">
        <article>
          <h2>One contract</h2>
          <p>Frontend fixtures and route handlers validate the same schemas.</p>
        </article>
        <article>
          <h2>Cited verdicts</h2>
          <p>Support must point to a transcript span; gaps name what is missing.</p>
        </article>
        <article>
          <h2>Safe cutover</h2>
          <p>The working vanilla product stays live until the complete loop reaches parity.</p>
        </article>
      </section>
    </main>
  );
}
