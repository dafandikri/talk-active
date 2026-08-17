import Link from 'next/link';
import { useTranslations } from 'next-intl';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import mascot from '../../../src/assets/mascot/kato-macaw-reading.svg';
import type { Project } from '@/lib/contracts';

export function ProductionShell({ project }: Readonly<{ project: Project }>) {
  const t = useTranslations('landing');
  return (
    <main className="production-shell">
      <header className="production-shell__nav">
        <Link className="production-shell__brand brand" href="/" aria-label={t('homeLabel')}>
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
      </header>

      <section className="production-shell__hero" aria-labelledby="production-title">
        <div className="production-shell__hero-copy">
          <h1 className="production-shell__title" id="production-title">{t('title')}</h1>
          {/* "rubric-grounded" twice in one sentence, and the second half only
              restated the first. One naming of Kato, one claim, no repetition.
              The emphasis on Kato is carried as rich text rather than by
              splitting the sentence, because word order differs between the
              two locales and a split sentence cannot survive that. */}
          <p className="production-shell__lede">
            {t.rich('lede', { b: (chunks) => <b>{chunks}</b> })}
          </p>
          <div className="production-shell__actions">
            <Link className="production-shell__action" href="/enter">
              {t('start')} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <div
          className="production-shell__demo"
          id="grounded-review"
          aria-label={t('demoLabel', { title: project.title })}
        >
          <div className="production-shell__demo-topline">
            <span>{t('demoTopline')}</span>
            <span className="production-shell__evidence-engine"><i /> {t('demoEngine')}</span>
          </div>
          <p className="production-shell__evidence-criterion">{t('demoCriterion')}</p>
          <blockquote>{t('demoQuote')}</blockquote>
          <p className="production-shell__citation">{t('demoCitation')}</p>
          <div className="production-shell__gap">
            <span>{t('demoGapLabel')}</span>
            <strong>{t('demoGap')}</strong>
          </div>
          <div className="production-shell__question">
            <span aria-hidden="true">Q</span>
            <p>{t('demoQuestion')}</p>
          </div>
          <img src={mascot.src} alt="" />
        </div>
      </section>

      <section className="production-shell__use-cases" aria-labelledby="use-cases-title">
        <div className="production-shell__section-intro">
          <h2 id="use-cases-title">{t('useCasesTitle')}</h2>
        </div>
        <div>
          <article><h3>{t('useCase1Title')}</h3><p>{t('useCase1Body')}</p></article>
          <article><h3>{t('useCase2Title')}</h3><p>{t('useCase2Body')}</p></article>
          <article><h3>{t('useCase3Title')}</h3><p>{t('useCase3Body')}</p></article>
          <article><h3>{t('useCase4Title')}</h3><p>{t('useCase4Body')}</p></article>
        </div>
      </section>

      <section className="production-shell__final">
        <Link className="production-shell__action" href="/enter">{t('startNow')} <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="production-shell__footer">
        <Link className="production-shell__brand brand" href="/" aria-label={t('homeLabel')}>
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
        <p>{t('footerTagline')}</p>
      </footer>
    </main>
  );
}
