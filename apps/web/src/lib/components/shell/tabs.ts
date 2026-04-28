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

/** Icon names supported by the shell. New entries map to a glyph in
 * `AppShell.svelte`'s icon switch. */
export type TabIcon =
  | 'home'
  | 'library'
  | 'upload'
  | 'words'
  | 'profile'
  | 'signin';

/** Section heading the tab clusters under in the desktop rail (T-5.11).
 * `null` (the default) renders the tab outside any section, above the
 * first grouped tab. */
export type TabSection = 'Read' | 'Track' | 'You' | null;

export interface Tab {
  id: string;
  label: string;
  href: string;
  auth: TabAuth;
  /** Used for highlighting; a tab is active if the current pathname starts with any of these. */
  match: string[];
  icon?: TabIcon;
  section?: TabSection;
}

export const TABS: readonly Tab[] = [
  { id: 'home', label: 'Home', href: '/', auth: 'any', match: ['/'], icon: 'home' },
  {
    id: 'library',
    label: 'Library',
    href: '/library',
    auth: 'any',
    // /reader/[textId] is reached by clicking a library card, so the
    // Library tab should stay highlighted while reading.
    match: ['/library', '/reader'],
    icon: 'library',
    section: 'Read',
  },
  {
    id: 'upload',
    label: 'Upload',
    href: '/upload',
    auth: 'authenticated',
    match: ['/upload'],
    icon: 'upload',
    section: 'Read',
  },
  {
    id: 'words',
    label: 'Words',
    href: '/words',
    auth: 'authenticated',
    match: ['/words'],
    icon: 'words',
    section: 'Track',
  },
  {
    id: 'profile',
    label: 'Profile',
    href: '/profile',
    auth: 'authenticated',
    match: ['/profile'],
    icon: 'profile',
    section: 'You',
  },
  {
    id: 'signin',
    label: 'Sign in',
    href: '/login',
    auth: 'anonymous',
    match: ['/login'],
    icon: 'signin',
  },
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

/** Group visible tabs by their `section` for the desktop rail (T-5.11).
 * Tabs with `section: null | undefined` go in the unsectioned bucket
 * (rendered above the first sectioned group). Order within a section
 * preserves the order in `tabs`. */
export function groupTabsBySection(
  tabs: readonly Tab[],
): { section: TabSection; tabs: Tab[] }[] {
  const order: TabSection[] = [null, 'Read', 'Track', 'You'];
  const buckets = new Map<TabSection, Tab[]>();
  for (const s of order) buckets.set(s, []);
  for (const t of tabs) {
    const s = t.section ?? null;
    const bucket = buckets.get(s);
    if (bucket) bucket.push(t);
    else buckets.set(s, [t]);
  }
  return order
    .map((section) => ({ section, tabs: buckets.get(section) ?? [] }))
    .filter((g) => g.tabs.length > 0);
}
