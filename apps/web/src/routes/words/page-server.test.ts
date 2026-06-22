import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the drizzle query chain so we can assert on what the loader
// asks for (auth-gated, language filter, status filter, search) without
// hitting a real database.
type StubRow = {
  lemmaId: string;
  language: string;
  headword: string;
  pos: string;
  glossDefault: string | null;
  status: 'unknown' | 'learning' | 'known' | 'ignored';
  updatedAt: Date;
};

const queryRows = vi.fn<() => Promise<StubRow[]>>();

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select() {
      return {
        from() {
          return {
            innerJoin() {
              return {
                where() {
                  return {
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
  });

  afterEach(() => {
    vi.resetModules();
  });

  type LoadInput = {
    locals: { user: { id: string } | null };
    url: URL;
    currentLanguage: string | null;
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
        language: 'hi',
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
    expect(data?.filters).toEqual({ language: 'hi', status: 'all', q: '' });
    expect(data?.truncated).toBe(false);
  });

  it('scopes the list to the current language (#436)', async () => {
    const data = await callLoad({ currentLanguage: 'mr' });
    expect(data?.filters.language).toBe('mr');
    expect(data?.languageName).toBe('मराठी');
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

  it('flags truncation when the query returns the row limit', async () => {
    queryRows.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({
        lemmaId: `L${i}`,
        language: 'hi',
        headword: `word${i}`,
        pos: 'noun',
        glossDefault: null,
        status: 'learning' as const,
        updatedAt: new Date(),
      })),
    );
    const data = await callLoad({});
    expect(data?.truncated).toBe(true);
  });
});
