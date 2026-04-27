import { describe, expect, it } from 'vitest';

import { generateToken, hashToken } from './tokens.js';

describe('generateToken', () => {
  it('produces a base64url string (no +, /, or = characters)', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces ≥ 256 bits of entropy by default', () => {
    const token = generateToken();
    // 32 raw bytes → 43 base64url chars (no padding).
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('does not repeat across successive calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateToken());
    expect(seen.size).toBe(100);
  });

  it('honors a custom byte length', () => {
    const token = generateToken(16);
    // 16 bytes → 22 base64url chars.
    expect(token.length).toBeGreaterThanOrEqual(22);
    expect(token.length).toBeLessThan(32);
  });
});

describe('hashToken', () => {
  it('is deterministic — same input always yields the same digest', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it('yields a 64-char hex string (SHA-256)', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs produce different digests', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('matches a known SHA-256 digest', () => {
    // Reference: `printf hello | shasum -a 256`
    expect(hashToken('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
