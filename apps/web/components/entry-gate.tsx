'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo-stacked.svg';
import mascot from '../../../src/assets/mascot/kato-macaw-questioning.svg';
import {
  looksLikeEmail,
  nameFromEmail,
  normaliseDisplayName,
  writeGuestIdentity,
} from '@/lib/guest-identity';

type Mode = 'sign-in' | 'sign-up';

const COPY: Record<Mode, { title: string; action: string; other: string; otherLabel: string }> = {
  'sign-in': {
    title: 'Welcome back.',
    action: 'Continue',
    other: 'sign-up',
    otherLabel: 'Create one',
  },
  'sign-up': {
    title: 'Set up your workspace.',
    action: 'Create workspace',
    other: 'sign-in',
    otherLabel: 'Use it',
  },
};

export function EntryGate() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[mode];

  function enter(name: string, address: string | null): void {
    writeGuestIdentity({ name, email: address });
    router.push('/workspace');
  }

  function submitForm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);

    if (!looksLikeEmail(email)) {
      setError('Enter an email address so the workspace has something to label your attempts with.');
      return;
    }
    if (password.trim().length < 6) {
      setError('Use at least six characters. Nothing is checked against a server — this only stops an empty field.');
      return;
    }
    const chosen = mode === 'sign-up' ? normaliseDisplayName(fullName) : '';
    enter(chosen || nameFromEmail(email), email.trim());
  }

  function submitGuest(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    const name = normaliseDisplayName(guestName);
    if (!name) {
      setError('Type the name you want on this workspace.');
      return;
    }
    enter(name, null);
  }

  return (
    <main className="entry-gate">
      <section className="entry-panel">
        <Link className="entry-brand" href="/" aria-label="Talk-Active home">
          <img src={logo.src} alt="Talk-Active" />
        </Link>

        <div className="entry-tabs" role="tablist" aria-label="How to continue">
          {(['sign-in', 'sign-up'] as const).map((value) => (
            <button
              className={`entry-tab${mode === value ? ' is-active' : ''}`}
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => { setMode(value); setError(null); }}
            >
              {value === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <h1 className="entry-title">{copy.title}</h1>

        {/* The whole point of this screen is that it looks real. That is
            precisely why it has to say what it is — a judge who assumes there
            is a password database and then finds there is not has been misled
            by us, not by their own assumption. */}
        <p className="entry-disclosure">
          <strong>This is a demonstration sign-in.</strong> No account is created and nothing is
          sent anywhere — your name is kept in this browser so the workspace can label your work.
          Real synced accounts are a separate, optional feature on the{' '}
          <Link href="/account">account page</Link>.
        </p>

        <form className="entry-form" onSubmit={submitForm}>
          {mode === 'sign-up' ? (
            <label className="entry-field">
              <span>Full name</span>
              <input
                autoComplete="name"
                maxLength={40}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Sari Wulandari"
                type="text"
                value={fullName}
              />
            </label>
          ) : null}

          <label className="entry-field">
            <span>Email</span>
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="sari@ui.ac.id"
              type="email"
              value={email}
            />
          </label>

          <label className="entry-field">
            <span>Password</span>
            <input
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least six characters"
              type="password"
              value={password}
            />
          </label>

          <button className="button button-primary button-full" type="submit">
            {copy.action} <span aria-hidden="true">→</span>
          </button>
        </form>

        <p className="entry-switch">
          {mode === 'sign-in' ? 'No workspace yet?' : 'Already set one up?'}{' '}
          <button className="text-button" type="button" onClick={() => { setMode(copy.other as Mode); setError(null); }}>
            {copy.otherLabel}
          </button>
        </p>

        <div className="entry-divider"><span>or go straight in</span></div>

        <form className="entry-guest" onSubmit={submitGuest}>
          <label className="entry-field">
            <span>Your name</span>
            <input
              autoComplete="name"
              maxLength={40}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Type a name and start rehearsing"
              type="text"
              value={guestName}
            />
          </label>
          <button className="button button-secondary button-full" type="submit">
            Enter the workspace
          </button>
        </form>

        {error ? <p className="entry-error" role="alert">{error}</p> : null}

        <p className="entry-skip">
          <Link href="/workspace">Skip and stay unnamed</Link>
        </p>
      </section>

      <aside className="entry-aside" aria-hidden="true">
        <img src={mascot.src} alt="" />
        <p>&ldquo;Bring the rubric you will actually be judged against.&rdquo;</p>
        <small>Kato, your rehearsal guide</small>
      </aside>
    </main>
  );
}
