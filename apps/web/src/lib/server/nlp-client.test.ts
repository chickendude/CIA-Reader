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
    const firstCall = fetchMock.mock.calls[0]!;
    const [url, init] = firstCall;
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
    const processCall = fetchMock.mock.calls[0]!;
    const [, init] = processCall;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ language: 'hi', text: 'मैं' });
  });

  it('throws with the response body when the NLP service returns non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('unsupported language', { status: 400, statusText: 'Bad Request' }),
    );

    await expect(nlpClient.process('xx', 'hi')).rejects.toThrow(/NLP service 400: unsupported language/);
  });

  it('ocr() posts a multipart body with the image + fields', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          language: 'eu',
          pipeline_id: 'stanza-eu',
          width: 800,
          height: 1200,
          body: 'Egun on',
          tokens: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const out = await nlpClient.ocr('eu', bytes, {
      width: 800,
      height: 1200,
      mime: 'image/webp',
      bornDigital: { items: [{ str: 'Egun', x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] },
    });
    expect(out.width).toBe(800);
    expect(out.body).toBe('Egun on');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/ocr$/);
    expect(init?.method).toBe('POST');
    // Multipart: body is FormData, and fetch (not us) sets the boundary,
    // so we must NOT have forced a JSON content-type.
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init!.body as FormData;
    expect(form.get('language')).toBe('eu');
    expect(form.get('width')).toBe('800');
    expect(form.get('height')).toBe('1200');
    expect(form.get('engine')).toBe('vision');
    expect(JSON.parse(String(form.get('born_digital')))).toEqual({
      items: [{ str: 'Egun', x: 0.1, y: 0.1, w: 0.2, h: 0.05 }],
    });
    expect(form.get('image')).toBeInstanceOf(Blob);
  });

  it('ocr() omits born_digital and defaults engine when not provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          language: 'eu',
          pipeline_id: 'stanza-eu',
          width: 10,
          height: 10,
          body: '',
          tokens: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await nlpClient.ocr('eu', new Uint8Array([0]), { width: 10, height: 10 });
    const form = fetchMock.mock.calls[0]![1]!.body as FormData;
    expect(form.get('born_digital')).toBeNull();
    expect(form.get('engine')).toBe('vision');
  });
});
