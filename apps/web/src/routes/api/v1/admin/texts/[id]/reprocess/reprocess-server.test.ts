// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processTextNow = vi.fn();
const reprocessPdfText = vi.fn();
const requireUser = vi.fn();

// Stage rows for the ownership-check db lookup in the non-admin path.
const staged: Array<unknown[]> = [];
function stage(rows: unknown[]) {
  staged.push(rows);
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => {
    const v = staged.shift();
    if (!v) throw new Error('Test bug: no staged db result');
    return resolve(v);
  };
  return chain;
}

vi.mock('$lib/server/db/index.js', () => ({
  db: { select: () => makeSelectChain() },
  schema: {
    texts: { id: 'texts.id', ownerId: 'texts.ownerId' },
  },
}));

vi.mock('$lib/server/texts/in-process-dispatcher.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/texts/in-process-dispatcher.js')
  >('$lib/server/texts/in-process-dispatcher.js');
  return {
    ...actual,
    processTextNow: (...a: unknown[]) => processTextNow(...a),
  };
});

vi.mock('$lib/server/texts/pdf-page.js', () => ({
  reprocessPdfText: (...a: unknown[]) => reprocessPdfText(...a),
}));

vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type PostFn = (typeof import('./+server.js'))['POST'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = { id: 'admin-1', role: 'admin' as const };
const USER = { id: 'user-1', role: 'user' as const };

async function callPost(id = VALID_ID, user: typeof ADMIN | typeof USER | null = ADMIN) {
  if (user) requireUser.mockResolvedValueOnce(user);
  else requireUser.mockImplementationOnce(() => { throw { status: 401 }; });
  const { POST } = await import('./+server.js');
  const event = {
    params: { id },
    request: new Request(`http://x/api/v1/admin/texts/${id}/reprocess`, {
      method: 'POST',
    }),
  } as unknown as Parameters<PostFn>[0];
  try {
    return await POST(event);
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  processTextNow.mockReset();
  reprocessPdfText.mockReset();
  requireUser.mockReset();
  staged.length = 0;
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /api/v1/admin/texts/:id/reprocess', () => {
  it('runs the dispatcher and returns the token count for an admin', async () => {
    stage([{ id: VALID_ID, ownerId: ADMIN.id, sourceType: 'txt' }]);
    processTextNow.mockResolvedValueOnce(1234);
    const res = (await callPost()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tokensWritten).toBe(1234);
    expect(processTextNow).toHaveBeenCalledWith(VALID_ID);
    expect(reprocessPdfText).not.toHaveBeenCalled();
  });

  it('re-tokenizes a PDF from its stored layout (no Vision)', async () => {
    stage([{ id: VALID_ID, ownerId: ADMIN.id, sourceType: 'pdf' }]);
    reprocessPdfText.mockResolvedValueOnce(42);
    const res = (await callPost()) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tokensWritten).toBe(42);
    expect(reprocessPdfText).toHaveBeenCalledWith(VALID_ID);
    expect(processTextNow).not.toHaveBeenCalled();
  });

  // T-11.3: owners can retry their own failed text. Non-owners
  // (even authenticated readers) get a flat 404, matching the rest
  // of the texts API — we don't leak text existence.
  it('lets the text owner trigger a reprocess (T-11.3)', async () => {
    stage([{ id: VALID_ID, ownerId: USER.id, sourceType: 'txt' }]);
    processTextNow.mockResolvedValueOnce(99);
    const res = (await callPost(VALID_ID, USER)) as Response;
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tokensWritten).toBe(99);
  });

  it('returns 404 when a non-admin non-owner asks (T-11.3)', async () => {
    stage([{ id: VALID_ID, ownerId: 'someone-else' }]);
    const res = (await callPost(VALID_ID, USER)) as { status: number };
    expect(res.status).toBe(404);
    expect(processTextNow).not.toHaveBeenCalled();
  });

  it('returns 404 when the text does not exist for a non-admin', async () => {
    stage([]);
    const res = (await callPost(VALID_ID, USER)) as { status: number };
    expect(res.status).toBe(404);
    expect(processTextNow).not.toHaveBeenCalled();
  });

  it('rejects an invalid uuid with 400', async () => {
    const res = (await callPost('not-a-uuid')) as { status: number };
    expect(res.status).toBe(400);
  });
});
