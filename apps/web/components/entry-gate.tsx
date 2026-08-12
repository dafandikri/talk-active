'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo-stacked.svg';
import mascot from '../../../src/assets/mascot/kato-macaw-questioning.svg';
import { normaliseDisplayName, writeGuestIdentity } from '@/lib/guest-identity';

export function EntryGate() {
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
      setError('Type the name you want on this workspace.');
      return;
    }
    enter(name);
  }

  return (
    <main className="entry-gate">
      <section className="entry-panel" aria-labelledby="entry-title">
        <Link className="entry-brand" href="/" aria-label="Talk-Active home">
          <img src={logo.src} alt="Talk-Active" />
        </Link>

        <p className="entry-kicker">Guest rehearsal</p>
        <h1 className="entry-title" id="entry-title">Put your name on this workspace.</h1>
        <p className="entry-intro">
          Start immediately without creating an account. Your display name and guest rehearsal history
          stay in this browser unless you deliberately use the synced account option.
        </p>

        <form className="entry-guest" onSubmit={submitGuest}>
          <label className="entry-field" htmlFor="guestName">
            <span>Your name</span>
            <input
              id="guestName"
              autoComplete="name"
              maxLength={40}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Sari Wulandari"
              type="text"
              value={guestName}
            />
          </label>
          <button className="button button-primary button-full" type="submit">
            Enter the workspace <span aria-hidden="true">→</span>
          </button>
        </form>

        {error ? <p className="entry-error" role="alert">{error}</p> : null}

        <p className="entry-skip">
          <button className="text-button" type="button" onClick={() => enter(null)}>Continue without a name</button>
        </p>

        <div className="entry-sync">
          <div>
            <strong>Need your projects on another device?</strong>
            <p>The account page uses the configured authentication service for optional sync.</p>
          </div>
          <Link className="button button-secondary" href="/account">Use a synced account</Link>
        </div>
      </section>

      <aside className="entry-aside" aria-label="Rehearsal guidance">
        <div className="entry-aside-copy">
          <span>Start from ground truth</span>
          <p>“Bring the rubric you will actually be judged against.”</p>
          <small>Kato, your rehearsal guide</small>
        </div>
        <img src={mascot.src} alt="" />
        <ul>
          <li>Exact evidence spans</li>
          <li>Visible analysis mode</li>
          <li>Saved progress by project</li>
        </ul>
      </aside>
    </main>
  );
}
