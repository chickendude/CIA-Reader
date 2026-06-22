/**
 * PATCH + DELETE /api/v1/collections/:id (T-8.1).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser, resolveUser } from '$lib/server/auth/require-user.js';
import {
  CollectionError,
  deleteCollection,
  loadCollectionDetail,
  updateCollection,
  viewerHasCollectionShare,
} from '$lib/server/collections.js';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    coverUrl: z.string().url().max(500).nullable(),
    kind: z.enum(['chapter_book', 'course', 'anthology']),
    visibility: z.enum(['private', 'shared', 'official']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field required',
  });

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  const body = await parseJson(event.request, patchSchema);
  try {
    const collection = await updateCollection({
      collectionId: id,
      actor: { id: user.id, role: user.role },
      patch: body,
    });
    return json({ collection });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  try {
    await deleteCollection({
      collectionId: id,
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};

/**
 * GET /api/v1/collections/:id — collection detail + ordered member texts,
 * for a Bearer/API client (the web uses the page loader). Visibility gate
 * mirrors the collection-detail page: owner, admin, anyone for `official`,
 * or a viewer with a share grant. Anything else 404s (not 403) so a private
 * collection never leaks its existence.
 */
export const GET: RequestHandler = async (event) => {
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');

  const detail = await loadCollectionDetail(id);
  if (!detail) throw error(404, 'Collection not found');

  const c = detail.collection;
  const viewer = await resolveUser(event);
  const isOwner = Boolean(viewer && c.ownerId === viewer.id);
  const isAdmin = viewer?.role === 'admin';
  const hasShare =
    !isOwner &&
    !isAdmin &&
    viewer != null &&
    c.visibility !== 'official' &&
    (await viewerHasCollectionShare(viewer.id, c.id));
  if (c.visibility !== 'official' && !isOwner && !isAdmin && !hasShare) {
    throw error(404, 'Collection not found');
  }

  return json({
    collection: {
      id: c.id,
      ownerId: c.ownerId,
      language: c.language,
      kind: c.kind,
      title: c.title,
      description: c.description,
      coverUrl: c.coverUrl,
      visibility: c.visibility,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    },
    items: detail.items.map((item) => ({
      position: item.position,
      sectionTitle: item.sectionTitle,
      text: {
        id: item.text.id,
        title: item.text.title,
        language: item.text.language,
        sourceType: item.text.sourceType,
        status: item.text.status,
        visibility: item.text.visibility,
        createdAt: item.text.createdAt,
      },
    })),
  });
};
