import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <main className="production-shell production-not-found">
      <section className="production-shell__hero" aria-labelledby="notFoundTitle">
        <p className="production-shell__eyebrow">{t('title')}</p>
        <h1 className="production-shell__title" id="notFoundTitle">
          This route is not part of the rehearsal workspace.
        </h1>
        <p className="production-shell__lede">
          Return to Talk-Active to open a project, review its rubric, or practise an attempt.
        </p>
        <div className="production-shell__actions">
          <Link className="production-shell__action" href="/">{t('back')}</Link>
        </div>
      </section>
    </main>
  );
}
