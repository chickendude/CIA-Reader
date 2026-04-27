/**
 * Definition of the top/bottom navigation tabs used by AppShell.
 *
 * A single source of truth — adding a new top-level destination (Library,
 * Groups, Collections, …) means adding an entry here, not editing every
 * layout file that references navigation.
 *
 * `auth`: 'any' shows to everyone, 'authenticated' only to signed-in users,
 *          'anonymous' only to signed-out users.
 */
export type TabAuth = 'any' | 'authenticated' | 'anonymous';

export interface Tab {
  id: string;
  label: string;
  href: string;
  auth: TabAuth;
  /** Used for highlighting; a tab is active if the current pathname starts with any of these. */
  match: string[];
}

export const TABS: readonly Tab[] = [
  { id: 'home', label: 'Home', href: '/', auth: 'any', match: ['/'] },
  {
    id: 'profile',
    label: 'Profile',
    href: '/profile',
    auth: 'authenticated',
    match: ['/profile'],
  },
  { id: 'signin', label: 'Sign in', href: '/login', auth: 'anonymous', match: ['/login'] },
];

export function visibleTabs(tabs: readonly Tab[], isAuthenticated: boolean): Tab[] {
  return tabs.filter((t) => {
    if (t.auth === 'any') return true;
    if (t.auth === 'authenticated') return isAuthenticated;
    return !isAuthenticated;
  });
}

export function getActiveTabId(pathname: string, tabs: readonly Tab[]): string | null {
  // Exact '/' must not match every sub-route; special-case it. Other tabs
  // use longest-prefix-wins so '/profile/edit' highlights the Profile tab.
  let best: { id: string; len: number } | null = null;
  for (const t of tabs) {
    for (const m of t.match) {
      const matches = m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`);
      if (matches && (best === null || m.length > best.len)) {
        best = { id: t.id, len: m.length };
      }
    }
  }
  return best?.id ?? null;
}
