// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const staged: unknown[][] = [];
const inserted: unknown[] = [];

function nextRows(): unknown[] {
  const rows = staged.shift();
  if (!rows) throw new Error('No staged rows');
  return rows;
}

const selectChain: Record<string, unknown> = {
  from: vi.fn(() => selectChain),
  where: vi.fn(() => selectChain),
  then: (resolve: (value: unknown[]) => unknown) => resolve(nextRows()),
};

const insertChain = {
  values: vi.fn((value: unknown) => {
    inserted.push(value);
    return insertChain;
  }),
};

const fakeDb = {
  select: vi.fn(() => selectChain),
  insert: vi.fn(() => insertChain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    apiRateLimitEvents: {
      userId: 'api_rate_limit_events.user_id',
      scope: 'api_rate_limit_events.scope',
      subjectType: 'api_rate_limit_events.subject_type',
      subjectHash: 'api_rate_limit_events.subject_hash',
      createdAt: 'api_rate_limit_events.created_at',
    },
  },
}));

const {
  consumeRateLimit,
  rateLimitHeaders,
  rateLimitSubjectForRequest,
} = await import('./rate-limits.js');

function event(headers: Record<string, string> = {}) {
  return {
    request: new Request('http://x/api/v1/translations', { headers }),
  } as Parameters<typeof rateLimitSubjectForRequest>[0];
}

beforeEach(() => {
  staged.length = 0;
  inserted.length = 0;
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  insertChain.values.mockClear();
});

describe('rate limit subjects', () => {
  it('prefers personal API keys over device headers', () => {
    expect(
      rateLimitSubjectForRequest(
        event({ 'x-api-key': 'ciar_pk_secret', 'x-device-id': 'phone' }),
        'u1',
      ),
    ).toEqual({ type: 'api_key', value: 'ciar_pk_secret' });
  });

  it('uses X-Device-Id when no personal API key is present', () => {
    expect(rateLimitSubjectForRequest(event({ 'x-device-id': 'phone' }), 'u1')).toEqual({
      type: 'device',
      value: 'u1:phone',
    });
  });
});

describe('consumeRateLimit', () => {
  it('records an event and reports remaining calls', async () => {
    staged.push([{ n: 2 }]);

    const result = await consumeRateLimit(event({ 'x-device-id': 'phone' }), 'u1', {
      scope: 'translations:create',
      limit: 30,
      windowMs: 3_600_000,
      now: new Date('2026-04-30T00:00:00Z'),
    });

    expect(result).toMatchObject({ limit: 30, remaining: 27, subjectType: 'device' });
    expect(inserted[0]).toMatchObject({
      userId: 'u1',
      scope: 'translations:create',
      subjectType: 'device',
      createdAt: new Date('2026-04-30T00:00:00Z'),
    });
  });

  it('throws with Retry-After metadata when the bucket is full', async () => {
    staged.push([{ n: 30 }]);

    await expect(
      consumeRateLimit(event({ authorization: 'Bearer ciar_pk_secret' }), 'u1', {
        scope: 'translations:create',
        limit: 30,
        windowMs: 3_600_000,
      }),
    ).rejects.toMatchObject({
      retryAfterSeconds: 3600,
      limit: 30,
      remaining: 0,
      subjectType: 'api_key',
    });
    expect(fakeDb.insert).not.toHaveBeenCalled();
  });

  it('formats standard rate limit headers', () => {
    expect(
      rateLimitHeaders({
        limit: 30,
        remaining: 0,
        retryAfterSeconds: 3600,
        subjectType: 'api_key',
      }),
    ).toMatchObject({
      'Retry-After': '3600',
      'X-RateLimit-Limit': '30',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Subject': 'api_key',
    });
  });
});
