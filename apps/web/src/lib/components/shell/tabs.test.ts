import { describe, expect, it } from 'vitest';
import {
  TABS,
  getActiveTabId,
  groupTabsBySection,
  visibleTabs,
  type Tab,
  type Viewer,
} from './tabs.js';

const ANON: Viewer = { authenticated: false, role: null };
const USER: Viewer = { authenticated: true, role: 'user' };
const CURATOR: Viewer = { authenticated: true, role: 'curator' };
const ADMIN: Viewer = { authenticated: true, role: 'admin' };

describe('visibleTabs', () => {
  it('shows authenticated + any tabs to signed-in users', () => {
    const shown = visibleTabs(TABS, USER).map((t) => t.id);
    expect(shown).toContain('home');
    expect(shown).toContain('library');
    expect(shown).toContain('upload');
    expect(shown).toContain('profile');
    expect(shown).not.toContain('signin');
  });

  it('shows the public library tab to signed-out users', () => {
    const shown = visibleTabs(TABS, ANON).map((t) => t.id);
    expect(shown).toContain('library');
  });

  it('shows anonymous + any tabs to signed-out users', () => {
    const shown = visibleTabs(TABS, ANON).map((t) => t.id);
    expect(shown).toContain('home');
    expect(shown).toContain('signin');
    expect(shown).not.toContain('upload');
    expect(shown).not.toContain('profile');
  });

  it('hides the moderation tab from regular signed-in users', () => {
    expect(visibleTabs(TABS, USER).map((t) => t.id)).not.toContain('moderation');
  });

  it('shows the moderation tab to curators and admins', () => {
    expect(visibleTabs(TABS, CURATOR).map((t) => t.id)).toContain('moderation');
    expect(visibleTabs(TABS, ADMIN).map((t) => t.id)).toContain('moderation');
  });

  it('hides the moderation tab from signed-out users even if a stale role leaks through', () => {
    // Defensive: if the layout ever serializes a role for a viewer
    // whose session has expired, the unauthenticated check still
    // wins.
    const stale: Viewer = { authenticated: false, role: 'admin' };
    expect(visibleTabs(TABS, stale).map((t) => t.id)).not.toContain('moderation');
  });

  it('highlights the library tab on /reader/* paths so the reader stays under Library', () => {
    expect(getActiveTabId('/library', TABS)).toBe('library');
    expect(getActiveTabId('/reader/abc-123', TABS)).toBe('library');
  });

  it('highlights the upload tab on /upload', () => {
    expect(getActiveTabId('/upload', TABS)).toBe('upload');
  });

  it('highlights the moderation tab across every /moderation/* sub-route', () => {
    expect(getActiveTabId('/moderation', TABS)).toBe('moderation');
    expect(getActiveTabId('/moderation/dictionary', TABS)).toBe('moderation');
    expect(getActiveTabId('/moderation/dictionary/sources', TABS)).toBe('moderation');
  });
});

describe('getActiveTabId', () => {
  it('matches the home tab only on the exact root path', () => {
    expect(getActiveTabId('/', TABS)).toBe('home');
    // A deeper path must not collapse back to 'home' just because every
    // pathname starts with '/'.
    expect(getActiveTabId('/profile', TABS)).not.toBe('home');
  });

  it('matches a tab on its exact path', () => {
    expect(getActiveTabId('/profile', TABS)).toBe('profile');
  });

  it('matches a tab on a sub-path of its declared match', () => {
    expect(getActiveTabId('/profile/languages', TABS)).toBe('profile');
  });

  it('returns null for a pathname no tab claims', () => {
    expect(getActiveTabId('/nowhere', TABS)).toBeNull();
  });

  it('prefers the longer prefix when multiple tabs match', () => {
    const custom: Tab[] = [
      { id: 'root', label: 'Root', href: '/', auth: 'any', match: ['/'] },
      { id: 'admin', label: 'Admin', href: '/admin', auth: 'any', match: ['/admin'] },
      {
        id: 'admin-reports',
        label: 'Reports',
        href: '/admin/reports',
        auth: 'any',
        match: ['/admin/reports'],
      },
    ];
    expect(getActiveTabId('/admin/reports', custom)).toBe('admin-reports');
    expect(getActiveTabId('/admin/something-else', custom)).toBe('admin');
  });
});

describe('groupTabsBySection', () => {
  it('places unsectioned tabs in their own bucket above the sectioned ones', () => {
    const groups = groupTabsBySection(visibleTabs(TABS, USER));
    // home has no section, so it's first.
    expect(groups[0]).toMatchObject({ section: null });
    expect(groups[0]!.tabs.map((t) => t.id)).toEqual(['home']);
  });

  it('groups Read-section tabs (Library + Upload) together', () => {
    const groups = groupTabsBySection(visibleTabs(TABS, USER));
    const read = groups.find((g) => g.section === 'Read');
    expect(read).toBeDefined();
    expect(read!.tabs.map((t) => t.id)).toEqual(['library', 'upload']);
  });

  it("groups Words under 'Track' (T-10.6)", () => {
    const groups = groupTabsBySection(visibleTabs(TABS, USER));
    const track = groups.find((g) => g.section === 'Track');
    expect(track).toBeDefined();
    expect(track!.tabs.map((t) => t.id)).toEqual(['words']);
  });

  it("groups Profile under 'You'", () => {
    const groups = groupTabsBySection(visibleTabs(TABS, USER));
    const you = groups.find((g) => g.section === 'You');
    expect(you!.tabs.map((t) => t.id)).toEqual(['profile']);
  });

  it('appends the moderation tab to the You section for curators/admins', () => {
    const groups = groupTabsBySection(visibleTabs(TABS, ADMIN));
    const you = groups.find((g) => g.section === 'You');
    expect(you!.tabs.map((t) => t.id)).toEqual(['profile', 'moderation']);
  });

  it('skips empty sections so signed-out users do not see a stray Track / You header', () => {
    const groups = groupTabsBySection(visibleTabs(TABS, ANON));
    expect(groups.find((g) => g.section === 'Track')).toBeUndefined();
    expect(groups.find((g) => g.section === 'You')).toBeUndefined();
  });

  it('preserves source order within a section', () => {
    const custom: Tab[] = [
      { id: 'b', label: 'B', href: '/b', auth: 'any', match: ['/b'], section: 'Read' },
      { id: 'a', label: 'A', href: '/a', auth: 'any', match: ['/a'], section: 'Read' },
    ];
    expect(groupTabsBySection(custom)[0]!.tabs.map((t) => t.id)).toEqual(['b', 'a']);
  });
});
