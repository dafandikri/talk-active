'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';

import { HTML_LANG, interfaceLocaleFrom } from '@/i18n/locales';

/**
 * `<html lang>` is on the root element, which is rendered before the locale is
 * known — the locale lives in a cookie, and reading a cookie in the root layout
 * makes every route unprerenderable under Cache Components. So the document
 * ships with the default locale's tag and this corrects it once the localized
 * subtree has streamed in.
 *
 * It matters because `lang` is what a screen reader uses to choose a voice.
 * Indonesian text announced by an English synthesiser is close to unusable, and
 * that was the state of the whole app while `lang` was hardcoded to "en".
 */
export function HtmlLang() {
  const locale = interfaceLocaleFrom(useLocale());
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);
  return null;
}
