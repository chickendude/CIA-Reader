import type { RequestEvent } from '@sveltejs/kit';
import { and, count, eq, gt } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { PERSONAL_API_KEY_PREFIX } from './personal-api-keys.js';
import { hashToken } from './tokens.js';

export const DEVICE_ID_HEADER = 'X-Device-Id';

export type RateLimitSubjectType = 'api_key' | 'device' | 'user';

export type RateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
  now?: Date;
};

export type RateLimitResult = {
  limit: number;
  remaining: number;
  retryAfterSeconds?: number;
  subjectType: RateLimitSubjectType;
};

type RateLimitSubject = {
  type: RateLimitSubjectType;
  value: string;
};

export class RequestRateLimitError extends Error implements RateLimitResult {
  public readonly remaining = 0;

  constructor(
    public readonly retryAfterSeconds: number,
    public readonly limit: number,
    public readonly subjectType: RateLimitSubjectType,
  ) {
    super('Request rate limit exceeded');
    this.name = 'RequestRateLimitError';
  }
}

function bearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice('bearer '.length).trim();
}

export function rateLimitSubjectForRequest(
  event: RequestEvent,
  userId: string,
): RateLimitSubject {
  const apiKey = event.request.headers.get('x-api-key')?.trim();
  if (apiKey?.startsWith(PERSONAL_API_KEY_PREFIX)) {
    return { type: 'api_key', value: apiKey };
  }

  const bearer = bearerToken(event.request);
  if (bearer?.startsWith(PERSONAL_API_KEY_PREFIX)) {
    return { type: 'api_key', value: bearer };
  }

  const deviceId = event.request.headers.get(DEVICE_ID_HEADER)?.trim();
  if (deviceId) {
    return { type: 'device', value: `${userId}:${deviceId}` };
  }

  return { type: 'user', value: userId };
}

export async function consumeRateLimit(
  event: RequestEvent,
  userId: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - options.windowMs);
  const subject = rateLimitSubjectForRequest(event, userId);
  const subjectHash = hashToken(`${subject.type}:${subject.value}`);

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(schema.apiRateLimitEvents)
    .where(
      and(
        eq(schema.apiRateLimitEvents.scope, options.scope),
        eq(schema.apiRateLimitEvents.subjectType, subject.type),
        eq(schema.apiRateLimitEvents.subjectHash, subjectHash),
        gt(schema.apiRateLimitEvents.createdAt, since),
      ),
    );

  const used = Number(n);
  if (used >= options.limit) {
    throw new RequestRateLimitError(
      Math.ceil(options.windowMs / 1_000),
      options.limit,
      subject.type,
    );
  }

  await db.insert(schema.apiRateLimitEvents).values({
    userId,
    scope: options.scope,
    subjectType: subject.type,
    subjectHash,
    createdAt: now,
  });

  return {
    limit: options.limit,
    remaining: Math.max(0, options.limit - used - 1),
    subjectType: subject.type,
  };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Subject': result.subjectType,
    ...(result.retryAfterSeconds
      ? { 'Retry-After': String(result.retryAfterSeconds) }
      : {}),
  };
}
