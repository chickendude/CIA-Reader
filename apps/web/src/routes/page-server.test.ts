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
    const data = await load({ locals: {} } as Parameters<typeof load>[0]);
    expect(data.nlpStatus).toBe('ok');
    expect(data.nlpLanguages).toEqual(['hi', 'mr', 'or']);
    expect(data.languages.map((l: { code: string }) => l.code).sort()).toEqual(['hi', 'mr', 'or']);
    const hi = data.languages.find((l: { code: string }) => l.code === 'hi');
    expect(hi?.script).toBe('Deva');
    const or = data.languages.find((l: { code: string }) => l.code === 'or');
    expect(or?.script).toBe('Orya');
    expect(data.user).toBeNull();
  });

  it('pass-throughs the authenticated user when locals.user is set', async () => {
    health.mockResolvedValue({ status: 'ok', languages: ['hi', 'mr', 'or'] });
    const { load } = await import('./+page.server.js');
    const data = await load({
      locals: {
        user: { id: 'u1', email: 'a@b.c', displayName: 'Alex', role: 'user' },
      },
    } as unknown as Parameters<typeof load>[0]);
    expect(data.user).toMatchObject({ id: 'u1', email: 'a@b.c' });
  });

  it("reports NLP 'down' (not a thrown error) when the health check rejects", async () => {
    health.mockRejectedValue(new Error('connect ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { load } = await import('./+page.server.js');
    const data = await load({ locals: {} } as Parameters<typeof load>[0]);
    expect(data.nlpStatus).toBe('down');
    expect(data.nlpLanguages).toEqual([]);
  });
});
