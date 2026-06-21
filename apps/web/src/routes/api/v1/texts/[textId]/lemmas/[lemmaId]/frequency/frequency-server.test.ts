// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lemmaBookFrequency = vi.fn();

vi.mock('$lib/server/texts/book-frequency.js', () => ({
  lemmaBookFrequency: (...a: unknown[]) => lemmaBookFrequency(...a),
}));

type Get = (typeof import('./+server.js'))['GET'];

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function callGet(textId: string, lemmaId: string) {
  const { GET } = await import('./+server.js');
  const event = { params: { textId, lemmaId } } as unknown as Parameters<Get>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  lemmaBookFrequency.mockReset();
  lemmaBookFrequency.mockResolvedValue({ book: 5, text: 2 });
});
afterEach(() => vi.resetModules());

describe('GET /api/v1/texts/:textId/lemmas/:lemmaId/frequency', () => {
  it('returns book + text counts for valid ids', async () => {
    const res = (await callGet(UUID, UUID)) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ book: 5, text: 2 });
    expect(lemmaBookFrequency).toHaveBeenCalledWith(UUID, UUID);
  });

  it('400s on an invalid text id', async () => {
    const res = (await callGet('not-a-uuid', UUID)) as { status: number };
    expect(res.status).toBe(400);
    expect(lemmaBookFrequency).not.toHaveBeenCalled();
  });

  it('400s on an invalid lemma id', async () => {
    const res = (await callGet(UUID, 'not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
  });
});
