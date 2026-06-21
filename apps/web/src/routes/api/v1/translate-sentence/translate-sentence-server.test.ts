// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const sentenceAround = vi.fn();
const getCachedTranslation = vi.fn();
const setCachedTranslation = vi.fn();
const translateSentence = vi.fn();

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));
vi.mock('$lib/server/texts/sentences.js', () => ({
  sentenceAround: (...a: unknown[]) => sentenceAround(...a),
}));
vi.mock('$lib/server/sentence-translation-cache.js', () => ({
  getCachedTranslation: (...a: unknown[]) => getCachedTranslation(...a),
  setCachedTranslation: (...a: unknown[]) => setCachedTranslation(...a),
  hashSentence: () => 'hash',
}));
vi.mock('$lib/server/openai-client.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/openai-client.js')>(
    '$lib/server/openai-client.js',
  );
  return { ...actual, translateSentence: (...a: unknown[]) => translateSentence(...a) };
});

type Post = (typeof import('./+server.js'))['POST'];

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = { id: 'u1', role: 'user' as const };

async function callPost(body: unknown, user: typeof USER | null = USER) {
  if (user) requireUser.mockResolvedValueOnce(user);
  else requireUser.mockImplementationOnce(() => {
    throw { status: 401 };
  });
  const { POST } = await import('./+server.js');
  const event = {
    request: new Request('http://x/api/v1/translate-sentence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<Post>[0];
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  requireUser.mockReset();
  sentenceAround.mockReset();
  getCachedTranslation.mockReset();
  setCachedTranslation.mockReset();
  translateSentence.mockReset();
  sentenceAround.mockResolvedValue('Etxe bat.');
  getCachedTranslation.mockResolvedValue(null);
});
afterEach(() => vi.resetModules());

const VALID = { chapterId: UUID, tokenIdx: 5, language: 'eu' };

describe('POST /api/v1/translate-sentence', () => {
  it('serves a cache hit without calling OpenAI', async () => {
    getCachedTranslation.mockResolvedValueOnce('A house.');
    const res = (await callPost(VALID)) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sentence: 'Etxe bat.',
      translation: 'A house.',
      cached: true,
    });
    expect(translateSentence).not.toHaveBeenCalled();
  });

  it('translates + caches on a miss', async () => {
    translateSentence.mockResolvedValueOnce('A house.');
    const res = (await callPost(VALID)) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sentence: 'Etxe bat.',
      translation: 'A house.',
      cached: false,
    });
    expect(translateSentence).toHaveBeenCalledWith('Etxe bat.', 'eu', 'en');
    expect(setCachedTranslation).toHaveBeenCalled();
  });

  it('422s when no sentence can be reconstructed', async () => {
    sentenceAround.mockResolvedValueOnce('');
    const res = (await callPost(VALID)) as { status: number };
    expect(res.status).toBe(422);
  });

  it('503s when OpenAI is not configured', async () => {
    const { OpenAiNotConfiguredError } = await import('$lib/server/openai-client.js');
    translateSentence.mockRejectedValueOnce(new OpenAiNotConfiguredError());
    const res = (await callPost(VALID)) as { status: number };
    expect(res.status).toBe(503);
  });

  it('400s on an invalid body', async () => {
    const res = (await callPost({ chapterId: UUID, language: 'eu' })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('400s on an unsupported language', async () => {
    const res = (await callPost({ ...VALID, language: 'zz' })) as { status: number };
    expect(res.status).toBe(400);
  });

  it('401s when unauthenticated', async () => {
    const res = (await callPost(VALID, null)) as { status: number };
    expect(res.status).toBe(401);
  });
});
