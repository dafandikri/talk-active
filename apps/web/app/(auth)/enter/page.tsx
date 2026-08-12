import type { Metadata } from 'next';

import { EntryGate } from '@/components/entry-gate';

export const metadata: Metadata = {
  title: 'Enter your workspace — Talk-Active',
  description: 'Name this workspace and start rehearsing against a real evaluation rubric.',
  alternates: { canonical: '/enter' },
};

export default function EnterPage() {
  return <EntryGate />;
}
