import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import socialImage from '../../../src/assets/LOGO & TAGLINE.png';
import { DEFAULT_INTERFACE_LOCALE, HTML_LANG } from '@/i18n/locales';
import { HtmlLang } from '@/components/html-lang';
import { ToastProvider } from '@/components/toast';

// The visual system is frozen during the migration. Import the source styles
// directly so the vanilla and Next.js builds cannot drift through copied CSS.
import '../../../src/tokens.css';
import '../../../src/styles.css';
import '../../../src/landing.css';
import './shell.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://talk-active-id.vercel.app'),
  title: {
    default: 'Talk-Active',
    template: '%s · Talk-Active',
  },
  description: 'Rehearse against the rubric, then defend the evidence behind your claims.',
  openGraph: {
    title: 'Talk-Active — Rubric-grounded rehearsal',
    description: 'Rehearse against the real rubric, inspect exact evidence, and practise the hardest grounded question.',
    images: [socialImage.src],
    type: 'website',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Talk-Active — Rubric-grounded rehearsal',
    description: 'Rehearse against the real rubric, inspect exact evidence, and practise the hardest grounded question.',
    images: [socialImage.src],
  },
};

/**
 * Resolving the locale reads a cookie, and under Cache Components any uncached
 * request data touched outside a Suspense boundary makes the whole route
 * unprerenderable — the build fails closed rather than silently going dynamic.
 * Streaming the localized subtree is the framework's own first remedy and it
 * keeps the document shell prerendered, so the CSP reasoning in next.config.ts
 * (which depends on these routes being static) still holds.
 */
async function LocalizedShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <NextIntlClientProvider>
      <HtmlLang />
      <ToastProvider>{children}</ToastProvider>
    </NextIntlClientProvider>
  );
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The shell ships with the default locale's tag; HtmlLang corrects it once
  // the subtree above has streamed. It was hardcoded to "en" for a product
  // whose audience is Indonesian and whose project default is id-ID.
  return (
    <html lang={HTML_LANG[DEFAULT_INTERFACE_LOCALE]}>
      <body>
        <Suspense fallback={null}>
          <LocalizedShell>{children}</LocalizedShell>
        </Suspense>
      </body>
    </html>
  );
}
