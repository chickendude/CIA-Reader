// @vitest-environment node
/**
 * Tests for /moderation/translations SSR loader + form actions (T-11.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listReports = vi.fn();
const bulkResolveByTranslation = vi.fn();
const resolveReport = vi.fn();
const setUserRole = vi.fn();
const listGrantedLanguages = vi.fn();

vi.mock('$lib/server/moderation/reports.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/moderation/reports.js')>(
    '$lib/server/moderation/reports.js',
  );
  return {
    ...actual,
    listReports: (...a: unknown[]) => listReports(...a),
    bulkResolveByTranslation: (...a: unknown[]) => bulkResolveByTranslation(...a),
    resolveReport: (...a: unknown[]) => resolveReport(...a),
  };
});

vi.mock('$lib/server/dictionary/admin.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/admin.js')>(
    '$lib/server/dictionary/admin.js',
  );
  return {
    ...actual,
    setUserRole: (...a: unknown[]) => setUserRole(...a),
  };
});

vi.mock('$lib/server/dictionary/permissions.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/dictionary/permissions.js')>(
    '$lib/server/dictionary/permissions.js',
  );
  return {
    ...actual,
    listGrantedLanguages: (...a: unknown[]) => listGrantedLanguages(...a),
  };
});

type Mod = typeof import('./+page.server.js');

async function importMod(): Promise<Mod> {
  return (await import('./+page.server.js')) as Mod;
}

const TR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REPORT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

type Viewer = {
  id: string;
  role: 'user' | 'curator' | 'admin';
  email: string;
  passwordHash: string | null;
  displayName: string | null;
  emailVerifiedAt: Date | null;
  onboardedAt: Date | null;
  themePreference: 'system' | 'light' | 'dark';
  createdAt: Date;
  updatedAt: Date;
};
const CURATOR_VIEWER: Viewer = {
  id: 'curator-1',
  role: 'curator',
  email: 'c@test',
  passwordHash: null,
  displayName: null,
  emailVerifiedAt: null,
  onboardedAt: null,
  themePreference: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const ADMIN_VIEWER: Viewer = { ...CURATOR_VIEWER, id: 'admin-1', role: 'admin' };

beforeEach(() => {
  listReports.mockReset();
  bulkResolveByTranslation.mockReset();
  resolveReport.mockReset();
  setUserRole.mockReset();
  listGrantedLanguages.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

async function callLoad(url: string, role: 'curator' | 'admin' | 'user' = 'curator') {
  const { load } = await importMod();
  const parent = vi.fn().mockResolvedValue({
    moderator: {
      id: role === 'admin' ? 'admin-1' : 'curator-1',
      role,
      grantedLanguages: role === 'admin' ? ['hi', 'mr', 'or'] : ['hi'],
    },
  });
  const event = { url: new URL(url), parent } as unknown as Parameters<Mod['load']>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number };
  }
}

async function callAction(
  actionName: 'hide' | 'keep' | 'dismiss' | 'promoteReporter',
  formFields: Record<string, string>,
  user: Viewer | null = CURATOR_VIEWER,
) {
  const mod = await importMod();
  const action = mod.actions[actionName] as (event: unknown) => Promise<unknown>;
  const fd = new FormData();
  for (const [k, v] of Object.entries(formFields)) fd.set(k, v);
  const event = {
    request: new Request('http://x/moderation/translations', {
      method: 'POST',
      body: fd,
    }),
    locals: { user },
  };
  try {
    return await action(event);
  } catch (e) {
    return e as { status: number };
  }
}

describe('/moderation/translations loader', () => {
  it('passes the parent moderator + filter into listReports and returns the rows', async () => {
    listReports.mockResolvedValueOnce([{ report: { id: 'rep-1' } }]);
    const data = (await callLoad('http://x/moderation/translations')) as {
      reports: Array<{ report: { id: string } }>;
      filter: { status: string; language: string | null };
    };
    expect(data.filter.status).toBe('open');
    expect(data.filter.language).toBeNull();
    expect(data.reports[0]!.report.id).toBe('rep-1');
    const callArgs = listReports.mock.calls[0]!;
    expect((callArgs[0] as { id: string }).id).toBe('curator-1');
    expect(callArgs[1]).toMatchObject({ status: 'open' });
  });

  it('honours ?status= query', async () => {
    listReports.mockResolvedValueOnce([]);
    const data = (await callLoad(
      'http://x/moderation/translations?status=resolved_kept',
    )) as { filter: { status: string } };
    expect(data.filter.status).toBe('resolved_kept');
  });

  it('400s on an unknown status', async () => {
    const res = (await callLoad(
      'http://x/moderation/translations?status=mystery',
    )) as { status: number };
    expect(res.status).toBe(400);
  });

  it('403s when curator filters by an ungranted language', async () => {
    const res = (await callLoad(
      'http://x/moderation/translations?language=or',
    )) as { status: number };
    expect(res.status).toBe(403);
  });

  it('admin sees all languages on filter', async () => {
    listReports.mockResolvedValueOnce([]);
    const data = (await callLoad(
      'http://x/moderation/translations?language=or',
      'admin',
    )) as { filter: { language: string | null } };
    expect(data.filter.language).toBe('or');
  });
});

describe('hide action', () => {
  it('403s a non-curator', async () => {
    const res = await callAction(
      'hide',
      { translationId: TR_ID, reason: 'low quality' },
      null,
    );
    expect((res as { status: number }).status).toBe(403);
    expect(bulkResolveByTranslation).not.toHaveBeenCalled();
  });

  it('400s when translationId is missing/invalid', async () => {
    const res = await callAction('hide', { translationId: 'no', reason: 'r' });
    expect((res as { status: number }).status).toBe(400);
  });

  it('400s when reason is too short', async () => {
    const res = await callAction('hide', { translationId: TR_ID, reason: 'a' });
    expect((res as { status: number }).status).toBe(400);
  });

  it('calls bulkResolveByTranslation with resolved_hidden + the granted languages from the viewer', async () => {
    listGrantedLanguages.mockResolvedValueOnce(['hi']);
    bulkResolveByTranslation.mockResolvedValueOnce({
      translation: { id: TR_ID, hidden: true },
      reportsAffected: 2,
      status: 'resolved_hidden',
    });
    const res = await callAction('hide', {
      translationId: TR_ID,
      reason: 'low quality',
    });
    expect(bulkResolveByTranslation).toHaveBeenCalledWith(
      { id: 'curator-1', role: 'curator', grantedLanguages: ['hi'] },
      TR_ID,
      'resolved_hidden',
      'low quality',
    );
    expect((res as { ok: boolean; reportsAffected: number }).ok).toBe(true);
    expect((res as { reportsAffected: number }).reportsAffected).toBe(2);
  });
});

describe('keep action', () => {
  it('flips reports to resolved_kept', async () => {
    listGrantedLanguages.mockResolvedValueOnce(['hi']);
    bulkResolveByTranslation.mockResolvedValueOnce({
      translation: { id: TR_ID, hidden: false },
      reportsAffected: 1,
      status: 'resolved_kept',
    });
    const res = await callAction('keep', { translationId: TR_ID, note: 'fine' });
    expect(bulkResolveByTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'curator-1' }),
      TR_ID,
      'resolved_kept',
      'fine',
    );
    expect((res as { ok: boolean }).ok).toBe(true);
  });
});

describe('dismiss action', () => {
  it('calls resolveReport with the right args', async () => {
    listGrantedLanguages.mockResolvedValueOnce(['hi']);
    resolveReport.mockResolvedValueOnce({ id: REPORT_ID, status: 'dismissed' });
    const res = await callAction('dismiss', { reportId: REPORT_ID });
    expect(resolveReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'curator-1' }),
      REPORT_ID,
      'dismiss',
      null,
    );
    expect((res as { ok: boolean }).ok).toBe(true);
  });
});

describe('promoteReporter action', () => {
  it('403s a curator', async () => {
    const res = await callAction(
      'promoteReporter',
      { reporterId: USER_ID },
      CURATOR_VIEWER,
    );
    expect((res as { status: number }).status).toBe(403);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it('admin promotes a user', async () => {
    setUserRole.mockResolvedValueOnce({ id: USER_ID, email: 'r@test', role: 'curator' });
    const res = await callAction(
      'promoteReporter',
      { reporterId: USER_ID },
      ADMIN_VIEWER,
    );
    expect(setUserRole).toHaveBeenCalledWith(USER_ID, 'curator');
    expect(
      (res as { ok: boolean; promoted: { email: string } }).promoted.email,
    ).toBe('r@test');
  });

  it('admin sees a 409 when the demotion would leave zero admins', async () => {
    const { LastAdminError } = await import('$lib/server/dictionary/admin.js');
    setUserRole.mockRejectedValueOnce(new LastAdminError());
    const res = await callAction(
      'promoteReporter',
      { reporterId: USER_ID },
      ADMIN_VIEWER,
    );
    expect((res as { status: number }).status).toBe(409);
  });

  it('admin sees 404 when the reporter no longer exists', async () => {
    const { UserNotFoundError } = await import('$lib/server/dictionary/admin.js');
    setUserRole.mockRejectedValueOnce(new UserNotFoundError(USER_ID));
    const res = await callAction(
      'promoteReporter',
      { reporterId: USER_ID },
      ADMIN_VIEWER,
    );
    expect((res as { status: number }).status).toBe(404);
  });
});
