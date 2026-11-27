// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import type { DB } from '../db/index.js';
import * as schema from '../db/schema.js';

const state = vi.hoisted(() => ({ db: undefined as unknown as DB }));
vi.mock('../db/index.js', async () => ({
  get db() { return state.db; },
  schema: await import('../db/schema.js'),
}));

const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

it.skipIf(!local)('reviews shared IPs and removes private account data while preserving published chapters', async () => {
  const client = postgres(url!, { max: 1 });
  const rollback = new Error('Roll back directory fixtures');
  try {
    await expect(drizzle(client, { schema }).transaction(async tx => {
      state.db = tx as unknown as DB;
      const { deleteReviewedUsers, directoryFilters, reviewDeletion, listIpGroups, selectedSignupRetries } = await import('./user-directory.js');
      const admin = randomUUID(), reader = randomUUID(), other = randomUUID();
      await tx.insert(schema.users).values([admin, reader, other].map(id => ({
        id, email: id + '@example.invalid', role: id === admin ? 'admin' as const : 'user' as const,
      })));
      const network = randomUUID().replaceAll('-', '').repeat(2);
      await tx.insert(schema.userNetworks).values([admin, reader, other].map(userId => ({ userId, network })));
      const retryOnly = randomUUID().replaceAll('-', '').repeat(2);
      const today = sql`(now() at time zone 'UTC')::date`;
      await tx.insert(schema.signupRetries).values([
        { network, attempts: 3 }, { network, day: sql`${today} - 6`, attempts: 4 },
        { network, day: sql`${today} - 7`, attempts: 20 }, { network: retryOnly, attempts: 10 },
      ]);
      const filters = directoryFilters(new URL('http://localhost/?view=ips&groupOrder=most-retries'));
      const { groups } = await listIpGroups(filters);
      expect(groups.filter(g => [network, retryOnly].includes(g.network))).toMatchObject([
        { network: retryOnly, members: 0, retries: 10 }, { network, members: 3, retries: 7 },
      ]);
      expect((await listIpGroups({ ...filters, verification: 'unverified' })).groups.some(g => g.network === retryOnly)).toBe(false);
      expect(await selectedSignupRetries(network)).toMatchObject({ retries: 7, lastRetry: expect.any(Date) });
      const preview = await reviewDeletion(directoryFilters(new URL('http://localhost/moderation/users')), [reader], [network]);
      expect(preview.map(u => u.id).sort()).toEqual([reader, other].sort());

      const book = randomUUID(), chapter = randomUUID(), privateText = randomUUID(), noteId = randomUUID();
      await tx.insert(schema.collections).values({ id: book, ownerId: reader, title: 'Published', language: 'hi', visibility: 'official' });
      await tx.insert(schema.texts).values([chapter, privateText].map(id => ({
        id, title: 'Chapter', ownerId: reader, language: 'hi' as const, sourceType: 'paste' as const,
      })));
      await tx.insert(schema.collectionItems).values({ collectionId: book, textId: chapter, position: 0 });
      await tx.insert(schema.translations).values({
        id: noteId, targetId: randomUUID(), source: 'user', submittedBy: reader, body: 'Private note', isPrivate: true,
      });
      await expect(deleteReviewedUsers(admin, [reader, admin])).rejects.toMatchObject({ status: 409 });
      expect(await deleteReviewedUsers(admin, [reader])).toBe(1);
      expect(await tx.$count(schema.users, inArray(schema.users.id, [admin, other]))).toBe(2);
      expect(await tx.$count(schema.translations, eq(schema.translations.id, noteId))).toBe(0);
      expect(await tx.$count(schema.userNetworks, eq(schema.userNetworks.userId, reader))).toBe(0);
      expect(await tx.select({ id: schema.texts.id, owner: schema.texts.ownerId }).from(schema.texts)
        .where(inArray(schema.texts.id, [chapter, privateText]))).toEqual([{ id: chapter, owner: null }]);
      expect(await tx.$count(schema.collectionItems, eq(schema.collectionItems.collectionId, book))).toBe(1);
      throw rollback;
    })).rejects.toBe(rollback);
  } finally {
    await client.end();
  }
});
