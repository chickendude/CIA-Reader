import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { blockNetwork, isNetworkBlocked, listBlockedNetworks, networkKey, unblockNetwork } from '$lib/server/auth/user-networks.js';
import {
  deleteReviewedUsers, directoryFilters, listIpGroups, listUsers, reviewDeletion, selectedSignupRetries,
} from '$lib/server/auth/user-directory.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url, setHeaders, getClientAddress }) => {
  const { moderator } = await parent();
  if (moderator.role !== 'admin') error(403, 'Admin role required');
  setHeaders({ 'cache-control': 'private, no-store' });
  const filters = directoryFilters(url);
  const [result, blockedNetworks, selectedBlocked, retrySummary] = await Promise.all([
    filters.grouped ? listIpGroups(filters) : listUsers(filters),
    filters.grouped ? listBlockedNetworks() : [],
    filters.network ? isNetworkBlocked(filters.network) : false,
    filters.network && !filters.grouped ? selectedSignupRetries(filters.network) : null,
  ]);
  const usingSelectedNetwork = !!filters.network && filters.network === networkKey(getClientAddress);
  return { filters, ...result, blockedNetworks, selectedBlocked, usingSelectedNetwork, retrySummary, asOf: Date.now() };
};

function adminId(locals: App.Locals) {
  if (locals.user?.role !== 'admin') error(403, 'Admin role required');
  return locals.user.id;
}

const idsSchema = z.array(z.string().uuid());
const networkSchema = z.string().regex(/^[0-9a-f]{64}$/);
const networksSchema = z.array(networkSchema);

export const actions = {
  block: async ({ locals, request, getClientAddress }) => {
    adminId(locals);
    const network = networkSchema.safeParse((await request.formData()).get('network'));
    if (!network.success) return fail(400, { message: 'Invalid IP group.' });
    if (network.data === networkKey(getClientAddress)) {
      return fail(400, { message: 'You are using this IP address. Blocking it would lock you out.' });
    }
    await blockNetwork(network.data);
    return { notice: 'IP address blocked.' };
  },
  unblock: async ({ locals, request }) => {
    adminId(locals);
    const network = networkSchema.safeParse((await request.formData()).get('network'));
    if (!network.success) return fail(400, { message: 'Invalid IP group.' });
    await unblockNetwork(network.data);
    return { notice: 'IP address unblocked.' };
  },
  review: async ({ locals, request, url }) => {
    adminId(locals);
    const fields = await request.formData();
    const ids = idsSchema.safeParse(fields.getAll('user'));
    const networks = networksSchema.safeParse(fields.getAll('network'));
    if (!ids.success || !networks.success) return fail(400, { message: 'Invalid selection.' });
    if (!ids.data.length && !networks.data.length) return fail(400, { message: 'Select at least one user or IP group.' });
    const preview = await reviewDeletion(directoryFilters(url), ids.data, networks.data);
    if (!preview.length) return fail(400, { message: 'The selection contains no deletable users.' });
    return { preview };
  },
  delete: async ({ locals, request }) => {
    const actor = adminId(locals);
    const fields = await request.formData();
    const ids = idsSchema.nonempty().safeParse(fields.getAll('user'));
    if (!ids.success || fields.get('confirm') !== 'delete') {
      return fail(400, { message: 'Review and confirm the accounts to delete.' });
    }
    return { deleted: await deleteReviewedUsers(actor, [...new Set(ids.data)]) };
  },
} satisfies Actions;
