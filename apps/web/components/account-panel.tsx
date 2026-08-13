'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import { authClient } from '@/lib/auth-client';
import { jsonRequest, requestContract } from '@/lib/api/client';
import {
  CapabilitiesResponseSchema,
  DeleteAccountResponseSchema,
  LegacyImportResponseSchema,
} from '@/lib/contracts';
import { LOCAL_EVIDENCE_CONFIRMATIONS_KEY } from '@/lib/evidence-confirmations';
import {
  LEGACY_RUBRIC_STORAGE_KEY,
  RUBRIC_SOURCE_STORAGE_KEY,
  RUBRIC_STORAGE_KEY,
} from '@/lib/rubric-storage';

type FormMode = 'sign-in' | 'sign-up';

interface SessionUser {
  name: string;
  email: string;
}

export function AccountPanel() {
  const [accountsAvailable, setAccountsAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [mode, setMode] = useState<FormMode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [legacyWorkspace, setLegacyWorkspace] = useState<string | null>(null);
  const [legacyProjectCount, setLegacyProjectCount] = useState(0);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  useEffect(() => {
    const legacy = localStorage.getItem('talkactive.workspace.v1');
    if (legacy) {
      setLegacyWorkspace(legacy);
      try {
        const parsed = JSON.parse(legacy) as { projects?: unknown[] };
        setLegacyProjectCount(Array.isArray(parsed.projects) ? parsed.projects.length : 0);
      } catch {
        setLegacyProjectCount(0);
      }
    }
    void requestContract('/api/capabilities', CapabilitiesResponseSchema).then(async (capabilities) => {
      setAccountsAvailable(capabilities.accounts);
      if (capabilities.accounts) {
        const session = await authClient.getSession();
        if (session.data?.user) {
          setSessionUser({ name: session.data.user.name, email: session.data.user.email });
        }
      }
    }).catch(() => setAccountsAvailable(false)).finally(() => setChecked(true));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const result = mode === 'sign-up'
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) throw new Error(result.error.message ?? 'The account request could not be completed.');
      const user = result.data?.user;
      if (user) setSessionUser({ name: user.name, email: user.email });
      setPassword('');
      setStatus(mode === 'sign-up' ? 'Account created. This browser can now sync work when persistence is enabled.' : 'Signed in.');
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'The account request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    const result = await authClient.signOut();
    setBusy(false);
    if (result.error) {
      setStatus(result.error.message ?? 'Sign-out could not be completed.');
      return;
    }
    setSessionUser(null);
    setStatus('Signed out. Local guest mode remains available.');
  }

  function exportLocalData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      legacyWorkspace: localStorage.getItem('talkactive.workspace.v1'),
      productionRubric: localStorage.getItem(RUBRIC_STORAGE_KEY),
      legacyProductionRubric: localStorage.getItem(LEGACY_RUBRIC_STORAGE_KEY),
      productionRubricSource: localStorage.getItem(RUBRIC_SOURCE_STORAGE_KEY),
      productionSessions: localStorage.getItem('talkactive.production.sessions.v1'),
      evidenceConfirmations: localStorage.getItem(LOCAL_EVIDENCE_CONFIRMATIONS_KEY),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'talk-active-local-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Local browser data exported. Nothing was deleted.');
  }

  async function importLegacy() {
    if (!legacyWorkspace) return;
    setBusy(true);
    try {
      const payload: unknown = JSON.parse(legacyWorkspace);
      const imported = await requestContract('/api/data/import/local', LegacyImportResponseSchema, jsonRequest('POST', payload));
      setStatus(`${imported.importedProjects} projects and ${imported.importedSessions} session summaries imported. The original browser data is still here.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'The local workspace could not be imported.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccountData() {
    setBusy(true);
    try {
      await requestContract('/api/account', DeleteAccountResponseSchema, jsonRequest('DELETE', {
        confirmation: deleteConfirmation,
      }));
      setSessionUser(null);
      setDeleteConfirmation('');
      setStatus('Synced account data was permanently deleted. Local browser data was left untouched.');
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'The account data could not be deleted.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="view is-visible" aria-labelledby="accountTitle">
    <header className="page-header compact-header workflow-header"><div className="workflow-heading"><img className="workflow-mark" src={logo.src} alt="" /><div><p className="overline">Optional account sync</p><h1 id="accountTitle">Practise first. Sync only when it helps.</h1><p className="page-lede">An account is for continuity across devices. It never gates a first rehearsal.</p></div></div><Link className="button button-secondary" href="/workspace">Continue as guest</Link></header>
    <div className="production-account-layout">
      <section className="surface production-account-card">
        {!checked ? <p role="status">Checking account availability…</p> : !accountsAvailable ? <div className="production-account-empty"><p className="overline">Guest mode active</p><h2>Account sync is not configured here.</h2><p>Your local workspace remains fully usable. When the deployment has Postgres and an auth secret, this same screen enables account creation and sign-in.</p><Link className="button button-primary" href="/practice">Start a local rehearsal</Link></div> : sessionUser ? <div className="production-account-empty"><p className="overline">Signed in</p><h2>{sessionUser.name}</h2><p>{sessionUser.email}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button></div> : <>
          <div className="capture-tabs" role="tablist" aria-label="Account action"><button className={mode === 'sign-in' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'sign-in'} onClick={() => setMode('sign-in')}>Sign in</button><button className={mode === 'sign-up' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'sign-up'} onClick={() => setMode('sign-up')}>Create account</button></div>
          <form className="production-account-form" onSubmit={(event) => void submit(event)}>
            {mode === 'sign-up' && <><label htmlFor="accountName">Name</label><input id="accountName" autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></>}
            <label htmlFor="accountEmail">Email</label><input id="accountEmail" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="accountPassword">Password</label><input id="accountPassword" type="password" minLength={10} maxLength={128} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} />
            <p className="production-field-note">Use 10–128 characters. Passwords are handled by Better Auth; Talk-Active does not place them in project or transcript records.</p>
            <button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}</button>
          </form>
        </>}
        {status && <p className="rubric-import-status" role="status">{status}</p>}
        <div className="production-data-tools">
          <p className="overline">Your data</p>
          <button className="button button-secondary" type="button" onClick={exportLocalData}>Export local data</button>
          {sessionUser && <a className="button button-secondary" href="/api/data/export" download>Export synced data</a>}
          {sessionUser && legacyWorkspace && legacyProjectCount > 0 && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void importLegacy()}>Bring in {legacyProjectCount} browser project{legacyProjectCount === 1 ? '' : 's'}</button>}
        </div>
        {sessionUser && <div className="production-delete-zone">
          <p className="overline">Permanent deletion</p>
          <p>Type <strong>DELETE MY TALK-ACTIVE DATA</strong> to remove the account, sessions, projects, and synced transcripts by database cascade. Local browser data is separate.</p>
          <label htmlFor="deleteConfirmation">Confirmation phrase</label>
          <input id="deleteConfirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
          <button className="button button-danger" type="button" disabled={busy || deleteConfirmation !== 'DELETE MY TALK-ACTIVE DATA'} onClick={() => void deleteAccountData()}>Delete synced account data</button>
        </div>}
      </section>
      <aside className="surface rubric-guide"><p className="overline">What changes</p><ul><li><span>1</span><div><strong>Guest stays available</strong><small>No account is required for a first run.</small></div></li><li><span>2</span><div><strong>Identity is separate</strong><small>Account records live in the configured Postgres deployment, not inside transcripts.</small></div></li><li><span>3</span><div><strong>Inference is disclosed separately</strong><small>Signing in does not change where configured model providers process criterion-scoped text.</small></div></li></ul><div className="guide-note"><strong>Data boundary</strong><p>A camera-and-microphone replay is saved only after you opt in. Durable replay requires a signed-in owner and private storage; deleting it keeps the text feedback. Local work is separate.</p></div></aside>
    </div>
  </section>;
}
