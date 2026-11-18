import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { isCuratorOrAdmin } from '../dictionary/permissions.js';

/** Resolve staff status from the database, including for ID-only API callers. */
export async function isStaffMember(userId: string): Promise<boolean> {
  const [user] = await db.select({ role: schema.users.role }).from(schema.users)
    .where(eq(schema.users.id, userId)).limit(1);
  return isCuratorOrAdmin(user);
}
