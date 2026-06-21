// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { OpenAiNotConfiguredError, translateSentence } from './openai-client.js';

function okFetch(content: string) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('translateSentence', () => {
  it('returns the trimmed model output', async () => {
    const out = await translateSentence('Etxe bat.', 'eu', 'en', {
      apiKey: 'k',
      fetchImpl: okFetch('  A house.  ') as unknown as typeof fetch,
    });
    expect(out).toBe('A house.');
  });

  it('puts the source + target language names in the prompt', async () => {
    const fetchImpl = okFetch('out');
    await translateSentence('Etxe bat.', 'eu', 'en', {
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = (fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    const sent = JSON.parse(init.body as string);
    expect(sent.messages[0].content).toContain('Basque');
    expect(sent.messages[0].content).toContain('English');
    expect(sent.messages[1].content).toBe('Etxe bat.');
    expect(sent.model).toBeTruthy();
  });

  it('throws OpenAiNotConfiguredError when no API key is set', async () => {
    await expect(
      translateSentence('x', 'eu', 'en', { apiKey: '' }),
    ).rejects.toBeInstanceOf(OpenAiNotConfiguredError);
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
    await expect(
      translateSentence('x', 'eu', 'en', {
        apiKey: 'k',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  it('throws when the model returns empty content', async () => {
    await expect(
      translateSentence('x', 'eu', 'en', {
        apiKey: 'k',
        fetchImpl: okFetch('   ') as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });
});
