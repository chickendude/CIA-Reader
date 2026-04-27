// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/require-user.js', () => ({
  resolveUser: vi.fn(async () => null),
}));

const { resolveServerTheme } = await import('./hooks.server.js');

type Event = Parameters<typeof resolveServerTheme>[0];

function makeEvent({
  userPref,
  cookie,
  hint,
}: {
  userPref?: 'system' | 'light' | 'dark';
  cookie?: string;
  hint?: string;
}): Event {
  const headers = new Headers();
  if (hint) headers.set('sec-ch-prefers-color-scheme', hint);
  return {
    locals: userPref !== undefined ? { user: { themePreference: userPref } } : {},
    cookies: {
      get: (name: string) => (name === 'cia_theme' ? cookie : undefined),
    },
    request: { headers },
  } as unknown as Event;
}

describe('resolveServerTheme', () => {
  it("uses the authenticated user's preference before anything else", () => {
    // Even a conflicting cookie is overridden — users.themePreference is the source of truth.
    const theme = resolveServerTheme(
      makeEvent({ userPref: 'dark', cookie: 'light', hint: 'light' }),
    );
    expect(theme).toBe('dark');
  });

  it("resolves 'system' against the Sec-CH-Prefers-Color-Scheme hint", () => {
    expect(resolveServerTheme(makeEvent({ userPref: 'system', hint: 'dark' }))).toBe('dark');
    expect(resolveServerTheme(makeEvent({ userPref: 'system', hint: 'light' }))).toBe('light');
  });

  it('falls back to the cookie when no user is present', () => {
    expect(resolveServerTheme(makeEvent({ cookie: 'dark' }))).toBe('dark');
    expect(resolveServerTheme(makeEvent({ cookie: 'light' }))).toBe('light');
  });

  it('ignores malformed cookie values', () => {
    // 'blurple' isn't a valid preference; fall through to the hint (default: light).
    expect(resolveServerTheme(makeEvent({ cookie: 'blurple' }))).toBe('light');
    expect(resolveServerTheme(makeEvent({ cookie: 'blurple', hint: 'dark' }))).toBe('dark');
  });

  it("defaults to 'light' when no source has an opinion", () => {
    expect(resolveServerTheme(makeEvent({}))).toBe('light');
  });
});
