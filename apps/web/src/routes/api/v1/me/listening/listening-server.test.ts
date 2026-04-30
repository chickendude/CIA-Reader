// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const recordListeningDelta = vi.fn();

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock('$lib/server/audio/listening.js', () => {
  class ListeningStatsError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ListeningStatsError,
    recordListeningDelta: (...a: unknown[]) => recordListeningDelta(...a),
  };
});

type PostFn = (typeof import('./+server.js'))['POST'];
const AUDIO_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function callPost(body: unknown) {
  const { POST } = await import('./+server.js');
  const event = {
    request: new Request('http://x/api/v1/me/listening', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<PostFn>[0];
  try {
    return (await POST(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
  recordListeningDelta.mockReset();
  recordListeningDelta.mockResolvedValue({
    audioFileId: AUDIO_ID,
    textId: 'text-1',
    listenedMs: 5000,
  });
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/me/listening', () => {
  it('records a valid playback delta', async () => {
    const res = (await callPost({
      audioFileId: AUDIO_ID,
      listenedMs: 5000,
    })) as Response;

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      listening: {
        audioFileId: AUDIO_ID,
        textId: 'text-1',
        listenedMs: 5000,
      },
    });
    expect(recordListeningDelta).toHaveBeenCalledWith({
      userId: 'u1',
      audioFileId: AUDIO_ID,
      listenedMs: 5000,
    });
  });

  it('rejects malformed payloads with 400', async () => {
    const res = (await callPost({
      audioFileId: 'bad',
      listenedMs: 5000,
    })) as { status: number };

    expect(res.status).toBe(400);
    expect(recordListeningDelta).not.toHaveBeenCalled();
  });

  it('requires auth', async () => {
    requireUser.mockImplementationOnce(() => {
      throw { status: 401 };
    });

    const res = (await callPost({
      audioFileId: AUDIO_ID,
      listenedMs: 5000,
    })) as { status: number };

    expect(res.status).toBe(401);
    expect(recordListeningDelta).not.toHaveBeenCalled();
  });
});
