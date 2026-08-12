import type { Metadata } from 'next';

import { ProductionShell } from '@/components/production-shell';
import { ProjectSchema } from '@/lib/contracts';

const seedProject = ProjectSchema.parse({
  id: 'project-talk-active',
  userId: null,
  title: 'Talk-Active — RISTEK Hackathon',
  eventContext: '7-minute final pitch · 3-minute Q&A',
  deadline: '2026-08-14',
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
});

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default function MarketingPage() {
  return <ProductionShell project={seedProject} />;
}
