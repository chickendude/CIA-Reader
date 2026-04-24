import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import {
  SESSION_COOKIE,
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from './sessions.js';

function makeCookies(): Cookies & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const set = vi.fn((name: string, value: string) => {
    store.set(name, value);
  });
  const get = vi.fn((name: string) => store.get(name));
  const del = vi.fn((name: string) => {
    store.delete(name);
  });
  return {
    store,
    set,
    get,
    delete: del,
    getAll: vi.fn(() => [...store.entries()].map(([name, value]) => ({ name, value }))),
    serialize: vi.fn(() => ''),
  } as unknown as Cookies & { store: Map<string, string> };
}

describe('session cookie helpers', () => {
  it('setSessionCookie sets an HttpOnly, SameSite=Lax cookie on "/"', () => {
    const cookies = makeCookies();
    const expires = new Date('2099-01-01');
    setSessionCookie(cookies, 'my-token', expires, false);
    const setCall = (cookies.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!setCall) throw new Error('cookies.set was not invoked');
    const [name, value, opts] = setCall;
    expect(name).toBe(SESSION_COOKIE);
    expect(value).toBe('my-token');
    expect(opts).toMatchObject({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      expires,
    });
  });

  it('setSessionCookie passes through the secure flag', () => {
    const cookies = makeCookies();
    setSessionCookie(cookies, 'tok', new Date('2099-01-01'), true);
    const call = (cookies.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const [, , opts] = call;
    expect(opts.secure).toBe(true);
  });

  it('readSessionCookie returns whatever Cookies.get returns', () => {
    const cookies = makeCookies();
    cookies.store.set(SESSION_COOKIE, 'stored-token');
    expect(readSessionCookie(cookies)).toBe('stored-token');
  });

  it('clearSessionCookie deletes the session cookie', () => {
    const cookies = makeCookies();
    clearSessionCookie(cookies, true);
    const deleteMock = cookies.delete as unknown as ReturnType<typeof vi.fn>;
    expect(deleteMock).toHaveBeenCalledWith(
      SESSION_COOKIE,
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', secure: true }),
    );
  });
});
