'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import logo from '../../../src/assets/LOGO-dashboard.png';
import { initialsFor, readGuestIdentity } from '@/lib/guest-identity';

const navigation = [
  { href: '/workspace', icon: 'home', label: 'Home' },
  { href: '/practice', icon: 'practice', label: 'Practice' },
  { href: '/rubric', icon: 'rubric', label: 'Rubric' },
  { href: '/progress', icon: 'progress', label: 'Progress' },
] as const;

type NavigationIconName = typeof navigation[number]['icon'] | 'guide';

function NavigationIcon({ name }: Readonly<{ name: NavigationIconName }>) {
  if (name === 'home') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></svg>;
  if (name === 'practice') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>;
  if (name === 'rubric') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  if (name === 'progress') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 0 1 4.4 1c0 1.7-2.2 2-2.2 3.5M12 17h.01" /></svg>;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/workspace' && pathname.startsWith(`${href}/`));
}

export function WorkspaceFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  // Read after mount, never during render: the name lives in localStorage and
  // the server has no way to know it. Reading it during render would make the
  // server and client markup disagree and React would throw out the tree.
  const [displayName, setDisplayName] = useState<string | null>(null);
  useEffect(() => { setDisplayName(readGuestIdentity()?.name ?? null); }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <Link className="brand" href="/workspace" aria-label="Talk-Active home">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
        <nav className="main-nav">
          {navigation.map((item) => (
            <Link className={`nav-item${isActive(pathname, item.href) ? ' is-active' : ''}`} href={item.href} key={item.href}>
              <span className="nav-icon"><NavigationIcon name={item.icon} /></span><span>{item.label}</span>
            </Link>
          ))}
          <Link className="nav-item" href="/">
            <span className="nav-icon"><NavigationIcon name="guide" /></span><span>How it works</span>
          </Link>
        </nav>
        <div className="sidebar-projects">
          <div className="sidebar-label-row"><span>Project</span></div>
          <div className="sidebar-project-list">
            <Link className="sidebar-project is-active" href="/workspace"><i /><span>Talk-Active · RISTEK Finals</span></Link>
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
        <Link className="brand" href="/workspace" aria-label="Talk-Active home">
          <img className="brand-mark" src={logo.src} alt="" />
          <span className="brand-wordmark">Talk-<strong className="brand-wordmark-accent">Active</strong></span>
        </Link>
      </header>

      <main className="workspace">{children}</main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((item) => (
          <Link className={isActive(pathname, item.href) ? 'is-active' : ''} href={item.href} key={item.href}>
            <span className="nav-icon"><NavigationIcon name={item.icon} /></span>{item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
