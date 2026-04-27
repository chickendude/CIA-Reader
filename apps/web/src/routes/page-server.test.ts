import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthResponse } from '$lib/server/nlp-client.js';

const health = vi.fn<() => Promise<HealthResponse>>();

vi.mock('$lib/server/nlp-client.js', () => ({
  nlpClient: {
    health: (...args: []) => health(...args),
    process: vi.fn(),
  },
}));

describe('root +page.server.ts load', () => {
  beforeEach(() => {
    health.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("reports NLP 'ok' and lists supported languages when healthy", async () => {
    health.mockResolvedValue({ status: 'ok', languages: ['hi', 'mr', 'or'] });
    const { load } = await import('./+page.server.js');
    const data = await load({} as Parameters<typeof load>[0]);
    expect(data.nlpStatus).toBe('ok');
    expect(data.nlpLanguages).toEqual(['hi', 'mr', 'or']);
    expect(data.languages.map((l) => l.code).sort()).toEqual(['hi', 'mr', 'or']);
    const hi = data.languages.find((l) => l.code === 'hi');
    expect(hi?.script).toBe('Deva');
    const or = data.languages.find((l) => l.code === 'or');
    expect(or?.script).toBe('Orya');
  });

  it("reports NLP 'down' (not a thrown error) when the health check rejects", async () => {
    health.mockRejectedValue(new Error('connect ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { load } = await import('./+page.server.js');
    const data = await load({} as Parameters<typeof load>[0]);
    expect(data.nlpStatus).toBe('down');
    expect(data.nlpLanguages).toEqual([]);
  });
});
