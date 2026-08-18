import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { INTERFACE_LOCALES, LOCALE_COOKIE, type InterfaceLocale } from './locales.ts';

/**
 * The interface locale is deliberately NOT in the URL. A `[locale]` segment
 * would rewrite every route string in the app and every path in
 * `e2e/production-ui/`, and the product has no need for shareable per-language
 * URLs — this is a personal preference, not a public edition of the site.
 *
 * The cost is that a locale read from a cookie is not known at build time, so
 * locale-dependent pages render per request instead of being prerendered.
 * `setRequestLocale` cannot help without a route param. That is accepted: these
 * pages are API-driven shells whose content arrives after hydration anyway.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const requested = store.get(LOCALE_COOKIE)?.value;
  const locale: InterfaceLocale = INTERFACE_LOCALES.includes(requested as InterfaceLocale)
    ? requested as InterfaceLocale
    : 'id';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
