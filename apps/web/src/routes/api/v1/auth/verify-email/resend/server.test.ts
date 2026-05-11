// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn<(...args: unknown[]) => unknown>();
const createMagicLink = vi.fn<(...args: unknown[]) => unknown>();
const consumeRateLimit = vi.fn<(...args: unknown[]) => unknown>();
const sendMail = vi.fn<(...args: unknown[]) => unknown>();
const rateLimitHeaders = vi.fn<(...args: unknown[]) => Record<string, string>>(
  () => ({}),
);

class FakeRequestRateLimitError extends Error {
  status = 429;
  limit = 1;
  remaining = 0;
  retryAfterSeconds = 60;
  subjectType = 'user' as const;
  constructor() {
    super('rate limited');
    this.name = 'RequestRateLimitError';
  }
}

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));
vi.mock('$lib/server/auth/magic-link.js', () => ({
  createMagicLink: (...args: unknown[]) => createMagicLink(...args),
}));
vi.mock('$lib/server/auth/rate-limits.js', () => ({
  RequestRateLimitError: FakeRequestRateLimitError,
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
  rateLimitHeaders: (...args: unknown[]) => rateLimitHeaders(...args),
}));
vi.mock('$lib/server/email/index.js', () => ({
  sendMail: (...args: unknown[]) => sendMail(...args),
  buildMagicLinkEmail: (to: string, url: string) => ({ to, subject: 's', text: url }),
}));
vi.mock('$lib/server/env.js', () => ({
  APP_BASE_URL: 'https://parhiba.com',
}));

const { POST } = await import('./+server.js');

function makeEvent() {
  return {
    request: { headers: new Headers() },
    cookies: { get: () => undefined },
    locals: {},
    url: new URL('https://parhiba.com/api/v1/auth/verify-email/resend'),
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/auth/verify-email/resend', () => {
  beforeEach(() => {
    requireUser.mockReset();
    createMagicLink.mockReset();
    consumeRateLimit.mockReset();
    sendMail.mockReset();
    rateLimitHeaders.mockReset();
    rateLimitHeaders.mockReturnValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 when the user is already verified (idempotent)', async () => {
    requireUser.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      emailVerifiedAt: new Date(),
    });

    const res = await POST(makeEvent());

    expect(res.status).toBe(204);
    expect(sendMail).not.toHaveBeenCalled();
    expect(createMagicLink).not.toHaveBeenCalled();
  });

  it('mints a magic link and sends the email when unverified', async () => {
    requireUser.mockResolvedValue({
      id: 'u2',
      email: 'unverified@example.com',
      emailVerifiedAt: null,
    });
    consumeRateLimit.mockResolvedValue({ limit: 1, remaining: 0 });
    createMagicLink.mockResolvedValue('tok-abc');
    sendMail.mockResolvedValue(undefined);

    const res = await POST(makeEvent());

    expect(res.status).toBe(202);
    expect(createMagicLink).toHaveBeenCalledWith('u2');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'unverified@example.com',
        text: expect.stringContaining('https://parhiba.com/auth/magic/tok-abc'),
      }),
    );
  });

  it('returns 429 when rate-limited, without sending email', async () => {
    requireUser.mockResolvedValue({
      id: 'u3',
      email: 'rl@example.com',
      emailVerifiedAt: null,
    });
    consumeRateLimit.mockRejectedValue(new FakeRequestRateLimitError());

    const res = await POST(makeEvent());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'rate_limited', retryAfterSeconds: 60 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns 502 if SMTP throws', async () => {
    requireUser.mockResolvedValue({
      id: 'u4',
      email: 'smtp@example.com',
      emailVerifiedAt: null,
    });
    consumeRateLimit.mockResolvedValue({ limit: 1, remaining: 0 });
    createMagicLink.mockResolvedValue('tok-xyz');
    sendMail.mockRejectedValue(new Error('smtp down'));

    await expect(POST(makeEvent())).rejects.toMatchObject({ status: 502 });
  });
});
