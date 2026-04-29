/**
 * Text visibility transitions (T-7.1).
 *
 * The texts.visibility column has three values: 'private', 'shared',
 * 'official'. Transitions:
 *
 *   - 'private' ↔ 'shared': owner-only. Sharing surfaces (T-7.2 /
 *     T-7.4) flip a text to 'shared' as a side effect of granting
 *     a recipient — but the owner can also flip it directly through
 *     this service to bulk-grant later.
 *   - any → 'official': admin-only. Promoting to the public official
 *     library is a curatorial decision; we don't allow ordinary
 *     users to publish their own texts as "official" content.
 *
 * Service layer enforces the policy so the endpoint stays a thin
 * shell. Throws TextVisibilityError on a forbidden transition.
 */
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
    .set({ visibility: input.next, updatedAt: new Date() })
    .where(eq(schema.texts.id, input.textId))
    .returning();
  if (!updated) throw new TextVisibilityError('update returned no row', 404);
  return updated as Text;
}
