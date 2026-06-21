// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const getAnkiCards = vi.fn();
const buildApkg = vi.fn();

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));
vi.mock('$lib/server/anki.js', () => ({
  getAnkiCards: (...a: unknown[]) => getAnkiCards(...a),
  buildApkg: (...a: unknown[]) => buildApkg(...a),
}));

type Get = (typeof import('./+server.js'))['GET'];

const USER = { id: 'u1', role: 'user' as const };
const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function callGet(query: string, user: typeof USER | null = USER) {
  if (user) requireUser.mockResolvedValueOnce(user);
  else requireUser.mockImplementationOnce(() => {
    throw { status: 401 };
  });
  const { GET } = await import('./+server.js');
  const event = {
    url: new URL(`http://x/api/v1/me/anki/export${query}`),
    locals: { user },
  } as unknown as Parameters<Get>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  requireUser.mockReset();
  getAnkiCards.mockReset();
  buildApkg.mockReset();
});
afterEach(() => vi.resetModules());

const CARD = {
  word: 'etxe',
  pos: 'NOUN',
  definition: 'house',
  frequency: 1,
  minedSentence: 'Etxe bat.',
  samples: [],
};

describe('GET /api/v1/me/anki/export', () => {
  it('returns an .apkg attachment with a sanitized filename', async () => {
    getAnkiCards.mockResolvedValueOnce({ language: 'eu', cards: [CARD] });
    buildApkg.mockResolvedValueOnce(Buffer.from('PKfake'));
    const res = (await callGet(`?textId=${UUID}&deck=My%20Deck`)) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('My-Deck.apkg');
    expect(getAnkiCards).toHaveBeenCalledWith('u1', {
      textId: UUID,
      language: undefined,
      status: 'learning',
    });
    expect(buildApkg).toHaveBeenCalledWith('My Deck', [CARD]);
  });

  it('400s when neither textId nor language is given', async () => {
    const res = (await callGet('')) as { status: number };
    expect(res.status).toBe(400);
    expect(getAnkiCards).not.toHaveBeenCalled();
  });

  it('400s on an invalid text id', async () => {
    const res = (await callGet('?textId=not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
  });

  it('404s when there are no cards to export', async () => {
    getAnkiCards.mockResolvedValueOnce({ language: 'eu', cards: [] });
    const res = (await callGet(`?textId=${UUID}`)) as { status: number };
    expect(res.status).toBe(404);
    expect(buildApkg).not.toHaveBeenCalled();
  });

  it('401s when unauthenticated', async () => {
    const res = (await callGet(`?textId=${UUID}`, null)) as { status: number };
    expect(res.status).toBe(401);
  });
});
