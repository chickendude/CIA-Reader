import { describe, expect, it } from 'vitest';
import { TABS, getActiveTabId, visibleTabs, type Tab } from './tabs.js';

describe('visibleTabs', () => {
  it('shows authenticated + any tabs to signed-in users', () => {
    const shown = visibleTabs(TABS, true).map((t) => t.id);
    expect(shown).toContain('home');
    expect(shown).toContain('upload');
    expect(shown).toContain('profile');
    expect(shown).not.toContain('signin');
  });

  it('shows anonymous + any tabs to signed-out users', () => {
    const shown = visibleTabs(TABS, false).map((t) => t.id);
    expect(shown).toContain('home');
    expect(shown).toContain('signin');
    expect(shown).not.toContain('upload');
    expect(shown).not.toContain('profile');
  });

  it('highlights the upload tab on /texts/* paths so users land back on it', () => {
    expect(getActiveTabId('/upload', TABS)).toBe('upload');
    expect(getActiveTabId('/texts/abc-123', TABS)).toBe('upload');
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
