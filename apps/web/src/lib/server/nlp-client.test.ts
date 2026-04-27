import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nlpClient } from './nlp-client.js';

describe('nlpClient', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('health() parses a successful response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok', languages: ['hi', 'mr', 'or'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const health = await nlpClient.health();
    expect(health.status).toBe('ok');
    expect(health.languages).toEqual(['hi', 'mr', 'or']);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/health$/);
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('process() posts JSON to /process', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ language: 'hi', pipeline_id: 'hi-stub', tokens: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const out = await nlpClient.process('hi', 'मैं');
    expect(out.language).toBe('hi');
    expect(out.tokens).toEqual([]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ language: 'hi', text: 'मैं' });
  });

  it('throws with the response body when the NLP service returns non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('unsupported language', { status: 400, statusText: 'Bad Request' }),
    );

    await expect(nlpClient.process('xx', 'hi')).rejects.toThrow(/NLP service 400: unsupported language/);
  });
});
