// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { recentSiteActivity } from '$lib/server/auth/user-directory.js';
import { load } from './+page.server.js';

vi.mock('$lib/server/auth/user-directory.js', () => ({ recentSiteActivity: vi.fn() }));

function visit(role: string, query: string) {
  return load({
    url: new URL('http://localhost/moderation' + query),
    parent: async () => ({ moderator: { role } }),
    setHeaders: vi.fn(),
  } as unknown as Parameters<typeof load>[0]);
}

beforeEach(() => vi.clearAllMocks());

it('opens language tools without querying site activity', async () => {
  await expect(visit('admin', '')).resolves.toEqual({ activity: null });
  expect(recentSiteActivity).not.toHaveBeenCalled();
});

it('blocks site statistics for curators', async () => {
  await expect(visit('curator', '?tab=site')).rejects.toMatchObject({ status: 403 });
  expect(recentSiteActivity).not.toHaveBeenCalled();
});

it('returns site statistics for admins', async () => {
  const activity = { signups: 3, unverifiedSignups: 2, emailLinks: 4 };
  vi.mocked(recentSiteActivity).mockResolvedValue(activity);
  await expect(visit('admin', '?tab=site')).resolves.toEqual({ activity });
});
