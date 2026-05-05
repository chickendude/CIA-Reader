import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const execute = vi.fn<(query: unknown) => Promise<unknown>>();

vi.mock('$lib/server/db', () => ({
  db: { execute: (query: unknown) => execute(query) },
  schema: {},
}));

describe('GET /healthz', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns 200 + status:ok when the DB ping succeeds', async () => {
    execute.mockResolvedValue([{ '?column?': 1 }]);
    const { GET } = await import('./+server.js');
    const res = await GET({} as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns 503 when the DB ping fails', async () => {
    execute.mockRejectedValue(new Error('connection refused'));
    const { GET } = await import('./+server.js');
    await expect(async () => {
      await GET({} as Parameters<typeof GET>[0]);
    }).rejects.toMatchObject({
      status: 503,
      body: { message: expect.stringContaining('connection refused') },
    });
  });
});
