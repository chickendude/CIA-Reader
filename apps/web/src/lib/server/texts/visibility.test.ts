// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => rows),
  set: vi.fn(() => chain),
  returning: vi.fn(() => rows),
};
const fakeDb = {
  select: vi.fn(() => chain),
  update: vi.fn(() => chain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: { texts: { id: 'tx.id' } },
}));

const { setTextVisibility } = await import('./visibility.js');

function resetAll() {
  rows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  fakeDb.update.mockClear();
}

beforeEach(resetAll);

const ADMIN = { id: 'admin-1', role: 'admin' as const };
const OWNER = { id: 'owner-1', role: 'user' as const };
const STRANGER = { id: 'stranger-1', role: 'user' as const };

describe('setTextVisibility', () => {
  it('lets the owner flip private → shared', async () => {
    chain.limit.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'private' },
    ]);
    chain.returning.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'shared' },
    ]);
    const r = await setTextVisibility({
      textId: 'tx-1',
      actor: OWNER,
      next: 'shared',
    });
    expect(r.visibility).toBe('shared');
  });

  it('rejects a stranger flipping owner-only transitions', async () => {
    chain.limit.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'private' },
    ]);
    await expect(
      setTextVisibility({ textId: 'tx-1', actor: STRANGER, next: 'shared' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('forbids non-admin from promoting to official', async () => {
    chain.limit.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'shared' },
    ]);
    await expect(
      setTextVisibility({ textId: 'tx-1', actor: OWNER, next: 'official' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('lets admin promote to official', async () => {
    chain.limit.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'shared' },
    ]);
    chain.returning.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'official' },
    ]);
    const r = await setTextVisibility({
      textId: 'tx-1',
      actor: ADMIN,
      next: 'official',
    });
    expect(r.visibility).toBe('official');
  });

  it('forbids the owner from demoting an official text', async () => {
    chain.limit.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'official' },
    ]);
    await expect(
      setTextVisibility({ textId: 'tx-1', actor: OWNER, next: 'private' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('returns 404 when the text does not exist', async () => {
    chain.limit.mockReturnValueOnce([]);
    await expect(
      setTextVisibility({ textId: 'no-such', actor: OWNER, next: 'shared' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns the existing row unchanged when next == current', async () => {
    chain.limit.mockReturnValueOnce([
      { id: 'tx-1', ownerId: OWNER.id, visibility: 'private' },
    ]);
    const r = await setTextVisibility({
      textId: 'tx-1',
      actor: OWNER,
      next: 'private',
    });
    expect(r.visibility).toBe('private');
    expect(fakeDb.update).not.toHaveBeenCalled();
  });
});
