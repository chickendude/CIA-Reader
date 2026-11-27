// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { deleteReviewedUsers, listUsers, reviewDeletion } from '$lib/server/auth/user-directory.js';
import { actions, load } from './+page.server.js';
import { blockNetwork, networkKey, unblockNetwork } from '$lib/server/auth/user-networks.js';

vi.mock('$lib/server/auth/user-networks.js', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/server/auth/user-networks.js')>(),
  blockNetwork: vi.fn(), unblockNetwork: vi.fn(),
}));

vi.mock('$lib/server/auth/user-directory.js', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/server/auth/user-directory.js')>(),
  listUsers: vi.fn(), deleteReviewedUsers: vi.fn(), reviewDeletion: vi.fn(),
}));

function event(role: string, query = '') {
  return {
    parent: async () => ({ moderator: { role } }),
    url: new URL(`http://localhost/moderation/users${query}`),
    setHeaders: vi.fn(),
  } as unknown as Parameters<typeof load>[0];
}

it('blocks curators before querying account details', async () => {
  await expect(load(event('curator'))).rejects.toMatchObject({ status: 403 });
  expect(listUsers).not.toHaveBeenCalled();
});

it('passes the selected filters and page to the admin directory', async () => {
  const request = event('admin', '?joined=24h&verification=unverified&page=2');
  await load(request);
  expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ recent: true, verification: 'unverified', page: 2, sort: expect.objectContaining({ value: 'most-ips' }) }));
  expect(request.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
});

function post(role: string, fields = new URLSearchParams()) {
  const url = new URL('http://localhost/moderation/users');
  return {
    url, getClientAddress: () => '192.0.2.1', locals: { user: { role, id: 'moderator' } },
    request: new Request(url, { method: 'POST', body: fields }),
  } as unknown as Parameters<typeof actions.delete>[0];
}

it('rejects direct delete and review submissions from a curator', async () => {
  await expect(actions.delete(post('curator'))).rejects.toMatchObject({ status: 403 });
  await expect(actions.review(post('curator'))).rejects.toMatchObject({ status: 403 });
  expect(deleteReviewedUsers).not.toHaveBeenCalled();
  expect(reviewDeletion).not.toHaveBeenCalled();
});

it('requires explicit account IDs and confirmation for deletion', async () => {
  const fields = new URLSearchParams({ network: 'a'.repeat(64), confirm: 'delete' });
  expect(await actions.delete(post('admin', fields))).toMatchObject({ status: 400 });
  expect(deleteReviewedUsers).not.toHaveBeenCalled();
});

it('requires admin access and the full network key for block changes', async () => {
  for (const action of [actions.block, actions.unblock]) {
    await expect(action(post('curator'))).rejects.toMatchObject({ status: 403 });
    expect(await action(post('admin', new URLSearchParams({ network: '013384cc6c23' })))).toMatchObject({ status: 400 });
  }
  const ownKey = networkKey(() => '192.0.2.1')!;
  expect(await actions.block(post('admin', new URLSearchParams({ network: ownKey })))).toMatchObject({ status: 400 });
  expect(blockNetwork).not.toHaveBeenCalled();
  expect(unblockNetwork).not.toHaveBeenCalled();
  const key = networkKey(() => '192.0.2.8')!;
  await actions.block(post('admin', new URLSearchParams({ network: key })));
  await actions.unblock(post('admin', new URLSearchParams({ network: key })));
  expect(blockNetwork).toHaveBeenCalledWith(key);
  expect(unblockNetwork).toHaveBeenCalledWith(key);
});
