import { PracticeRoom } from '@/components/practice-room';

export const instant = false;

export default async function PracticePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ project?: string | string[] }>;
}>) {
  const { project } = await searchParams;
  const initialProjectId = typeof project === 'string' && project.trim()
    ? project.trim()
    : null;
  return <PracticeRoom initialProjectId={initialProjectId} />;
}
