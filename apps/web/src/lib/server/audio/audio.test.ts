// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakePut = vi.fn();
vi.mock('./storage.js', async () => {
  const actual = await vi.importActual<typeof import('./storage.js')>(
    './storage.js',
  );
  return {
    ...actual,
    getAudioStorage: () => ({
      put: (...a: unknown[]) => fakePut(...a),
      delete: vi.fn(),
      urlFor: (k: string) => `/audio/${k}`,
    }),
  };
});

const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => rows),
  values: vi.fn(() => chain),
  returning: vi.fn(() => rows),
  innerJoin: vi.fn(() => chain),
};
const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  delete: vi.fn(() => chain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    texts: { id: 't.id', ownerId: 't.owner_id' },
    textChapters: { id: 'tc.id', textId: 'tc.text_id' },
    audioFiles: { id: 'af.id', textId: 'af.text_id' },
  },
}));

const { uploadAudio, AudioError } = await import('./audio.js');

function reset() {
  rows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakePut.mockReset();
}

beforeEach(reset);

const OWNER = { id: 'u1', role: 'user' as const };
const ADMIN = { id: 'a1', role: 'admin' as const };
const SMALL_BODY = new Uint8Array([0x49, 0x44, 0x33]); // ID3 header bytes

describe('uploadAudio', () => {
  it('rejects an unsupported mime with 415', async () => {
    await expect(
      uploadAudio({
        textId: 'tx-1',
        body: SMALL_BODY,
        mime: 'video/mp4',
        originalName: 'x.mp4',
        uploader: OWNER,
        acknowledgedRedistribution: true,
      }),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('rejects an oversized body with 413', async () => {
    await expect(
      uploadAudio({
        textId: 'tx-1',
        body: new Uint8Array(200 * 1024 * 1024),
        mime: 'audio/mpeg',
        originalName: 'x.mp3',
        uploader: OWNER,
        acknowledgedRedistribution: true,
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('blocks non-admin owners who skip the redistribution checkbox (T-9.7)', async () => {
    rows.push({
      id: 'tx-1',
      ownerId: OWNER.id,
      language: 'hi',
      title: 'x',
      sourceType: 'paste',
      status: 'ready',
      visibility: 'private',
    });
    await expect(
      uploadAudio({
        textId: 'tx-1',
        body: SMALL_BODY,
        mime: 'audio/mpeg',
        originalName: 'x.mp3',
        uploader: OWNER,
        // no acknowledgedRedistribution → 400.
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lets admins skip the redistribution checkbox', async () => {
    rows.push({
      id: 'tx-1',
      ownerId: 'someone-else',
      language: 'hi',
      title: 'x',
      sourceType: 'paste',
      status: 'ready',
      visibility: 'private',
    });
    chain.returning.mockReturnValueOnce([{ id: 'audio-1' }]);
    const r = await uploadAudio({
      textId: 'tx-1',
      body: SMALL_BODY,
      mime: 'audio/mpeg',
      originalName: 'x.mp3',
      uploader: ADMIN,
    });
    expect(r.id).toBe('audio-1');
    expect(fakePut).toHaveBeenCalledOnce();
  });

  void AudioError;
});
