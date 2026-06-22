import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FLAG_UNDEFINED_ATTR,
  FLAG_UNDEFINED_STORAGE_KEY,
  isFlagUndefinedAttributeSet,
  readPersistedFlagUndefined,
  setFlagUndefinedAttribute,
  writePersistedFlagUndefined,
} from './undefined-highlight.js';

// The CI/node env's global `localStorage` (Web Storage shim) isn't a
// dependable jsdom Storage — `.clear()` may be missing. Stub a plain
// in-memory fake, the same pattern WordPopup.test.ts uses.
function fakeStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    store,
    api: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(FLAG_UNDEFINED_ATTR);
});

describe('undefined-highlight — localStorage helpers', () => {
  it('readPersistedFlagUndefined returns false when nothing is stored', () => {
    vi.stubGlobal('localStorage', fakeStorage().api);
    expect(readPersistedFlagUndefined()).toBe(false);
  });

  it('readPersistedFlagUndefined returns true when the flag is stored', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({ [FLAG_UNDEFINED_STORAGE_KEY]: '1' }).api,
    );
    expect(readPersistedFlagUndefined()).toBe(true);
  });

  it('writePersistedFlagUndefined(true) writes the flag', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage.api);
    writePersistedFlagUndefined(true);
    expect(storage.store.get(FLAG_UNDEFINED_STORAGE_KEY)).toBe('1');
  });

  it('writePersistedFlagUndefined(false) removes the flag (default reverts to off)', () => {
    const storage = fakeStorage({ [FLAG_UNDEFINED_STORAGE_KEY]: '1' });
    vi.stubGlobal('localStorage', storage.api);
    writePersistedFlagUndefined(false);
    expect(storage.store.has(FLAG_UNDEFINED_STORAGE_KEY)).toBe(false);
  });

  it('treats non-"1" values as off', () => {
    const storage = fakeStorage({ [FLAG_UNDEFINED_STORAGE_KEY]: 'true' });
    vi.stubGlobal('localStorage', storage.api);
    expect(readPersistedFlagUndefined()).toBe(false);
    storage.store.set(FLAG_UNDEFINED_STORAGE_KEY, '0');
    expect(readPersistedFlagUndefined()).toBe(false);
  });

  it('persists across a write/read round trip', () => {
    vi.stubGlobal('localStorage', fakeStorage().api);
    writePersistedFlagUndefined(true);
    expect(readPersistedFlagUndefined()).toBe(true);
    writePersistedFlagUndefined(false);
    expect(readPersistedFlagUndefined()).toBe(false);
  });

  it('returns false (never throws) when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readPersistedFlagUndefined()).toBe(false);
    // Writing is a silent no-op rather than a crash.
    expect(() => writePersistedFlagUndefined(true)).not.toThrow();
  });
});

describe('undefined-highlight — DOM attribute helpers', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(FLAG_UNDEFINED_ATTR);
  });

  it('setFlagUndefinedAttribute(true) puts the flag on <html>', () => {
    setFlagUndefinedAttribute(true);
    expect(document.documentElement.getAttribute(FLAG_UNDEFINED_ATTR)).toBe('1');
    expect(isFlagUndefinedAttributeSet()).toBe(true);
  });

  it('setFlagUndefinedAttribute(false) clears the flag', () => {
    setFlagUndefinedAttribute(true);
    setFlagUndefinedAttribute(false);
    expect(document.documentElement.hasAttribute(FLAG_UNDEFINED_ATTR)).toBe(false);
    expect(isFlagUndefinedAttributeSet()).toBe(false);
  });

  it('isFlagUndefinedAttributeSet reflects only the exact "1" value', () => {
    document.documentElement.setAttribute(FLAG_UNDEFINED_ATTR, '0');
    expect(isFlagUndefinedAttributeSet()).toBe(false);
  });
});
