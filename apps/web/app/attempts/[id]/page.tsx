import type { Metadata } from 'next';
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';

import { SavedAttemptReview } from '@/components/saved-attempt-review';
import { WorkspaceFrame } from '@/components/workspace-frame';

export const metadata: Metadata = {
  title: 'Saved attempt review',
  description: 'Review a saved rehearsal against its delivery observations and rubric evidence.',
};

async function SavedAttemptContent({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const t = useTranslations('savedReview');
  const { id } = await params;

  return (
    <WorkspaceFrame>
      <SavedAttemptReview attemptId={id} />
    </WorkspaceFrame>
  );
}

export default function SavedAttemptPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const t = useTranslations('savedReview');
  return (
    <Suspense fallback={<main className="view is-visible saved-review-state"><p>{t('loadingSavedAttempt')}</p></main>}>
      <SavedAttemptContent params={params} />
    </Suspense>
  );
}
