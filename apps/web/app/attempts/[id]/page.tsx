import type { Metadata } from 'next';
import { Suspense } from 'react';

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
  return (
    <Suspense fallback={<main className="view is-visible saved-review-state"><p>Loading saved attempt…</p></main>}>
      <SavedAttemptContent params={params} />
    </Suspense>
  );
}
