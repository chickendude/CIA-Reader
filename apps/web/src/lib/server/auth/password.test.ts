// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

describe('hashPassword + verifyPassword', () => {
  it('verifies a freshly hashed password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery stapler')).toBe(false);
  });

  it('hashes of the same password are distinct (per-hash salt)', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'hunter2')).toBe(true);
    expect(await verifyPassword(b, 'hunter2')).toBe(true);
  });

  it('returns false (not throws) on a malformed stored hash', async () => {
    expect(await verifyPassword('not-actually-an-argon2-hash', 'anything')).toBe(false);
  });

  it('produces a recognizable argon2id PHC string', async () => {
    const hash = await hashPassword('x');
    expect(hash.startsWith('$argon2')).toBe(true);
  });
});
