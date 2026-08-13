export const PROJECT_ROUTE_CHANGE_EVENT = 'talkactive:project-route-change';

export function projectIdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get('project');
}

export function announceProjectRouteChange(projectId: string | null): void {
  window.dispatchEvent(new CustomEvent(PROJECT_ROUTE_CHANGE_EVENT, {
    detail: { projectId },
  }));
}

/**
 * Changes only the selected-project query while retaining the current route
 * and every unrelated search parameter. The custom event keeps persistent
 * layout navigation in step with History API changes, which do not emit a
 * popstate event in the tab that called pushState/replaceState.
 */
export function writeProjectToCurrentUrl(
  projectId: string | null,
  mode: 'push' | 'replace',
): void {
  const nextUrl = new URL(window.location.href);
  if (projectId) nextUrl.searchParams.set('project', projectId);
  else nextUrl.searchParams.delete('project');
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    window.history.state,
    '',
    nextUrl,
  );
  announceProjectRouteChange(projectId);
}
