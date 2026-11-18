// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashToken } from './tokens.js';

const rows: Array<Record<string, unknown>> = [];
function chainable(...args: unknown[]) {
  void args;
  return chain;
}
const chain = {
  from: vi.fn(chainable),
  innerJoin: vi.fn(chainable),
  where: vi.fn(chainable),
  orderBy: vi.fn(chainable),
  limit: vi.fn((...args: unknown[]) => {
    void args;
    return rows;
  }),
  values: vi.fn(chainable),
  onConflictDoNothing: vi.fn(chainable),
  set: vi.fn(chainable),
  returning: vi.fn((...args: unknown[]) => {
    void args;
    return rows;
  }),
};
const fakeDb = {
  insert: vi.fn(() => chain),
  select: vi.fn(() => chain),
  update: vi.fn(() => chain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    personalApiKeys: {
      id: 'personal_api_keys.id',
      userId: 'personal_api_keys.user_id',
      name: 'personal_api_keys.name',
      keyHash: 'personal_api_keys.key_hash',
      keyPrefix: 'personal_api_keys.key_prefix',
      lastUsedAt: 'personal_api_keys.last_used_at',
      revokedAt: 'personal_api_keys.revoked_at',
      createdAt: 'personal_api_keys.created_at',
    },
    users: {
      id: 'users.id',
    },
  },
}));

const {
  PERSONAL_API_KEY_PREFIX,
  createPersonalApiKey,
  normalizePersonalApiKey,
  resolvePersonalApiKey,
  revokePersonalApiKey,
} = await import('./personal-api-keys.js');

function resetAll() {
  rows.length = 0;
  for (const fn of Object.values(chain)) fn.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.select.mockClear();
  fakeDb.update.mockClear();
}

describe('personal API keys', () => {
  beforeEach(() => resetAll());

  it('normalizes only CIA Reader personal key secrets', () => {
    expect(normalizePersonalApiKey(` ${PERSONAL_API_KEY_PREFIX}abc `)).toBe(
      `${PERSONAL_API_KEY_PREFIX}abc`,
    );
    expect(normalizePersonalApiKey('not-a-key')).toBeNull();
  });

  it('creates a key once and stores only a hash plus prefix', async () => {
    rows.push({ id: 'key-1' });
    const key = await createPersonalApiKey('u1');
    if (!key) throw new Error('Expected a generated key');
    expect(key.startsWith(PERSONAL_API_KEY_PREFIX)).toBe(true);
    expect(chain.values).toHaveBeenCalledWith({
      userId: 'u1',
      keyHash: hashToken(key),
      keyPrefix: key.slice(0, 18),
    });
  });

  it('returns no secret when the user already has an active key', async () => {
    await expect(createPersonalApiKey('u1')).resolves.toBeNull();
  });

  it('revokes only an active key owned by the user', async () => {
    rows.push({ id: 'key-1' });

    await expect(revokePersonalApiKey('u1', 'key-1')).resolves.toBe(true);
    expect(fakeDb.update).toHaveBeenCalledOnce();
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.revokedAt).toBeInstanceOf(Date);
  });

  it('resolves an active personal key to its user and records last use', async () => {
    rows.push({
      apiKey: { id: 'key-1' },
      user: { id: 'u1', email: 'a@b.c' },
    });

    const user = await resolvePersonalApiKey(`${PERSONAL_API_KEY_PREFIX}secret`);

    expect(user).toMatchObject({ id: 'u1' });
    expect(fakeDb.select).toHaveBeenCalledOnce();
    expect(fakeDb.update).toHaveBeenCalledOnce();
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.lastUsedAt).toBeInstanceOf(Date);
  });
});
