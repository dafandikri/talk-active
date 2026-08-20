import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <main className="production-shell production-not-found">
      <section className="production-shell__hero" aria-labelledby="notFoundTitle">
        <p className="production-shell__eyebrow">{t('title')}</p>
        <h1 className="production-shell__title" id="notFoundTitle">{t('heading')}</h1>
        <p className="production-shell__lede">{t('body')}</p>
        <div className="production-shell__actions">
          <Link className="production-shell__action" href="/">{t('back')}</Link>
        </div>
      </section>
    </main>
  );
}
