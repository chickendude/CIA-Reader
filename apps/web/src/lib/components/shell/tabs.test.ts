import { describe, expect, it } from 'vitest';
import {
  TABS,
  getActiveTabId,
  groupTabsBySection,
  visibleTabs,
  type Tab,
} from './tabs.js';

describe('visibleTabs', () => {
  it('shows authenticated + any tabs to signed-in users', () => {
    const shown = visibleTabs(TABS, true).map((t) => t.id);
    expect(shown).toContain('home');
    expect(shown).toContain('library');
    expect(shown).toContain('upload');
    expect(shown).toContain('profile');
    expect(shown).not.toContain('signin');
  });

  it('shows the public library tab to signed-out users', () => {
    const shown = visibleTabs(TABS, false).map((t) => t.id);
    expect(shown).toContain('library');
  });

  it('shows anonymous + any tabs to signed-out users', () => {
    const shown = visibleTabs(TABS, false).map((t) => t.id);
    expect(shown).toContain('home');
    expect(shown).toContain('signin');
    expect(shown).not.toContain('upload');
    expect(shown).not.toContain('profile');
  });

  it('highlights the library tab on /reader/* paths so the reader stays under Library', () => {
    expect(getActiveTabId('/library', TABS)).toBe('library');
    expect(getActiveTabId('/reader/abc-123', TABS)).toBe('library');
  });

  it('highlights the upload tab on /upload', () => {
    expect(getActiveTabId('/upload', TABS)).toBe('upload');
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
    const groups = groupTabsBySection(visibleTabs(TABS, true));
    // home has no section, so it's first.
    expect(groups[0]).toMatchObject({ section: null });
    expect(groups[0]!.tabs.map((t) => t.id)).toEqual(['home']);
  });

  it('groups Read-section tabs (Library + Upload) together', () => {
    const groups = groupTabsBySection(visibleTabs(TABS, true));
    const read = groups.find((g) => g.section === 'Read');
    expect(read).toBeDefined();
    expect(read!.tabs.map((t) => t.id)).toEqual(['library', 'upload']);
  });

  it("groups Profile under 'You'", () => {
    const groups = groupTabsBySection(visibleTabs(TABS, true));
    const you = groups.find((g) => g.section === 'You');
    expect(you!.tabs.map((t) => t.id)).toEqual(['profile']);
  });

  it('skips empty sections so signed-out users do not see a stray You header', () => {
    const groups = groupTabsBySection(visibleTabs(TABS, false));
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
