/**
 * Text-share service (T-7.2 / T-7.4).
 *
 * Manages per-recipient `text_shares` rows. Granting a share also
 * promotes the text's visibility from 'private' to 'shared' so
 * canReadText can find it cleanly without needing a special-case
 * "private but shared with X" branch.
 *
 * Owner-or-admin only on every mutation. Listing the recipients of
 * a text is owner-only too — strangers shouldn't be able to learn
 * who else has access.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type {
  Text,
  TextGroupShare,
  TextShare,
  User,
} from '../db/schema.js';

export class TextShareError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'TextShareError';
  }
}

export type ShareInput = {
  textId: string;
  recipientUserId: string;
  actor: Pick<User, 'id' | 'role'>;
};

async function loadText(textId: string): Promise<Text | null> {
  const [text] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1)) as Text[];
  return text ?? null;
}

function canManageShares(
  text: Text,
  actor: Pick<User, 'id' | 'role'>,
): boolean {
  if (actor.role === 'admin') return true;
  return text.ownerId === actor.id;
}

export async function grantTextShare(input: ShareInput): Promise<TextShare> {
  const text = await loadText(input.textId);
  if (!text) throw new TextShareError('text not found', 404);
  if (!canManageShares(text, input.actor)) {
    throw new TextShareError('only the owner can share', 403);
  }
  if (text.ownerId === input.recipientUserId) {
    throw new TextShareError('cannot share a text with its owner');
  }

  // Verify the recipient exists. A bogus userId would surface as a
  // 23503 FK error; we want a clean 404.
  const [recipient] = (await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, input.recipientUserId))
    .limit(1)) as Array<{ id: string }>;
  if (!recipient) throw new TextShareError('recipient not found', 404);

  const now = new Date();
  const [row] = await db
    .insert(schema.textShares)
    .values({
      textId: input.textId,
      sharedWithUserId: input.recipientUserId,
      permission: 'read',
      grantedById: input.actor.id,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.textShares.textId,
        schema.textShares.sharedWithUserId,
      ],
      set: {
        permission: 'read',
        grantedById: input.actor.id,
      },
    })
    .returning();
  if (!row) throw new TextShareError('insert returned no row');

  // Promote private → shared so canReadText accepts shared readers.
  if (text.visibility === 'private') {
    await db
      .update(schema.texts)
      .set({ visibility: 'shared', updatedAt: now })
      .where(eq(schema.texts.id, input.textId));
  }
  return row as TextShare;
}

export async function revokeTextShare(input: ShareInput): Promise<void> {
  const text = await loadText(input.textId);
  if (!text) throw new TextShareError('text not found', 404);
  if (!canManageShares(text, input.actor)) {
    throw new TextShareError('only the owner can revoke', 403);
  }
  await db
    .delete(schema.textShares)
    .where(
      and(
        eq(schema.textShares.textId, input.textId),
        eq(schema.textShares.sharedWithUserId, input.recipientUserId),
      ),
    );
}

export async function listTextShares(
  textId: string,
  actor: Pick<User, 'id' | 'role'>,
): Promise<TextShare[]> {
  const text = await loadText(textId);
  if (!text) throw new TextShareError('text not found', 404);
  if (!canManageShares(text, actor)) {
    throw new TextShareError('only the owner can list shares', 403);
  }
  const rows = (await db
    .select()
    .from(schema.textShares)
    .where(eq(schema.textShares.textId, textId))) as TextShare[];
  return rows;
}

export type GroupShareInput = {
  textId: string;
  groupId: string;
  actor: Pick<User, 'id' | 'role'>;
};

/**
 * T-7.4: grant a group access to a text. Owner-or-admin only on
 * the text. We don't require the actor to be a member of the
 * target group — sharing TO a group is a one-way grant; they
 * don't need to be inside the group to share with it.
 */
export async function grantTextGroupShare(
  input: GroupShareInput,
): Promise<TextGroupShare> {
  const text = await loadText(input.textId);
  if (!text) throw new TextShareError('text not found', 404);
  if (!canManageShares(text, input.actor)) {
    throw new TextShareError('only the owner can share', 403);
  }
  // Verify the group exists.
  const [group] = (await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.id, input.groupId))
    .limit(1)) as Array<{ id: string }>;
  if (!group) throw new TextShareError('group not found', 404);

  const now = new Date();
  const [row] = await db
    .insert(schema.textGroupShares)
    .values({
      textId: input.textId,
      groupId: input.groupId,
      grantedById: input.actor.id,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.textGroupShares.textId,
        schema.textGroupShares.groupId,
      ],
      set: { grantedById: input.actor.id },
    })
    .returning();
  if (!row) throw new TextShareError('insert returned no row');

  if (text.visibility === 'private') {
    await db
      .update(schema.texts)
      .set({ visibility: 'shared', updatedAt: now })
      .where(eq(schema.texts.id, input.textId));
  }
  return row as TextGroupShare;
}

export async function revokeTextGroupShare(
  input: GroupShareInput,
): Promise<void> {
  const text = await loadText(input.textId);
  if (!text) throw new TextShareError('text not found', 404);
  if (!canManageShares(text, input.actor)) {
    throw new TextShareError('only the owner can revoke', 403);
  }
  await db
    .delete(schema.textGroupShares)
    .where(
      and(
        eq(schema.textGroupShares.textId, input.textId),
        eq(schema.textGroupShares.groupId, input.groupId),
      ),
    );
}

export async function listTextGroupShares(
  textId: string,
  actor: Pick<User, 'id' | 'role'>,
): Promise<TextGroupShare[]> {
  const text = await loadText(textId);
  if (!text) throw new TextShareError('text not found', 404);
  if (!canManageShares(text, actor)) {
    throw new TextShareError('only the owner can list group shares', 403);
  }
  const rows = (await db
    .select()
    .from(schema.textGroupShares)
    .where(eq(schema.textGroupShares.textId, textId))) as TextGroupShare[];
  return rows;
}

/**
 * Has the viewer been granted a direct share on `textId`? Used by
 * `canReadText` (T-4.6) to extend the readability gate.
 */
export async function viewerHasDirectShare(
  viewerId: string,
  textId: string,
): Promise<boolean> {
  const [row] = (await db
    .select({ textId: schema.textShares.textId })
    .from(schema.textShares)
    .where(
      and(
        eq(schema.textShares.textId, textId),
        eq(schema.textShares.sharedWithUserId, viewerId),
      ),
    )
    .limit(1)) as Array<{ textId: string }>;
  return Boolean(row);
}
