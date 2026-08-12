// ============================================================================
//  Who is using this device.
//
//  This is a demonstration sign-in, not authentication. There is no server, no
//  credential check, no session — a name is written to localStorage and read
//  back. Real accounts live behind Better Auth in lib/auth.ts and only exist
//  when DATABASE_URL is configured; this exists so the product is usable, and
//  demonstrable, when it is not.
//
//  Because it looks like a sign-in, the screen has to say plainly that it is
//  not one. INV-2 is about not claiming a capability the build lacks, and
//  "your account is secure" would be exactly that claim.
// ============================================================================

export const GUEST_IDENTITY_KEY = 'talkactive.guest.identity.v1';
export const MAX_DISPLAY_NAME = 40;

export interface GuestIdentity {
  readonly name: string;
  /** Present only when the visitor used the demonstration sign-in form. */
  readonly email: string | null;
}

/** A name good enough to label a workspace: trimmed, collapsed, bounded. */
export function normaliseDisplayName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_DISPLAY_NAME);
}

/**
 * Shape check only. It deliberately does NOT verify that the address exists or
 * that anyone controls it — nothing here could, and pretending otherwise is
 * the failure this module is written to avoid.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(trimmed);
}

/** "sari.wulandari@ui.ac.id" → "Sari Wulandari", so the chip is not an address. */
export function nameFromEmail(email: string): string {
  const local = email.trim().split('@')[0] ?? '';
  const words = local
    .split(/[._\-+]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase('id-ID') + part.slice(1));
  return normaliseDisplayName(words.join(' ')) || 'Guest';
}

/** Up to two letters for the avatar. 'G' when there is no name yet. */
export function initialsFor(name: string): string {
  const letters = normaliseDisplayName(name)
    .split(' ')
    .filter((part) => /[\p{L}\p{N}]/u.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('id-ID'))
    .join('');
  return letters || 'G';
}

export function readGuestIdentity(): GuestIdentity | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GUEST_IDENTITY_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === 'string' ? normaliseDisplayName(record.name) : '';
    if (!name) return null;
    return { name, email: typeof record.email === 'string' ? record.email : null };
  } catch {
    // Private mode, or a value from a future version. Treat as "no name yet"
    // rather than throwing a visitor out of the product.
    return null;
  }
}

export function writeGuestIdentity(identity: GuestIdentity): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(GUEST_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage full or blocked. The name is cosmetic; losing it must not stop
    // the visitor reaching the workspace.
  }
}

export function clearGuestIdentity(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(GUEST_IDENTITY_KEY);
  } catch {
    // Nothing to recover from: the caller is already leaving.
  }
}
