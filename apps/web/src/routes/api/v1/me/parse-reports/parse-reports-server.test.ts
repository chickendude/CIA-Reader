// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fileParseReport = vi.fn();
const requireUser = vi.fn();

vi.mock('$lib/server/parse-reports.js', () => ({
  fileParseReport: (...a: unknown[]) => fileParseReport(...a),
}));
vi.mock('$lib/server/auth/require-user.js', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

type Post = (typeof import('./+server.js'))['POST'];

const TOKEN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEMMA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function call(body: unknown) {
  const { POST } = await import('./+server.js');
  const event = {
    request: new Request('http://x/api/v1/me/parse-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<Post>[0];
  try {
    return (await POST(event)) as Response;
  } catch (e) {
    return e as { status: number };
  }
}

beforeEach(() => {
  fileParseReport.mockReset();
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: 'u1' });
});

afterEach(() => vi.resetModules());

describe('POST /api/v1/me/parse-reports', () => {
  it('files a fresh report and returns 201', async () => {
    fileParseReport.mockResolvedValueOnce({
      report: { id: 'pr-1' },
      merged: false,
    });
    const res = (await call({
      tokenId: TOKEN,
      language: 'hi',
      surfaceNfc: 'पाठ',
      correctedLemmaId: LEMMA,
      correctionType: 'manual_lemma',
      originalCandidates: [],
    })) as Response;
    expect(res.status).toBe(201);
    expect(fileParseReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: 'u1',
        language: 'hi',
        surfaceNfc: 'पाठ',
      }),
    );
  });

  it('returns 200 (not 201) when the call merged into an existing report', async () => {
    fileParseReport.mockResolvedValueOnce({
      report: { id: 'pr-1', duplicateCount: 4 },
      merged: true,
    });
    const res = (await call({
      tokenId: TOKEN,
      language: 'hi',
      surfaceNfc: 'पाठ',
      correctedLemmaId: LEMMA,
      correctionType: 'manual_lemma',
    })) as Response;
    expect(res.status).toBe(200);
  });

  it('rejects an unknown language with 400', async () => {
    const r = (await call({
      tokenId: TOKEN,
      language: 'fr',
      surfaceNfc: 'lapin',
      correctionType: 'manual_lemma',
      correctedLemmaId: LEMMA,
    })) as { status: number };
    expect(r.status).toBe(400);
    expect(fileParseReport).not.toHaveBeenCalled();
  });

  it('rejects an unknown correction type', async () => {
    const r = (await call({
      tokenId: TOKEN,
      language: 'hi',
      surfaceNfc: 'पाठ',
      correctionType: 'invented',
    })) as { status: number };
    expect(r.status).toBe(400);
  });
});
