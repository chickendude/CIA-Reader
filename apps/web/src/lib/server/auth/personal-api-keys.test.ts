// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    rows.push({
      id: 'key-1',
      userId: 'u1',
      name: 'Laptop',
      keyPrefix: `${PERSONAL_API_KEY_PREFIX}abcd`,
      createdAt: new Date('2026-04-30T00:00:00Z'),
      lastUsedAt: null,
      revokedAt: null,
    });

    const created = await createPersonalApiKey('u1', 'Laptop');

    expect(created.key).toMatch(new RegExp(`^${PERSONAL_API_KEY_PREFIX}`));
    expect(created.record).toMatchObject({ id: 'key-1', name: 'Laptop' });
    const values = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.userId).toBe('u1');
    expect(values.name).toBe('Laptop');
    expect(values.keyPrefix).toBe((values.keyPrefix as string).slice(0, 18));
    expect(values.keyHash).not.toBe(created.key);
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
