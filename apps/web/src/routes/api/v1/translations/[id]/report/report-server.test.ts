// @vitest-environment node
/**
 * Route tests for POST /api/v1/translations/:id/report (T-11.1).
 *
 * The service is covered by `reports.test.ts`; here we only verify the
 * HTTP shape — auth gate, status codes, rate-limit headers, JSON
 * envelope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitReport = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/moderation/reports.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/moderation/reports.js')>(
    '$lib/server/moderation/reports.js',
  );
  return {
    ...actual,
    submitReport: (...a: unknown[]) => submitReport(...a),
  };
});

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];
type PostEvent = Parameters<PostFn>[0];

const TR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function callPost(
  body: unknown,
  opts: { user?: { id: string } | null; id?: string } = {},
) {
  const { user = { id: 'u1' }, id = TR_ID } = opts;
  if (user) {
    requireUser.mockResolvedValueOnce(user);
  } else {
    requireUser.mockImplementationOnce(() => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });
  }
  const { POST } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/translations/${id}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as PostEvent;
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number; body?: { message: string } };
  }
}

beforeEach(() => {
  submitReport.mockReset();
  requireUser.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/translations/:id/report', () => {
  it('returns 201 with the publicReport shape on success', async () => {
    submitReport.mockResolvedValueOnce({
      id: 'rep-1',
      translationId: TR_ID,
      reporterId: 'u1',
      reason: 'spam',
      note: null,
      status: 'open',
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: new Date('2026-04-29T00:00:00Z'),
      updatedAt: new Date('2026-04-29T00:00:00Z'),
    });

    const res = (await callPost({ reason: 'spam' })) as Response;
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.report).toMatchObject({
      id: 'rep-1',
      translationId: TR_ID,
      reason: 'spam',
      note: null,
      status: 'open',
      createdAt: '2026-04-29T00:00:00.000Z',
    });
    // Reporter id is stripped from the public shape.
    expect(json.report.reporterId).toBeUndefined();
  });

  it('propagates auth failures as 401', async () => {
    const res = (await callPost({ reason: 'spam' }, { user: null })) as {
      status: number;
    };
    expect(res.status).toBe(401);
    expect(submitReport).not.toHaveBeenCalled();
  });

  it('rejects an invalid translation id with 400', async () => {
    const res = (await callPost({ reason: 'spam' }, { id: 'not-a-uuid' })) as {
      status: number;
    };
    expect(res.status).toBe(400);
    expect(submitReport).not.toHaveBeenCalled();
  });

  it('rejects an unknown reason via Zod with 400', async () => {
    const res = (await callPost({ reason: 'libel' })) as { status: number };
    expect(res.status).toBe(400);
    expect(submitReport).not.toHaveBeenCalled();
  });

  it('maps ReportDuplicateError → 409', async () => {
    const { ReportDuplicateError } = await import('$lib/server/moderation/reports.js');
    submitReport.mockRejectedValueOnce(new ReportDuplicateError());
    const res = (await callPost({ reason: 'spam' })) as { status: number };
    expect(res.status).toBe(409);
  });

  it('maps ReportValidationError(404) → 404', async () => {
    const { ReportValidationError } = await import('$lib/server/moderation/reports.js');
    submitReport.mockRejectedValueOnce(
      new ReportValidationError('Translation not found', 404),
    );
    const res = (await callPost({ reason: 'spam' })) as { status: number };
    expect(res.status).toBe(404);
  });

  it('returns 429 with Retry-After when rate-limited', async () => {
    const { ReportRateLimitError } = await import('$lib/server/moderation/reports.js');
    submitReport.mockRejectedValueOnce(new ReportRateLimitError(86400, 10));
    const res = (await callPost({ reason: 'spam' })) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('86400');
    expect(res.headers.get('x-ratelimit-limit')).toBe('10');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    const json = await res.json();
    expect(json.error).toBe('rate_limited');
    expect(json.retryAfterSeconds).toBe(86400);
  });
});
