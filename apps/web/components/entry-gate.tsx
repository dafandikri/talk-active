'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo-stacked.svg';
import mascot from '../../../src/assets/mascot/kato-macaw-questioning.svg';
import { normaliseDisplayName, writeGuestIdentity } from '@/lib/guest-identity';

export function EntryGate() {
  const t = useTranslations('entryGate');
  const router = useRouter();
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function enter(name: string | null): void {
    if (name) writeGuestIdentity({ name, email: null });
    router.push('/workspace');
  }

  function submitGuest(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    const name = normaliseDisplayName(guestName);
    if (!name) {
      setError(t('nameRequired'));
      return;
    }
    enter(name);
  }

  return (
    <main className="entry-gate">
      <section className="entry-panel" aria-labelledby="entry-title">
        <Link className="entry-brand" href="/" aria-label={t('homeLabel')}>
          <img src={logo.src} alt="Talk-Active" />
        </Link>
        <Link className="entry-back" href="/">{t('back')}</Link>

        <p className="entry-kicker">{t('kicker')}</p>
        <h1 className="entry-title" id="entry-title">{t('title')}</h1>
        <p className="entry-intro">{t('intro')}</p>

        <form className="entry-guest" onSubmit={submitGuest}>
          <label className="entry-field" htmlFor="guestName">
            <span>{t('nameLabel')}</span>
            <input
              id="guestName"
              autoComplete="name"
              maxLength={40}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder={t('namePlaceholder')}
              type="text"
              value={guestName}
            />
          </label>
          <button className="button button-primary button-full" type="submit">
            {t('submit')} <span aria-hidden="true">→</span>
          </button>
        </form>

        {error ? <p className="entry-error" role="alert">{error}</p> : null}

        <p className="entry-skip">
          <button className="text-button" type="button" onClick={() => enter(null)}>{t('skip')}</button>
        </p>

        <div className="entry-sync">
          <div>
            <strong>{t('syncTitle')}</strong>
            <p>{t('syncBody')}</p>
          </div>
          <Link className="button button-secondary" href="/account">{t('syncAction')}</Link>
        </div>
      </section>

      <aside className="entry-aside" aria-label={t('asideLabel')}>
        <div className="entry-aside-copy">
          <span>{t('asideKicker')}</span>
          <p>{t('asideQuote')}</p>
          <small>{t('asideAttribution')}</small>
        </div>
        <img src={mascot.src} alt="" />
        <ul>
          <li>{t('asidePoint1')}</li>
          <li>{t('asidePoint2')}</li>
          <li>{t('asidePoint3')}</li>
        </ul>
      </aside>
    </main>
  );
}
