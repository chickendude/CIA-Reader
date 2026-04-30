// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonContract } from '$lib/test/json-contract.js';

const getTextStatus = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/texts/jobs.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/jobs.js')>(
    '$lib/server/texts/jobs.js',
  );
  return {
    ...actual,
    getTextStatus: (...a: unknown[]) => getTextStatus(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type GetFn = (typeof import('./+server.js'))['GET'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = { id: 'user-1', role: 'user' as const };

async function callGet(id: string, user: typeof USER | null = USER) {
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });
  }
  const { GET } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/texts/${id}/status`),
  } as unknown as Parameters<GetFn>[0];
  try {
    return await GET(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  getTextStatus.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/v1/texts/:id/status', () => {
  it('returns status + job for the owner', async () => {
    getTextStatus.mockResolvedValueOnce({
      status: 'processing',
      statusError: null,
      job: {
        id: 'job-1',
        status: 'processing',
        error: null,
        startedAt: new Date('2026-04-27T01:00:00Z'),
        finishedAt: null,
        createdAt: new Date('2026-04-27T00:59:00Z'),
      },
    });
    const res = (await callGet(VALID_ID)) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('processing');
    expect(json.job.id).toBe('job-1');
    expect(jsonContract(json)).toMatchInlineSnapshot(`
      {
        "job": {
          "createdAt": "string",
          "error": "null",
          "finishedAt": "null",
          "id": "string",
          "startedAt": "string",
          "status": "string",
        },
        "status": "string",
        "statusError": "null",
      }
    `);
  });

  it('returns null job when no nlp_jobs row exists', async () => {
    getTextStatus.mockResolvedValueOnce({
      status: 'pending',
      statusError: null,
      job: null,
    });
    const res = (await callGet(VALID_ID)) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.job).toBeNull();
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callGet('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
    expect(getTextStatus).not.toHaveBeenCalled();
  });

  it('returns 404 when the text is missing or not owned by the viewer', async () => {
    getTextStatus.mockResolvedValueOnce(null);
    const res = (await callGet(VALID_ID)) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = (await callGet(VALID_ID, null)) as { status: number };
    expect(res.status).toBe(401);
    expect(getTextStatus).not.toHaveBeenCalled();
  });
});
