'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import {
  INTERFACE_LOCALES,
  LOCALE_COOKIE,
  interfaceLocaleFrom,
  type InterfaceLocale,
} from '@/i18n/locales';

/**
 * The interface language, which is NOT the project language.
 *
 * They are separate on purpose: a student rehearsing an English-language pitch
 * may still want an Indonesian interface, and a student whose interface is
 * English may be rehearsing in Indonesian. Conflating them would silently
 * change the language Kato asks in whenever someone changed the chrome — and
 * the project language is a property of the project, saved per project, while
 * this is a property of the reader. The hint text below says so, because two
 * language controls in one product is exactly the sort of thing a user has to
 * be told about rather than left to discover (INV-4).
 */
export function InterfaceLanguage() {
  const t = useTranslations('language');
  const locale = interfaceLocaleFrom(useLocale());
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: InterfaceLocale) {
    if (next === locale) return;
    // A year, so the choice survives the gap between one rehearsal and the
    // next. SameSite=Lax is enough: this is a display preference and carries
    // no authority, which is also why it is not HttpOnly — the switcher is a
    // client component and writes it directly.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // The locale is resolved on the server from that cookie, so the new tree
    // has to be re-requested. router.refresh keeps client state.
    startTransition(() => router.refresh());
  }

  return <div className="interface-language">
    <label htmlFor="interfaceLanguage">
      {t('label')}
      <select
        id="interfaceLanguage"
        value={locale}
        disabled={pending}
        onChange={(event) => choose(interfaceLocaleFrom(event.target.value))}
      >
        {INTERFACE_LOCALES.map((option) => (
          <option key={option} value={option}>{t(option)}</option>
        ))}
      </select>
      <small>{t('hint')}</small>
    </label>
  </div>;
}
