'use client';

import { useEffect, useState } from 'react';

import { requestContract } from '@/lib/api/client';
import {
  CapabilitiesResponseSchema,
  ProjectListResponseSchema,
  type ProjectSummary,
} from '@/lib/contracts';

export interface OwnedProjects {
  readonly projects: readonly ProjectSummary[];
  readonly loading: boolean;
}

/**
 * The projects this account owns, for every surface that names one.
 *
 * The sidebar, the rubric header, the practice setup and the session archive
 * all used to print the same compiled-in title. Giving each of them its own
 * fetch would just distribute the duplication instead of removing it, so the
 * request lives here once.
 *
 * The list is asked for only once the server has said there is one to ask for.
 * The route requires a synced identity (M-9), so calling it as a guest returns
 * 401 — and a 401 is a console error, which the production browser gate treats
 * as a broken demo path. `persistence: 'neon'` is exactly "a database and a
 * signed-in owner", so it is the right thing to gate on: a guest makes no
 * failing request, and the callers render their local workspace instead.
 *
 * Failures are swallowed deliberately. Every caller has a local-workspace
 * fallback to draw, and an error banner here would report a failure on a page
 * that is working.
 */
export function useOwnedProjects(): OwnedProjects {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const capabilities = await requestContract(
          '/api/capabilities',
          CapabilitiesResponseSchema,
          { signal: abort.signal },
        );
        if (abort.signal.aborted || capabilities.persistence !== 'neon') return;
        const response = await requestContract(
          '/api/projects',
          ProjectListResponseSchema,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        setProjects(response.projects);
      } catch {
        /* Callers fall back to the local workspace. */
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, []);

  return { projects, loading };
}
