/** Sharing a text with a reader or group can also change its visibility. */
import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Text, User } from '../db/schema.js';

export class TextVisibilityError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'TextVisibilityError';
  }
}

export type Visibility = Text['visibility'];

export type SetVisibilityInput = {
  textId: string;
  actor: Pick<User, 'id' | 'role'>;
  next: Visibility;
};

export async function setTextVisibility(
  input: SetVisibilityInput,
): Promise<Text> {
  const [text] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, input.textId))
    .limit(1)) as Text[];
  if (!text) throw new TextVisibilityError('text not found', 404);

  // Promote-to-official path is admin-only.
  if (input.next === 'official' && input.actor.role !== 'admin') {
    throw new TextVisibilityError('Only admins can mark a text official', 403);
  }
  // Demote-from-official path is also admin-only — once a text is in
  // the public library, the owner shouldn't be able to silently pull
  // it without curator review.
  if (text.visibility === 'official' && input.actor.role !== 'admin') {
    throw new TextVisibilityError(
      'Only admins can change visibility on an official text',
      403,
    );
  }
  // Everything else (private ↔ shared) is owner-only.
  if (text.ownerId !== input.actor.id && input.actor.role !== 'admin') {
    throw new TextVisibilityError('Only the owner can change visibility', 403);
  }

  if (text.visibility === input.next) return text;

  const [updated] = await db
    .update(schema.texts)
    .set({ visibility: input.next, ...(input.next === 'official' ? { staffOnly: true } : {}), updatedAt: new Date() })
    .where(eq(schema.texts.id, input.textId))
    .returning();
  if (!updated) throw new TextVisibilityError('update returned no row', 404);
  return updated as Text;
}
