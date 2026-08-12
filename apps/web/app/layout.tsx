import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import socialImage from '../../../src/assets/LOGO & TAGLINE.png';

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

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
