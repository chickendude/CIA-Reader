// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const staged: unknown[][] = [];
const calls: Array<{ kind: string; payload?: unknown; set?: unknown }> = [];
const assertCanReadText = vi.fn();

function next(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result');
  return v;
}

function selectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(next());
  return chain;
}

function insertChain() {
  const entry = { kind: 'insert', payload: undefined as unknown };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn((payload: unknown) => {
    entry.payload = payload;
    return chain;
  });
  chain.onConflictDoUpdate = vi.fn((patch: unknown) => {
    calls.push({ kind: 'upsert', set: patch });
    return Promise.resolve();
  });
  return chain;
}

vi.mock('../auth/can-read.js', () => ({
  assertCanReadText: (...a: unknown[]) => assertCanReadText(...a),
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
  },
  schema: {
    audioFiles: {
      id: 'audio_files.id',
      textId: 'audio_files.text_id',
    },
    texts: {
      id: 'texts.id',
      ownerId: 'texts.owner_id',
      visibility: 'texts.visibility',
    },
    userAudioListening: {
      userId: 'user_audio_listening.user_id',
      audioFileId: 'user_audio_listening.audio_file_id',
      textId: 'user_audio_listening.text_id',
      listenedMs: 'user_audio_listening.listened_ms',
    },
  },
}));

const { recordListeningDelta, ListeningStatsError } = await import(
  './listening.js'
);

function audioRow(overrides: Record<string, unknown> = {}) {
  return {
    audioFileId: 'audio-1',
    textId: 'text-1',
    ownerId: 'u1',
    visibility: 'private',
    ...overrides,
  };
}

beforeEach(() => {
  staged.length = 0;
  calls.length = 0;
  assertCanReadText.mockReset();
  assertCanReadText.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordListeningDelta', () => {
  it('upserts a positive playback delta for readable audio', async () => {
    staged.push([audioRow()]);

    await expect(
      recordListeningDelta({
        userId: 'u1',
        audioFileId: 'audio-1',
        listenedMs: 12_345.4,
      }),
    ).resolves.toEqual({
      audioFileId: 'audio-1',
      textId: 'text-1',
      listenedMs: 12_345,
    });

    expect(assertCanReadText).toHaveBeenCalledWith(
      { id: 'u1' },
      { id: 'text-1', ownerId: 'u1', visibility: 'private' },
    );
    expect(calls.find((c) => c.kind === 'insert')?.payload).toMatchObject({
      userId: 'u1',
      audioFileId: 'audio-1',
      textId: 'text-1',
      listenedMs: 12_345,
    });
    expect(calls.some((c) => c.kind === 'upsert')).toBe(true);
  });

  it('rejects empty or oversized deltas before hitting the DB', async () => {
    await expect(
      recordListeningDelta({
        userId: 'u1',
        audioFileId: 'audio-1',
        listenedMs: 0,
      }),
    ).rejects.toBeInstanceOf(ListeningStatsError);
    await expect(
      recordListeningDelta({
        userId: 'u1',
        audioFileId: 'audio-1',
        listenedMs: 60_001,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404s when the audio row is missing', async () => {
    staged.push([]);

    await expect(
      recordListeningDelta({
        userId: 'u1',
        audioFileId: 'missing',
        listenedMs: 1_000,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s when the user cannot read the parent text', async () => {
    staged.push([audioRow({ ownerId: 'someone-else' })]);
    assertCanReadText.mockRejectedValueOnce(new Error('nope'));

    await expect(
      recordListeningDelta({
        userId: 'u1',
        audioFileId: 'audio-1',
        listenedMs: 1_000,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
