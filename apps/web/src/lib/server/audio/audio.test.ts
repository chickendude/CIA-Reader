// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setAudioStorage, type AudioStorage } from './storage.js';

// Queue-based thenable chain mock — same pattern as collections.test.ts.
// Each await on a chain shifts the next staged result off `queue`.
const queue: unknown[][] = [];
type ChainMock = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => void) => void;
};
const chain = {} as ChainMock;
chain.from = vi.fn(() => chain);
chain.where = vi.fn(() => chain);
chain.limit = vi.fn(() => chain);
chain.set = vi.fn(() => chain);
chain.values = vi.fn(() => chain);
chain.returning = vi.fn(() => chain);
chain.innerJoin = vi.fn(() => chain);
chain.then = (resolve) => {
  const v = queue.shift() ?? [];
  Promise.resolve(v).then(resolve);
};

const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  delete: vi.fn(() => chain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    audioFiles: {
      id: 'af.id',
      textId: 'af.text_id',
      chapterId: 'af.chapter_id',
      storageKey: 'af.storage_key',
    },
    texts: { id: 't.id', ownerId: 't.owner_id' },
    textChapters: { id: 'tc.id', textId: 'tc.text_id' },
  },
}));

const { AudioError, uploadAudio, deleteAudio, listAudioForText } = await import(
  './audio.js'
);

class StubStorage implements AudioStorage {
  put: AudioStorage['put'] = vi.fn(async () => {});
  delete: AudioStorage['delete'] = vi.fn(async () => {});
  urlFor: AudioStorage['urlFor'] = vi.fn((k) => `/audio/${k}`);
}

let storage: StubStorage;

beforeEach(() => {
  queue.length = 0;
  for (const [k, v] of Object.entries(chain)) {
    if (k === 'then') continue;
    (v as ReturnType<typeof vi.fn>).mockClear();
  }
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.delete.mockClear();
  storage = new StubStorage();
  setAudioStorage(storage);
});

const OWNER = { id: 'u1', role: 'user' as const };
const ADMIN = { id: 'admin', role: 'admin' as const };
const STRANGER = { id: 'u2', role: 'user' as const };

const baseText = {
  id: 'text-1',
  ownerId: OWNER.id,
  visibility: 'private' as const,
};

function smallBody(): Uint8Array {
  return new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
}

describe('uploadAudio', () => {
  it('rejects an oversized body up-front (no DB hit)', async () => {
    const big = new Uint8Array(81 * 1024 * 1024);
    await expect(
      uploadAudio({
        textId: 'text-1',
        body: big,
        mime: 'audio/mpeg',
        originalName: 'huge.mp3',
        uploader: OWNER,
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(fakeDb.select).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects an unsupported mime', async () => {
    await expect(
      uploadAudio({
        textId: 'text-1',
        body: smallBody(),
        mime: 'video/mp4',
        originalName: 'clip.mp4',
        uploader: OWNER,
      }),
    ).rejects.toMatchObject({ status: 415 });
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  it('404s when the parent text is missing', async () => {
    queue.push([]); // text lookup empty
    await expect(
      uploadAudio({
        textId: 'missing',
        body: smallBody(),
        mime: 'audio/mpeg',
        originalName: 'x.mp3',
        uploader: OWNER,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner non-admin', async () => {
    queue.push([baseText]);
    await expect(
      uploadAudio({
        textId: 'text-1',
        body: smallBody(),
        mime: 'audio/mpeg',
        originalName: 'x.mp3',
        uploader: STRANGER,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('404s when the chapter id does not exist', async () => {
    queue.push([baseText]);
    queue.push([]); // chapter lookup empty
    await expect(
      uploadAudio({
        textId: 'text-1',
        chapterId: 'ch-missing',
        body: smallBody(),
        mime: 'audio/mpeg',
        originalName: 'x.mp3',
        uploader: OWNER,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a chapter that belongs to a different text', async () => {
    queue.push([baseText]);
    queue.push([{ id: 'ch-1', textId: 'other-text' }]);
    await expect(
      uploadAudio({
        textId: 'text-1',
        chapterId: 'ch-1',
        body: smallBody(),
        mime: 'audio/mpeg',
        originalName: 'x.mp3',
        uploader: OWNER,
      }),
    ).rejects.toThrow(/chapter does not belong/);
  });

  it('writes blob + row on the happy path', async () => {
    queue.push([baseText]);
    queue.push([
      {
        id: 'audio-1',
        textId: 'text-1',
        chapterId: null,
        storageKey: 'texts/text-1/audio-1.mp3',
        mime: 'audio/mpeg',
        sizeBytes: 4,
        durationMs: null,
        attribution: null,
        license: null,
        uploadedById: OWNER.id,
        createdAt: new Date(),
      },
    ]);
    const out = await uploadAudio({
      textId: 'text-1',
      body: smallBody(),
      mime: 'audio/mpeg',
      originalName: 'track.mp3',
      attribution: 'CC-BY narrator',
      license: 'CC-BY-4.0',
      durationMs: 90_000,
      uploader: OWNER,
    });
    expect(out.id).toBe('audio-1');
    expect(storage.put).toHaveBeenCalledOnce();
    const valuesArg = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.textId).toBe('text-1');
    expect(valuesArg.attribution).toBe('CC-BY narrator');
    expect(valuesArg.license).toBe('CC-BY-4.0');
    expect(valuesArg.durationMs).toBe(90_000);
    expect(valuesArg.sizeBytes).toBe(4);
  });

  it('lets an admin upload to a text they do not own', async () => {
    queue.push([baseText]); // owned by OWNER (u1), admin uploads anyway
    queue.push([
      {
        id: 'audio-2',
        textId: 'text-1',
        chapterId: null,
        storageKey: 'texts/text-1/audio-2.mp3',
        mime: 'audio/mpeg',
        sizeBytes: 4,
        durationMs: null,
        attribution: null,
        license: null,
        uploadedById: ADMIN.id,
        createdAt: new Date(),
      },
    ]);
    const out = await uploadAudio({
      textId: 'text-1',
      body: smallBody(),
      mime: 'audio/mpeg',
      originalName: 't.mp3',
      uploader: ADMIN,
    });
    expect(out.id).toBe('audio-2');
  });

  it('throws when the insert returns no row', async () => {
    queue.push([baseText]);
    queue.push([]); // returning empty
    await expect(
      uploadAudio({
        textId: 'text-1',
        body: smallBody(),
        mime: 'audio/mpeg',
        originalName: 'x.mp3',
        uploader: OWNER,
      }),
    ).rejects.toThrow(/insert returned no row/);
  });
});

describe('deleteAudio', () => {
  it('404s when the audio file is missing', async () => {
    queue.push([]);
    await expect(
      deleteAudio({ audioFileId: 'missing', actor: OWNER }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('403s a non-owner non-admin', async () => {
    queue.push([
      { id: 'audio-1', storageKey: 'texts/text-1/audio-1.mp3', ownerId: OWNER.id },
    ]);
    await expect(
      deleteAudio({ audioFileId: 'audio-1', actor: STRANGER }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('403s when the parent text has no owner and the actor is not admin', async () => {
    queue.push([
      { id: 'audio-1', storageKey: 'texts/text-1/audio-1.mp3', ownerId: null },
    ]);
    await expect(
      deleteAudio({ audioFileId: 'audio-1', actor: OWNER }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('removes the blob then the row for the owner', async () => {
    queue.push([
      { id: 'audio-1', storageKey: 'texts/text-1/audio-1.mp3', ownerId: OWNER.id },
    ]);
    queue.push([]); // db.delete().where() resolution
    await deleteAudio({ audioFileId: 'audio-1', actor: OWNER });
    expect(storage.delete).toHaveBeenCalledWith('texts/text-1/audio-1.mp3');
    expect(fakeDb.delete).toHaveBeenCalledOnce();
  });

  it('lets an admin delete an orphan-owned audio file', async () => {
    queue.push([
      { id: 'audio-1', storageKey: 'texts/text-1/audio-1.mp3', ownerId: null },
    ]);
    queue.push([]);
    await deleteAudio({ audioFileId: 'audio-1', actor: ADMIN });
    expect(storage.delete).toHaveBeenCalled();
  });
});

describe('listAudioForText', () => {
  it('returns rows decorated with the storage URL', async () => {
    queue.push([
      {
        id: 'audio-1',
        textId: 'text-1',
        chapterId: null,
        storageKey: 'texts/text-1/audio-1.mp3',
        mime: 'audio/mpeg',
        sizeBytes: 1234,
        durationMs: 60_000,
        attribution: 'me',
        license: 'CC-BY',
        uploadedById: OWNER.id,
        createdAt: new Date('2026-04-29T00:00:00Z'),
      },
    ]);
    const out = await listAudioForText('text-1');
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe('/audio/texts/text-1/audio-1.mp3');
    expect(out[0]?.durationMs).toBe(60_000);
    // Verify the where() narrowing — null chapterId means "all".
    expect(chain.where).toHaveBeenCalledOnce();
  });

  it('narrows the query when a chapterId is given', async () => {
    queue.push([]); // empty result is fine; we're checking the where call
    await listAudioForText('text-1', 'ch-1');
    expect(chain.where).toHaveBeenCalledOnce();
    // Two conditions get AND'd — we can't easily inspect drizzle SQL
    // expressions, but verifying the query happened + returned cleanly
    // is enough alongside the unrestricted-list case above.
  });

  it('returns an empty array when no rows match', async () => {
    queue.push([]);
    const out = await listAudioForText('text-1');
    expect(out).toEqual([]);
  });
});

void AudioError;
