// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { signAccessToken, verifyAccessToken, ACCESS_TOKEN_TTL } from './access-token.js';

describe('access token JWTs', () => {
  it('round-trips sign → verify with the user id as subject', async () => {
    const jwt = await signAccessToken('user-abc');
    expect(jwt.split('.').length).toBe(3);
    const payload = await verifyAccessToken(jwt);
    expect(payload).toEqual({ sub: 'user-abc' });
  });

  it('returns null for malformed tokens', async () => {
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
  });

  it('returns null when the signature is tampered with', async () => {
    const jwt = await signAccessToken('user-123');
    const parts = jwt.split('.');
    // Flip a character in the signature segment.
    parts[2] = parts[2].split('').reverse().join('');
    const tampered = parts.join('.');
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it('exports the TTL as a sane interactive-login window', () => {
    expect(ACCESS_TOKEN_TTL).toBeGreaterThan(60); // >1 min
    expect(ACCESS_TOKEN_TTL).toBeLessThanOrEqual(60 * 60); // ≤1 hour
  });
});
