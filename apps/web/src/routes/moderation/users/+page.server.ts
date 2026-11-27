import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
  deleteReviewedUsers, directoryFilters, listIpGroups, listUsers, reviewDeletion,
} from '$lib/server/auth/user-directory.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url, setHeaders }) => {
  const { moderator } = await parent();
  if (moderator.role !== 'admin') error(403, 'Admin role required');
  setHeaders({ 'cache-control': 'private, no-store' });
  const filters = directoryFilters(url);
  const result = filters.grouped ? await listIpGroups(filters) : await listUsers(filters);
  return { filters, ...result, asOf: Date.now() };
};

function adminId(locals: App.Locals) {
  if (locals.user?.role !== 'admin') error(403, 'Admin role required');
  return locals.user.id;
}

const idsSchema = z.array(z.string().uuid());
const networksSchema = z.array(z.string().regex(/^[0-9a-f]{64}$/));

export const actions = {
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
