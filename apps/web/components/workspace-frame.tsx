'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';

import logo from '../../../src/assets/LOGO-dashboard.png';
import { initialsFor, readGuestIdentity } from '@/lib/guest-identity';
import {
  PROJECT_ROUTE_CHANGE_EVENT,
  projectIdFromSearch,
} from '@/lib/project-route';
import { useOwnedProjects } from './use-owned-projects';

const navigation = [
  { href: '/workspace', icon: 'home', label: 'Home' },
  { href: '/practice', icon: 'practice', label: 'Practice' },
  { href: '/rubric', icon: 'rubric', label: 'Rubric' },
  { href: '/progress', icon: 'progress', label: 'Progress' },
] as const;

type NavigationIconName = typeof navigation[number]['icon'] | 'landing';

function NavigationIcon({ name }: Readonly<{ name: NavigationIconName }>) {
  if (name === 'home') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></svg>;
  if (name === 'practice') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>;
  if (name === 'rubric') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  if (name === 'progress') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/progress' && pathname.startsWith('/attempts/')) return true;
  return pathname === href || (href !== '/workspace' && pathname.startsWith(`${href}/`));
}

function navigationHref(href: (typeof navigation)[number]['href'], projectId: string | null): string {
  return projectId ? `${href}?project=${encodeURIComponent(projectId)}` : href;
}

function NavigationItems({ pathname, mobile, projectId }: Readonly<{
  pathname: string;
  mobile: boolean;
  projectId: string | null;
}>) {
  return navigation.map((item) => (
    <Link
      aria-current={isActive(pathname, item.href) ? 'page' : undefined}
      className={`${mobile ? '' : 'nav-item'}${isActive(pathname, item.href) ? ' is-active' : ''}`.trim()}
      href={navigationHref(item.href, projectId)}
      key={item.href}
    >
      <span className="nav-icon"><NavigationIcon name={item.icon} /></span><span>{item.label}</span>
    </Link>
  ));
}

function ProjectAwareNavigationItems({ pathname, mobile }: Readonly<{
  pathname: string;
  mobile: boolean;
}>) {
  const searchProjectId = useSearchParams().get('project');
  const [projectId, setProjectId] = useState(searchProjectId);
  useEffect(() => setProjectId(searchProjectId), [searchProjectId]);
  useEffect(() => {
    function restoreProjectFromLocation(): void {
      setProjectId(projectIdFromSearch(window.location.search));
    }
    function acceptProjectChange(event: Event): void {
      const detail = (event as CustomEvent<{ projectId?: unknown }>).detail;
      setProjectId(typeof detail?.projectId === 'string' ? detail.projectId : null);
    }
    window.addEventListener('popstate', restoreProjectFromLocation);
    window.addEventListener(PROJECT_ROUTE_CHANGE_EVENT, acceptProjectChange);
    return () => {
      window.removeEventListener('popstate', restoreProjectFromLocation);
      window.removeEventListener(PROJECT_ROUTE_CHANGE_EVENT, acceptProjectChange);
    };
  }, []);
  return <NavigationItems pathname={pathname} mobile={mobile} projectId={projectId} />;
}

function ProjectNavigationLink({ id, title, attemptCount, activeRoute, defaultProjectId }: Readonly<{
  id: string;
  title: string;
  attemptCount: number;
  activeRoute: boolean;
  defaultProjectId: string | null;
}>) {
  const searchProjectId = useSearchParams().get('project');
  const [selectedProjectId, setSelectedProjectId] = useState(searchProjectId ?? defaultProjectId);
  useEffect(() => setSelectedProjectId(searchProjectId ?? defaultProjectId), [defaultProjectId, searchProjectId]);
  useEffect(() => {
    function restoreProjectFromLocation(): void {
      setSelectedProjectId(projectIdFromSearch(window.location.search) ?? defaultProjectId);
    }
    function acceptProjectChange(event: Event): void {
      const detail = (event as CustomEvent<{ projectId?: unknown }>).detail;
      setSelectedProjectId(typeof detail?.projectId === 'string' ? detail.projectId : defaultProjectId);
    }
    window.addEventListener('popstate', restoreProjectFromLocation);
    window.addEventListener(PROJECT_ROUTE_CHANGE_EVENT, acceptProjectChange);
    return () => {
      window.removeEventListener('popstate', restoreProjectFromLocation);
      window.removeEventListener(PROJECT_ROUTE_CHANGE_EVENT, acceptProjectChange);
    };
  }, [defaultProjectId]);
  const active = activeRoute && selectedProjectId === id;
  return (
    <Link
      aria-current={active ? 'true' : undefined}
      className={`sidebar-project${active ? ' is-active' : ''}`}
      href={`/practice?project=${encodeURIComponent(id)}`}
      title={`Practise ${title} · ${attemptCount} saved ${attemptCount === 1 ? 'attempt' : 'attempts'}`}
    >
      <i /><span>{title}</span>
    </Link>
  );
}

export function WorkspaceFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const projectRoute = pathname === '/workspace'
    || pathname === '/practice'
    || pathname === '/rubric'
    || pathname === '/progress';
  // Read after mount, never during render: the name lives in localStorage and
  // the server has no way to know it. Reading it during render would make the
  // server and client markup disagree and React would throw out the tree.
  const [displayName, setDisplayName] = useState<string | null>(null);
  useEffect(() => { setDisplayName(readGuestIdentity()?.name ?? null); }, []);
  const { projects } = useOwnedProjects();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">Skip to workspace content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="Back to Talk-Active landing page">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
        <nav className="main-nav">
          <Suspense fallback={<NavigationItems pathname={pathname} mobile={false} projectId={null} />}>
            <ProjectAwareNavigationItems pathname={pathname} mobile={false} />
          </Suspense>
          <Link className="nav-item" href="/">
            <span className="nav-icon"><NavigationIcon name="landing" /></span><span>Landing page</span>
          </Link>
        </nav>
        {/* The sidebar listed one project, and that project's name was written
            into the markup. The workspace has always been able to hold several —
            the table is owner-scoped — so the list is now read from the account
            that owns them. A guest has no synced project and keeps the local
            workspace, named for what it actually is. */}
        <div className="sidebar-projects">
          <div className="sidebar-label-row"><span>{projects.length > 1 ? 'Projects' : 'Project'}</span></div>
          <div className="sidebar-project-list">
            {projects.length === 0
              ? <Link aria-current={pathname === '/workspace' ? 'page' : undefined} className="sidebar-project is-active" href="/workspace"><i /><span>Local workspace</span></Link>
              : projects.map((summary) => (
                <Suspense
                  fallback={<Link className="sidebar-project" href={`/practice?project=${encodeURIComponent(summary.project.id)}`}><i /><span>{summary.project.title}</span></Link>}
                  key={summary.project.id}
                >
                  <ProjectNavigationLink id={summary.project.id} title={summary.project.title} attemptCount={summary.attemptCount} activeRoute={projectRoute} defaultProjectId={projects[0]?.project.id ?? null} />
                </Suspense>
              ))}
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-chip"><span aria-hidden="true">●</span> Local guest workspace</div>
          <Link
            className="profile-chip"
            href={displayName ? '/account' : '/enter'}
            aria-label={displayName ? `Rehearsing as ${displayName}. Open account options.` : 'Put your name on this workspace'}
          >
            <span className="avatar" aria-hidden="true">{displayName ? initialsFor(displayName) : 'G'}</span>
            <span>
              <strong>{displayName ?? 'Guest'}</strong>
              <small>{displayName ? 'Optional account sync' : 'Add your name'}</small>
            </span>
            <span aria-hidden="true">•••</span>
          </Link>
        </div>
      </aside>

      <header className="mobile-header">
        <Link className="brand" href="/" aria-label="Back to Talk-Active landing page">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
      </header>

      <main className="workspace" id="workspace-main" tabIndex={-1}>{children}</main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Suspense fallback={<NavigationItems pathname={pathname} mobile projectId={null} />}>
          <ProjectAwareNavigationItems pathname={pathname} mobile />
        </Suspense>
      </nav>
    </div>
  );
}
