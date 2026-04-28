import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthResponse } from '$lib/server/nlp-client.js';

const health = vi.fn<() => Promise<HealthResponse>>();

vi.mock('$lib/server/nlp-client.js', () => ({
  nlpClient: {
    health: (...args: []) => health(...args),
    process: vi.fn(),
  },
}));

// Mock the userLanguages query — the home loader now reads
// `knownWordsCountCache` per language for signed-in users (T-5.12).
const knownRows = vi.fn<
  () => Promise<Array<{ language: string; knownWordsCountCache: number }>>
>();
vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select() {
      return {
        from() {
          return {
            where: () => knownRows(),
          };
        },
      };
    },
  },
}));

describe('root +page.server.ts load', () => {
  beforeEach(() => {
    health.mockReset();
    knownRows.mockReset();
    knownRows.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function callLoad(locals: Record<string, unknown>) {
    const { load } = await import('./+page.server.js');
    const data = await load({ locals } as unknown as Parameters<typeof load>[0]);
    if (!data) throw new Error('load returned void');
    return data;
  }

  it("reports NLP 'ok' and lists supported languages when healthy", async () => {
    health.mockResolvedValue({ status: 'ok', languages: ['hi', 'mr', 'or'] });
    const data = await callLoad({});
    expect(data.nlpStatus).toBe('ok');
    expect(data.nlpLanguages).toEqual(['hi', 'mr', 'or']);
    expect(data.languages.map((l: { code: string }) => l.code).sort()).toEqual(['hi', 'mr', 'or']);
    const hi = data.languages.find((l: { code: string }) => l.code === 'hi');
    expect(hi?.script).toBe('Deva');
    const or = data.languages.find((l: { code: string }) => l.code === 'or');
    expect(or?.script).toBe('Orya');
    expect(data.user).toBeNull();
  });

  it('pass-throughs the authenticated user when locals.user is set', async () => {
    health.mockResolvedValue({ status: 'ok', languages: ['hi', 'mr', 'or'] });
    const data = await callLoad({
      user: { id: 'u1', email: 'a@b.c', displayName: 'Alex', role: 'user' },
    });
    expect(data.user).toMatchObject({ id: 'u1', email: 'a@b.c' });
  });

  it("reports NLP 'down' (not a thrown error) when the health check rejects", async () => {
    health.mockRejectedValue(new Error('connect ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await callLoad({});
    expect(data.nlpStatus).toBe('down');
    expect(data.nlpLanguages).toEqual([]);
  });

  it('returns 0 known per language for signed-out visitors without querying user_languages', async () => {
    health.mockResolvedValue({ status: 'ok', languages: [] });
    const data = await callLoad({});
    expect(knownRows).not.toHaveBeenCalled();
    for (const l of data.languages) {
      expect(l.known).toBe(0);
    }
  });

  it('merges per-user knownWordsCountCache values onto the language list', async () => {
    health.mockResolvedValue({ status: 'ok', languages: [] });
    knownRows.mockResolvedValue([
      { language: 'hi', knownWordsCountCache: 1247 },
      { language: 'mr', knownWordsCountCache: 421 },
    ]);
    const data = await callLoad({
      user: { id: 'u1', email: 'a@b.c', displayName: 'Alex', role: 'user' },
    });
    const hi = data.languages.find((l: { code: string }) => l.code === 'hi');
    const mr = data.languages.find((l: { code: string }) => l.code === 'mr');
    const or = data.languages.find((l: { code: string }) => l.code === 'or');
    expect(hi?.known).toBe(1247);
    expect(mr?.known).toBe(421);
    // Languages without a row default to 0.
    expect(or?.known).toBe(0);
  });

  it("renders with zero counts (not a 500) when the user_languages query throws (T-5.19)", async () => {
    health.mockResolvedValue({ status: 'ok', languages: [] });
    knownRows.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await callLoad({
      user: { id: 'u1', email: 'a@b.c', displayName: 'Alex', role: 'user' },
    });
    expect(data.languages.every((l: { known: number }) => l.known === 0)).toBe(true);
  });

  it('skips the user_languages query when locals.user has no id (defensive guard)', async () => {
    health.mockResolvedValue({ status: 'ok', languages: [] });
    await callLoad({
      // intentionally malformed user record — should not crash, should
      // not call the query.
      user: { email: 'a@b.c', displayName: null, role: 'user' },
    });
    expect(knownRows).not.toHaveBeenCalled();
  });
});
