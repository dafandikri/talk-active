'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import logo from '../../../src/assets/LOGO-dashboard.png';

const navigation = [
  { href: '/workspace', icon: '⌂', label: 'Home' },
  { href: '/practice', icon: '▶', label: 'Practice' },
  { href: '/rubric', icon: '▦', label: 'Rubric' },
  { href: '/progress', icon: '↗', label: 'Progress' },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/workspace' && pathname.startsWith(`${href}/`));
}

export function WorkspaceFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();

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
              <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </Link>
          ))}
          <Link className="nav-item" href="/">
            <span className="nav-icon" aria-hidden="true">◎</span><span>How it works</span>
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
          <Link className="profile-chip" href="/account" aria-label="Optional account sync">
            <span className="avatar" aria-hidden="true">G</span>
            <span><strong>Guest</strong><small>Optional account sync</small></span>
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
            <span aria-hidden="true">{item.icon}</span>{item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
