// Indonesian is the base case and English is the exception. The product is for
// Indonesian university students, and `ProjectSchema.language` already defaults
// to id-ID; a chrome default of English would contradict it.
export const INTERFACE_LOCALES = ['id', 'en'] as const;

export type InterfaceLocale = typeof INTERFACE_LOCALES[number];

export const DEFAULT_INTERFACE_LOCALE: InterfaceLocale = 'id';

/**
 * Read on the server to resolve the request locale and written by the
 * switcher. Not `HttpOnly`: the switcher sets it from the client, and it holds
 * a display preference rather than anything that authorises a request.
 */
export const LOCALE_COOKIE = 'talkactive.locale';

/** `<html lang>` needs a BCP-47 tag, and it should agree with the content. */
export const HTML_LANG: Record<InterfaceLocale, string> = {
  id: 'id-ID',
  en: 'en-US',
};

export function interfaceLocaleFrom(value: unknown): InterfaceLocale {
  return INTERFACE_LOCALES.includes(value as InterfaceLocale)
    ? value as InterfaceLocale
    : DEFAULT_INTERFACE_LOCALE;
}
