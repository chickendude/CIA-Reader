import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { HealthResponse, ProcessResponse } from '$lib/server/nlp-client.js';

const health = vi.fn<() => Promise<HealthResponse>>();
const process = vi.fn<(lang: string, text: string) => Promise<ProcessResponse>>();

vi.mock('$lib/server/nlp-client.js', () => ({
  nlpClient: {
    health: (...args: []) => health(...args),
    process: (lang: string, text: string) => process(lang, text),
  },
}));

describe('GET /api/v1/smoke', () => {
  beforeEach(() => {
    health.mockReset();
    process.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns a 200 JSON envelope when NLP responds', async () => {
    health.mockResolvedValue({ status: 'ok', languages: ['hi', 'mr', 'or'] });
    process.mockResolvedValue({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'नमस्ते',
          is_word: true,
          candidates: [],
          is_ambiguous: false,
          is_oov: false,
          romanization: null,
        },
      ],
    });

    const { GET } = await import('./+server.js');
    const res = await GET({} as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.nlp_health.status).toBe('ok');
    expect(body.sample_process.token_count).toBe(1);
    expect(body.sample_process.first_token.surface).toBe('नमस्ते');
  });

  it('bubbles a 502 when the NLP service is unreachable', async () => {
    health.mockRejectedValue(new Error('ECONNREFUSED'));

    const { GET } = await import('./+server.js');
    await expect(GET({} as Parameters<typeof GET>[0])).rejects.toMatchObject({ status: 502 });
  });
});
