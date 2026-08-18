'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import { useTranslations } from 'next-intl';

import { authClient } from '@/lib/auth-client';
import { InterfaceLanguage } from '@/components/interface-language';
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

/**
 * Typed by the user and compared byte-for-byte before anything is deleted, so
 * it is a literal rather than a translated string. A phrase that changed with
 * the interface language would silently invalidate the guard for anyone who
 * switched locale mid-session, and an irreversible action is the last place to
 * accept that risk.
 */
const DELETE_CONFIRMATION_PHRASE = 'DELETE MY TALK-ACTIVE DATA';

type FormMode = 'sign-in' | 'sign-up';

interface SessionUser {
  name: string;
  email: string;
}

export function AccountPanel() {
  const t = useTranslations('account');
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
      if (result.error) throw new Error(result.error.message ?? t('statusRequestFailed'));
      const user = result.data?.user;
      if (user) setSessionUser({ name: user.name, email: user.email });
      setPassword('');
      setStatus(mode === 'sign-up' ? t('statusCreated') : t('statusSignedIn'));
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : t('statusRequestFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    const result = await authClient.signOut();
    setBusy(false);
    if (result.error) {
      setStatus(result.error.message ?? t('statusSignOutFailed'));
      return;
    }
    setSessionUser(null);
    setStatus(t('statusSignedOut'));
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
    setStatus(t('statusExported'));
  }

  async function importLegacy() {
    if (!legacyWorkspace) return;
    setBusy(true);
    try {
      const payload: unknown = JSON.parse(legacyWorkspace);
      const imported = await requestContract('/api/data/import/local', LegacyImportResponseSchema, jsonRequest('POST', payload));
      setStatus(t('statusImported', {
        projects: imported.importedProjects,
        sessions: imported.importedSessions,
      }));
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : t('statusImportFailed'));
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
      setStatus(t('statusDeleted'));
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : t('statusDeleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return <section className="view is-visible" aria-labelledby="accountTitle">
    <header className="page-header compact-header"><div className="workflow-heading"><img className="workflow-mark" src={logo.src} alt="" /><div><p className="overline">{t('overline')}</p><h1 id="accountTitle">{t('title')}</h1><p className="page-lede">{t('lede')}</p></div></div></header>
    <div className="production-account-layout">
      <section className="surface production-account-card">
        {!checked ? <p role="status">{t('checking')}</p> : !accountsAvailable ? <div className="production-account-empty"><p className="overline">{t('guestOverline')}</p><h2>{t('guestTitle')}</h2><p>{t('guestBody')}</p><Link className="button button-primary" href="/practice">{t('guestAction')}</Link></div> : sessionUser ? <div className="production-account-empty"><p className="overline">{t('signedInOverline')}</p><h2>{sessionUser.name}</h2><p>{sessionUser.email}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void signOut()}>{t('signOut')}</button></div> : <>
          <div className="capture-tabs" role="tablist" aria-label={t('tablistLabel')}><button className={mode === 'sign-in' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'sign-in'} onClick={() => setMode('sign-in')}>{t('signIn')}</button><button className={mode === 'sign-up' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'sign-up'} onClick={() => setMode('sign-up')}>{t('createAccount')}</button></div>
          <form className="production-account-form" onSubmit={(event) => void submit(event)}>
            {mode === 'sign-up' && <><label htmlFor="accountName">{t('nameLabel')}</label><input id="accountName" autoComplete="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></>}
            <label htmlFor="accountEmail">{t('emailLabel')}</label><input id="accountEmail" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="accountPassword">{t('passwordLabel')}</label><input id="accountPassword" type="password" minLength={10} maxLength={128} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} />
            <p className="production-field-note">{t('passwordNote')}</p>
            <button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? t('wait') : mode === 'sign-up' ? t('createAccount') : t('signIn')}</button>
          </form>
        </>}
        {status && <p className="rubric-import-status" role="status">{status}</p>}
        <InterfaceLanguage />
        <div className="production-data-tools">
          <p className="overline">{t('dataOverline')}</p>
          <button className="button button-secondary" type="button" onClick={exportLocalData}>{t('exportLocal')}</button>
          {sessionUser && <a className="button button-secondary" href="/api/data/export" download>{t('exportSynced')}</a>}
          {sessionUser && legacyWorkspace && legacyProjectCount > 0 && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void importLegacy()}>{t('importLegacy', { count: legacyProjectCount })}</button>}
        </div>
        {sessionUser && <div className="production-delete-zone">
          <p className="overline">{t('deleteOverline')}</p>
          <p>{t.rich('deleteInstruction', { phrase: () => <strong>{DELETE_CONFIRMATION_PHRASE}</strong> })}</p>
          <label htmlFor="deleteConfirmation">{t('deleteLabel')}</label>
          <input id="deleteConfirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
          <button className="button button-danger" type="button" disabled={busy || deleteConfirmation !== DELETE_CONFIRMATION_PHRASE} onClick={() => void deleteAccountData()}>{t('deleteAction')}</button>
        </div>}
      </section>
      <aside className="surface rubric-guide"><p className="overline">{t('guideOverline')}</p><ul><li><span>1</span><div><strong>{t('guide1Title')}</strong><small>{t('guide1Body')}</small></div></li><li><span>2</span><div><strong>{t('guide2Title')}</strong><small>{t('guide2Body')}</small></div></li><li><span>3</span><div><strong>{t('guide3Title')}</strong><small>{t('guide3Body')}</small></div></li></ul><div className="guide-note"><strong>{t('boundaryTitle')}</strong><p>{t('boundaryBody')}</p></div></aside>
    </div>
  </section>;
}
