/**
 * Groups service (T-7.3).
 *
 * A group is a small bag of users (classroom roster, study club).
 * The creator owns it; only the owner can rename / delete or add /
 * remove members. T-7.4 builds on the membership lookup here for
 * the share-with-group flow.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type { Group, GroupMembership, User } from './db/schema.js';

export class GroupError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'GroupError';
  }
}

export type CreateGroupInput = {
  ownerId: string;
  name: string;
  description?: string | null;
};

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const name = input.name.trim();
  if (!name) throw new GroupError('name required');
  const [row] = await db
    .insert(schema.groups)
    .values({
      ownerId: input.ownerId,
      name,
      description: input.description?.trim() || null,
    })
    .returning();
  if (!row) throw new GroupError('insert returned no row');
  // Auto-add the creator as a member so listings of "groups I'm in"
  // include the ones I own.
  await db
    .insert(schema.groupMemberships)
    .values({
      groupId: (row as Group).id,
      userId: input.ownerId,
      addedById: input.ownerId,
    })
    .onConflictDoNothing({
      target: [schema.groupMemberships.groupId, schema.groupMemberships.userId],
    });
  return row as Group;
}

async function loadGroup(id: string): Promise<Group | null> {
  const [row] = (await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, id))
    .limit(1)) as Group[];
  return row ?? null;
}

function canManageGroup(group: Group, actor: Pick<User, 'id' | 'role'>): boolean {
  return actor.role === 'admin' || group.ownerId === actor.id;
}

export type GroupActorInput = {
  groupId: string;
  actor: Pick<User, 'id' | 'role'>;
};

export async function deleteGroup(input: GroupActorInput): Promise<void> {
  const g = await loadGroup(input.groupId);
  if (!g) throw new GroupError('group not found', 404);
  if (!canManageGroup(g, input.actor)) {
    throw new GroupError('only the owner can delete', 403);
  }
  await db.delete(schema.groups).where(eq(schema.groups.id, input.groupId));
}

export type AddMemberInput = GroupActorInput & {
  userId: string;
};

export async function addMember(
  input: AddMemberInput,
): Promise<GroupMembership> {
  const g = await loadGroup(input.groupId);
  if (!g) throw new GroupError('group not found', 404);
  if (!canManageGroup(g, input.actor)) {
    throw new GroupError('only the owner can add members', 403);
  }
  const [user] = (await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .limit(1)) as Array<{ id: string }>;
  if (!user) throw new GroupError('user not found', 404);
  const [row] = await db
    .insert(schema.groupMemberships)
    .values({
      groupId: input.groupId,
      userId: input.userId,
      addedById: input.actor.id,
    })
    .onConflictDoNothing({
      target: [schema.groupMemberships.groupId, schema.groupMemberships.userId],
    })
    .returning();
  if (row) return row as GroupMembership;
  // Already a member — return the existing row.
  const [existing] = (await db
    .select()
    .from(schema.groupMemberships)
    .where(
      and(
        eq(schema.groupMemberships.groupId, input.groupId),
        eq(schema.groupMemberships.userId, input.userId),
      ),
    )
    .limit(1)) as GroupMembership[];
  if (!existing) throw new GroupError('membership upsert lost the row');
  return existing;
}

export async function removeMember(input: AddMemberInput): Promise<void> {
  const g = await loadGroup(input.groupId);
  if (!g) throw new GroupError('group not found', 404);
  if (!canManageGroup(g, input.actor)) {
    throw new GroupError('only the owner can remove members', 403);
  }
  if (g.ownerId === input.userId) {
    throw new GroupError('the owner cannot leave their own group');
  }
  await db
    .delete(schema.groupMemberships)
    .where(
      and(
        eq(schema.groupMemberships.groupId, input.groupId),
        eq(schema.groupMemberships.userId, input.userId),
      ),
    );
}

export async function listGroupMembers(
  input: GroupActorInput,
): Promise<GroupMembership[]> {
  const g = await loadGroup(input.groupId);
  if (!g) throw new GroupError('group not found', 404);
  if (!canManageGroup(g, input.actor)) {
    throw new GroupError('only the owner can list members', 403);
  }
  const rows = (await db
    .select()
    .from(schema.groupMemberships)
    .where(eq(schema.groupMemberships.groupId, input.groupId))) as GroupMembership[];
  return rows;
}

export async function listGroupsForUser(userId: string): Promise<Group[]> {
  const rows = (await db
    .select({
      id: schema.groups.id,
      ownerId: schema.groups.ownerId,
      name: schema.groups.name,
      description: schema.groups.description,
      createdAt: schema.groups.createdAt,
      updatedAt: schema.groups.updatedAt,
    })
    .from(schema.groups)
    .innerJoin(
      schema.groupMemberships,
      eq(schema.groupMemberships.groupId, schema.groups.id),
    )
    .where(eq(schema.groupMemberships.userId, userId))) as Group[];
  return rows;
}

/** Used by canReadText (T-7.4) — does this user share a group with
 *  any group that has been granted access to `textId`? */
export async function viewerHasGroupShare(
  viewerId: string,
  textId: string,
): Promise<boolean> {
  const [row] = (await db
    .select({ textId: schema.textGroupShares.textId })
    .from(schema.textGroupShares)
    .innerJoin(
      schema.groupMemberships,
      eq(schema.groupMemberships.groupId, schema.textGroupShares.groupId),
    )
    .where(
      and(
        eq(schema.textGroupShares.textId, textId),
        eq(schema.groupMemberships.userId, viewerId),
      ),
    )
    .limit(1)) as Array<{ textId: string }>;
  return Boolean(row);
}
