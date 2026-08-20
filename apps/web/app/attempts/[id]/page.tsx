import type { Metadata } from 'next';
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { SavedAttemptReview } from '@/components/saved-attempt-review';
import { WorkspaceFrame } from '@/components/workspace-frame';

export async function generateMetadata(): Promise<Metadata> {
  const metadata = await getTranslations('metadata');
  return {
    title: metadata('savedTitle'),
    description: metadata('savedDescription'),
  };
}

async function SavedAttemptContent({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
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
