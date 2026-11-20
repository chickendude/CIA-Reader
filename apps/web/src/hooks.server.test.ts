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
      route: { id: pathname },
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

describe('reader chapter transfers', () => {
  const body = JSON.stringify({ tokens: Array(1000).fill('पाठ') });
  async function requestChapter(routeId: string, encoding: string, isDataRequest: boolean) {
    const event = {
      locals: {},
      cookies: { get: () => undefined },
      request: new Request('http://x', { headers: { 'accept-encoding': encoding } }),
      route: { id: routeId },
      url: new URL('http://x/reader/book'),
      isDataRequest,
    } as unknown as Event;
    const response = new Response(body, { headers: {
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'private, no-store',
    } });
    return handle({ event, resolve: vi.fn(async () => response) as never });
  }

  it.each([
    ['/reader/[textId]', true],
    ['/api/v1/texts/[id]/chapters/[idx]/tokens', false],
  ] as const)('compresses %s when the client accepts gzip', async (routeId, isDataRequest) => {
    const response = await requestChapter(routeId, 'br, gzip', isDataRequest);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Accept-Encoding');
    const decoded = response.body!.pipeThrough(new DecompressionStream('gzip'));
    expect(await new Response(decoded).text()).toBe(body);
  });

  it('honors clients that decline gzip', async () => {
    const response = await requestChapter('/reader/[textId]', 'br, gzip;q=0', true);
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(await response.text()).toBe(body);
  });
});
