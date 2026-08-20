import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { EntryGate } from '@/components/entry-gate';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = await getTranslations('metadata');
  return {
    title: metadata('enterTitle'),
    description: metadata('enterDescription'),
    alternates: { canonical: '/enter' },
  };
}

export default function EnterPage() {
  return <EntryGate />;
}
