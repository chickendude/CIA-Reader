// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

const requireUser = vi.fn();

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type GetFn = (typeof import('./+server.js'))['GET'];

async function callGet() {
  const { GET } = await import('./+server.js');
  const event = {
    request: new Request('http://x/api/v1/auth/me'),
  } as unknown as Parameters<GetFn>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/auth/me', () => {
  it('returns the stable public user contract', async () => {
    requireUser.mockResolvedValueOnce({
      id: 'u1',
      email: 'reader@example.com',
      role: 'user',
      createdAt: new Date('2026-04-27T00:00:00Z'),
      updatedAt: new Date('2026-04-27T00:00:00Z'),
    });

    const res = (await callGet()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(jsonContract(json)).toMatchInlineSnapshot(`
      {
        "user": {
          "createdAt": "string",
          "email": "string",
          "id": "string",
          "role": "string",
        },
      }
    `);
  });
});
