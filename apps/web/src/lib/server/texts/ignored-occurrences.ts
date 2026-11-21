import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { canReadChapter } from '../auth/can-read';
import { db, schema } from '../db';

export async function setOccurrenceIgnored(userId: string, tokenId: string, ignored: boolean) {
  await db.transaction(async (tx) => {
    const [word] = await tx.select({ chapter: schema.textTokens.chapterId })
      .from(schema.textTokens)
      .where(and(eq(schema.textTokens.id, tokenId), eq(schema.textTokens.isWord, true)))
      .for('update');
    if (!word || !(await canReadChapter({ id: userId }, word.chapter))) error(404, 'Word not found');
    const table = schema.readerIgnoredTokens;
    if (ignored) {
      await tx.insert(table).values({ userId, tokenId }).onConflictDoNothing();
    } else {
      await tx.delete(table).where(and(eq(table.userId, userId), eq(table.tokenId, tokenId)));
    }
  });
}
