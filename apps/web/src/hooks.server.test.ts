// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const resolveUserMock = vi.fn(async (): Promise<unknown> => null);
vi.mock('$lib/server/auth/require-user.js', () => ({
  resolveUser: (...a: unknown[]) => resolveUserMock(...(a as [])),
}));

const { resolveServerTheme, handle } = await import('./hooks.server.js');

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

  it("honors a 'sepia' cookie for logged-out visitors", () => {
    expect(resolveServerTheme(makeEvent({ cookie: 'sepia' }))).toBe('sepia');
  });
});

describe('handle — onboarding redirect', () => {
  function makeHandleEvent(pathname: string) {
    return {
      locals: {},
      cookies: { get: () => undefined },
      request: { headers: new Headers() },
      url: new URL(`http://x${pathname}`),
    } as unknown as Parameters<typeof handle>[0]['event'];
  }

  it('bounces a signed-in, never-onboarded user from / to /onboarding', async () => {
    resolveUserMock.mockResolvedValueOnce({ id: 'u1', onboardedAt: null });
    const event = makeHandleEvent('/');
    await expect(
      handle({ event, resolve: vi.fn(async () => new Response()) as never }),
    ).rejects.toMatchObject({ status: 303, location: '/onboarding' });
  });

  it('does not bounce when the user is already onboarded', async () => {
    resolveUserMock.mockResolvedValueOnce({ id: 'u1', onboardedAt: new Date() });
    const resolve = vi.fn(async () => new Response('ok'));
    const event = makeHandleEvent('/');
    const res = await handle({ event, resolve: resolve as never });
    expect(res).toBeInstanceOf(Response);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('does not bounce on /onboarding itself (no infinite loop)', async () => {
    resolveUserMock.mockResolvedValueOnce({ id: 'u1', onboardedAt: null });
    const resolve = vi.fn(async () => new Response('onboarding page'));
    const event = makeHandleEvent('/onboarding');
    const res = await handle({ event, resolve: resolve as never });
    expect(res).toBeInstanceOf(Response);
    expect(resolve).toHaveBeenCalledOnce();
  });
});
