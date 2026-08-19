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
          <h1 className="production-shell__title" id="production-title">
            {t('titleLine1')}<br /><span className="production-shell__title-accent">{t('titleLine2')}</span>
          </h1>
          {/* The lede states the limit before the promise: no score, no
              speaking-ability rating, just your own sentences. It carried rich
              text around "Kato" until the copy stopped naming him — keeping
              t.rich for a string with no markup left in it would have been a
              tag that renders nothing and a test that asserts nothing. */}
          <p className="production-shell__lede">{t('lede')}</p>
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
          <div className="production-shell__kato">
            <img src={mascot.src} alt="" width={176} height={208} />
          </div>
        </div>
      </section>

      <section className="production-shell__loop" aria-labelledby="loop-title">
        <div className="production-shell__section-intro">
          <h2 id="loop-title">{t('loopTitle')}</h2>
        </div>
        <ol>
          <li><span>1</span><h3>{t('loopStep1Title')}</h3><p>{t('loopStep1Body')}</p></li>
          <li><span>2</span><h3>{t('loopStep2Title')}</h3><p>{t('loopStep2Body')}</p></li>
          <li><span>3</span><h3>{t('loopStep3Title')}</h3><p>{t('loopStep3Body')}</p></li>
          <li className="production-shell__evidence-step"><span>4</span><h3>{t('loopStep4Title')}</h3><p>{t('loopStep4Body')}</p></li>
        </ol>
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
