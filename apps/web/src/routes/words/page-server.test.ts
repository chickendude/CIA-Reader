import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// Mock the drizzle query chain so we can assert on what the loader
// asks for (auth-gated, language filter, status filter, search) without
// hitting a real database.
type StubRow = {
  lemmaId: string;
  headword: string;
  pos: string;
  glossDefault: string | null;
  status: 'unknown' | 'learning' | 'known' | 'ignored';
  updatedAt: Date;
};

const queryRows = vi.fn<() => Promise<StubRow[]>>();
const queryCounts = vi.fn<() => Promise<{ status: StubRow['status']; total: number }[]>>();
const whereClause = vi.fn<(clause: SQL) => void>();

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select() {
      return {
        from() {
          return {
            innerJoin() {
              return {
                where(clause: SQL) {
                  whereClause(clause);
                  return {
                    groupBy: () => queryCounts(),
                    orderBy() {
                      return {
                        limit: () => queryRows(),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  },
}));

describe('words +page.server.ts load', () => {
  beforeEach(() => {
    queryRows.mockReset();
    queryRows.mockResolvedValue([]);
    queryCounts.mockReset();
    queryCounts.mockResolvedValue([]);
    whereClause.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  type LoadInput = {
    locals: { user: { id: string } | null };
    url: URL;
    currentLanguage: string | null;
    preference: string;
  };

  async function callLoad(input: Partial<LoadInput> = {}) {
    const { load } = await import('./+page.server.js');
    const url = input.url ?? new URL('http://x/words');
    const locals = input.locals ?? { user: { id: 'u1' } };
    // #436: the words list scopes to the layout's resolved current language.
    const currentLanguage =
      'currentLanguage' in input ? input.currentLanguage : 'hi';
    return load({
      url,
      locals,
      parent: async () => ({ currentLanguage }),
      cookies: { get: () => input.preference },
    } as unknown as Parameters<typeof load>[0]);
  }

  it('redirects unauthenticated visitors to /login with a next param', async () => {
    await expect(
      callLoad({
        locals: { user: null },
        url: new URL('http://x/words?status=known'),
      }),
    ).rejects.toMatchObject({
      status: 303,
      location: expect.stringMatching(/^\/login\?next=/),
    });
  });

  it('returns rows + filters echo for an authenticated visitor', async () => {
    queryRows.mockResolvedValue([
      {
        lemmaId: 'L1',
        headword: 'प्रभात',
        pos: 'noun',
        glossDefault: 'dawn',
        status: 'learning',
        updatedAt: new Date('2026-04-25T12:00:00Z'),
      },
    ]);
    const data = await callLoad({});
    expect(data?.rows).toHaveLength(1);
    expect(data?.rows[0]?.headword).toBe('प्रभात');
    expect(data?.filters).toEqual({ language: 'hi', statuses: ['learning', 'known'], q: '' });
    expect(data?.truncated).toBe(false);
  });

  it('counts every matching status, including deselected words beyond the display limit', async () => {
    queryCounts.mockResolvedValue([
      { status: 'learning', total: 17 },
      { status: 'ignored', total: 250 },
    ]);
    const data = await callLoad({ currentLanguage: 'mr', url: new URL('http://x/words?q=test') });
    expect(data?.filters.language).toBe('mr');
    expect(data?.counts).toEqual({ learning: 17, known: 0, ignored: 250 });
    const dialect = new PgDialect();
    const list = dialect.sqlToQuery(whereClause.mock.calls[0]![0]);
    const counts = dialect.sqlToQuery(whereClause.mock.calls[1]![0]);
    for (const query of [list, counts]) {
      expect(query.sql).toContain('"lemmas"."language" = $2');
      expect(query.params.slice(0, 4)).toEqual(['u1', 'mr', '%test%', '%test%']);
    }
    expect(list.params.slice(4)).toEqual(['learning', 'known']);
    expect(counts.sql).toContain('"user_known_lemmas"."status" <> $5');
    expect(counts.params[4]).toBe('unknown');
  });

  it('directs the user to choose a language before querying vocabulary', async () => {
    await expect(callLoad({ currentLanguage: null })).rejects.toMatchObject({
      status: 303,
      location: '/',
    });
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('opens old New filter links on All and preserves the search', async () => {
    const data = await callLoad({ url: new URL('http://x/words?status=unknown&q=dawn') });
    expect(data?.filters).toEqual({ language: 'hi', statuses: ['learning', 'known', 'ignored'], q: 'dawn' });
  });

  it.each([
    { value: 'all', selected: ['learning', 'known', 'ignored'] },
    { value: 'none', selected: [] },
    { value: 'learning,ignored', selected: ['learning', 'ignored'] },
  ])('remembers $value when Words is reopened', async ({ value, selected }) => {
    const { actions } = await import('./+page.server.js');
    const set = vi.fn();
    const url = new URL('http://x/words?/filter');
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: value, q: 'dawn' }).toString(),
    });
    await expect(actions.filter({
      locals: { user: { id: 'u1' } }, cookies: { set }, request, url,
    } as unknown as Parameters<typeof actions.filter>[0])).rejects.toMatchObject({
      status: 303, location: `/words?${new URLSearchParams({ status: value, q: 'dawn' })}`,
    });
    expect(set).toHaveBeenCalledWith('words_statuses_u1', value, expect.objectContaining({ maxAge: expect.any(Number) }));
    const data = await callLoad({ preference: set.mock.calls[0]![1] });
    expect(data?.filters.statuses).toEqual(selected);
    if (!selected.length) {
      expect(new PgDialect().sqlToQuery(whereClause.mock.calls[0]![0]).sql).toContain('false');
    }
  });

  it("rejects an unknown status with 400", async () => {
    await expect(
      callLoad({ url: new URL('http://x/words?status=mystery') }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('passes the search query through unchanged + trimmed', async () => {
    const data = await callLoad({
      url: new URL('http://x/words?q=%20%20mood%20%20'),
    });
    expect(data?.filters.q).toBe('mood');
  });

  it.each([200, 201])('reports whether more than 200 matches exist (%i matches)', async (count) => {
    queryRows.mockResolvedValue(
      Array.from({ length: count }, (_, i) => ({
        lemmaId: `L${i}`,
        headword: `word${i}`,
        pos: 'noun',
        glossDefault: null,
        status: 'learning' as const,
        updatedAt: new Date(),
      })),
    );
    const data = await callLoad({});
    expect(data?.rows).toHaveLength(200);
    expect(data?.truncated).toBe(count > 200);
  });
});
