import {
  ProjectLanguageSchema,
  type ProjectLanguage,
} from './contracts.ts';

export const LOCAL_PROJECT_LANGUAGE_KEY = 'talkactive.production.project-language.v1';

export function readLocalProjectLanguage(
  storage: Pick<Storage, 'getItem'>,
): ProjectLanguage {
  try {
    const parsed = ProjectLanguageSchema.safeParse(
      storage.getItem(LOCAL_PROJECT_LANGUAGE_KEY),
    );
    return parsed.success ? parsed.data : 'id-ID';
  } catch {
    // Private browsing and locked-down kiosk policies can make Storage throw.
    // Language selection is a preference, so capture remains usable with the
    // documented Indonesian default instead of failing the page.
    return 'id-ID';
  }
}

export function writeLocalProjectLanguage(
  storage: Pick<Storage, 'setItem'>,
  language: ProjectLanguage,
): ProjectLanguage {
  const parsed = ProjectLanguageSchema.parse(language);
  try {
    storage.setItem(LOCAL_PROJECT_LANGUAGE_KEY, parsed);
  } catch {
    // The caller still keeps the selected language in React state. Failure to
    // persist a local preference must not block a rehearsal.
  }
  return parsed;
}
