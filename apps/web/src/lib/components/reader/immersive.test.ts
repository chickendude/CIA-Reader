import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  IMMERSIVE_ATTR,
  IMMERSIVE_STORAGE_KEY,
  isImmersiveAttributeSet,
  readPersistedImmersive,
  setImmersiveAttribute,
  writePersistedImmersive,
} from './immersive.js';

beforeEach(() => {
  sessionStorage.clear();
  document.documentElement.removeAttribute(IMMERSIVE_ATTR);
});

afterEach(() => {
  sessionStorage.clear();
  document.documentElement.removeAttribute(IMMERSIVE_ATTR);
});

describe('immersive — sessionStorage helpers', () => {
  it('readPersistedImmersive returns false when nothing is stored', () => {
    expect(readPersistedImmersive()).toBe(false);
  });

  it('readPersistedImmersive returns true when sessionStorage has the flag', () => {
    sessionStorage.setItem(IMMERSIVE_STORAGE_KEY, '1');
    expect(readPersistedImmersive()).toBe(true);
  });

  it('writePersistedImmersive(true) writes the flag', () => {
    writePersistedImmersive(true);
    expect(sessionStorage.getItem(IMMERSIVE_STORAGE_KEY)).toBe('1');
  });

  it('writePersistedImmersive(false) removes the flag (so default reverts to off)', () => {
    sessionStorage.setItem(IMMERSIVE_STORAGE_KEY, '1');
    writePersistedImmersive(false);
    expect(sessionStorage.getItem(IMMERSIVE_STORAGE_KEY)).toBeNull();
  });

  it('treats non-"1" values as off', () => {
    sessionStorage.setItem(IMMERSIVE_STORAGE_KEY, 'true');
    expect(readPersistedImmersive()).toBe(false);
    sessionStorage.setItem(IMMERSIVE_STORAGE_KEY, '0');
    expect(readPersistedImmersive()).toBe(false);
  });
});

describe('immersive — DOM attribute helpers', () => {
  it('setImmersiveAttribute(true) puts the flag on <html>', () => {
    setImmersiveAttribute(true);
    expect(document.documentElement.getAttribute(IMMERSIVE_ATTR)).toBe('1');
    expect(isImmersiveAttributeSet()).toBe(true);
  });

  it('setImmersiveAttribute(false) clears the flag', () => {
    setImmersiveAttribute(true);
    setImmersiveAttribute(false);
    expect(document.documentElement.hasAttribute(IMMERSIVE_ATTR)).toBe(false);
    expect(isImmersiveAttributeSet()).toBe(false);
  });

  it('isImmersiveAttributeSet returns false when the attribute is absent', () => {
    expect(isImmersiveAttributeSet()).toBe(false);
  });
});
