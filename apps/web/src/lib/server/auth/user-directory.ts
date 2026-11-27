import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { accountColumns, groupColumns, resolveSort } from '$lib/moderation/directory-sort';
import { error } from '@sveltejs/kit';
import { db, schema } from '../db/index.js';
import { EMAIL_DAILY_LIMIT, EMAIL_UNVERIFIED_DAILY_LIMIT } from '../env.js';
import { networkCutoff } from './user-networks.js';

const PAGE_SIZE = 50;
const { users, userNetworks } = schema;
const active = gte(userNetworks.lastSeenAt, networkCutoff);
export function directoryFilters(url: URL) {
  const status = url.searchParams.get('verification');
  const sort = resolveSort(accountColumns, url.searchParams.get('sort'), 'ips');
  const groupOrder = resolveSort(groupColumns, url.searchParams.get('groupOrder'), 'members');
  const network = url.searchParams.get('network');
  if (network && !/^[0-9a-f]{64}$/.test(network)) error(400, 'Invalid IP group');
  const requestedPage = Number(url.searchParams.get('page'));
  return {
    recent: url.searchParams.get('joined') === '24h',
    verification: status === 'verified' || status === 'unverified' ? status : 'all',
    sort, groupOrder,
    grouped: url.searchParams.get('view') === 'ips',
    network: network || null,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  };
}

type Filters = ReturnType<typeof directoryFilters>;

function accountFilter(filters: Filters) {
  return and(
    filters.recent ? gte(users.createdAt, sql`now() - interval '24 hours'`) : undefined,
    filters.verification === 'verified' ? isNotNull(users.emailVerifiedAt) : undefined,
    filters.verification === 'unverified' ? isNull(users.emailVerifiedAt) : undefined,
  );
}

function pagination(page: number, total: number) {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { total, limit: PAGE_SIZE, offset: (Math.min(page, lastPage) - 1) * PAGE_SIZE };
}

const ipCount = db.$count(userNetworks, and(eq(userNetworks.userId, users.id), active));
const linksCreated = db.$count(schema.magicLinks, eq(schema.magicLinks.userId, users.id));
const textsWithProgress = db.$count(schema.userTextProgress, eq(schema.userTextProgress.userId, users.id));
const accountOrderFields = {
  email: users.email,
  name: sql`lower(coalesce(${users.displayName}, ''))`,
  role: sql`${users.role}::text`,
  joined: users.createdAt,
  verified: isNotNull(users.emailVerifiedAt),
  onboarded: isNotNull(users.onboardedAt),
  links: linksCreated,
  texts: textsWithProgress,
  ips: ipCount,
};

export async function listUsers(filters: Filters) {
  const where = and(accountFilter(filters), filters.network ? inArray(users.id,
    db.select({ id: userNetworks.userId }).from(userNetworks)
      .where(and(active, eq(userNetworks.network, filters.network)))) : undefined);
  const paging = pagination(filters.page, await db.$count(users, where));
  const order = filters.sort.direction === 'ascending' ? asc : desc;
  const accounts = await db.select({
    id: users.id, email: users.email, displayName: users.displayName, role: users.role,
    createdAt: users.createdAt, emailVerifiedAt: users.emailVerifiedAt, onboardedAt: users.onboardedAt,
    ipCount,
    linksCreated, textsWithProgress,
  }).from(users).where(where)
    .orderBy(order(accountOrderFields[filters.sort.key]), desc(users.createdAt), asc(users.id))
    .limit(paging.limit).offset(paging.offset);
  const memberships = accounts.length ? await db.select({
    userId: userNetworks.userId, network: userNetworks.network,
  }).from(userNetworks).where(and(active, inArray(userNetworks.userId, accounts.map(a => a.id))))
    .orderBy(desc(userNetworks.lastSeenAt), asc(userNetworks.network)) : [];
  const networks = new Map<string, string[]>();
  for (const row of memberships) {
    const list = networks.get(row.userId) ?? [];
    list.push(row.network);
    networks.set(row.userId, list);
  }
  return { ...paging, accounts: accounts.map(a => ({ ...a, networks: networks.get(a.id) ?? [] })) };
}

export async function listIpGroups(filters: Filters) {
  const where = and(active, accountFilter(filters));
  const groups = db.select({
    network: userNetworks.network, members: count().as('members'),
    signups: sql<number>`count(*) filter (where ${userNetworks.signupAt} >= ${networkCutoff})`.mapWith(Number).as('signups'),
    latest: sql<Date>`max(${userNetworks.lastSeenAt})`.mapWith(userNetworks.lastSeenAt).as('latest'),
  }).from(userNetworks).innerJoin(users, eq(users.id, userNetworks.userId))
    .where(where).groupBy(userNetworks.network).as('ip_groups');
  const paging = pagination(filters.page, await db.$count(groups));
  const order = filters.groupOrder.direction === 'ascending' ? asc : desc;
  const rows = await db.select().from(groups).orderBy(order(groups[filters.groupOrder.key]), asc(groups.network))
    .offset(paging.offset).limit(paging.limit);
  return { ...paging, groups: rows };
}

export async function reviewDeletion(filters: Filters, ids: string[], networks: string[]) {
  const members = db.select({ id: userNetworks.userId }).from(userNetworks)
    .where(and(active, inArray(userNetworks.network, networks)));
  return db.select({ id: users.id, email: users.email, role: users.role, emailVerifiedAt: users.emailVerifiedAt }).from(users)
    .where(and(ne(users.role, 'admin'), accountFilter(filters),
      or(inArray(users.id, ids), inArray(users.id, members))))
    .orderBy(asc(users.email));
}

export async function deleteReviewedUsers(adminId: string, ids: string[]) {
  return db.transaction(async tx => {
    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, adminId)).for('share');
    if (actor?.role !== 'admin') error(403, 'Admin role required');
    const targets = await tx.select({ id: users.id, role: users.role }).from(users)
      .where(inArray(users.id, ids)).orderBy(asc(users.id)).for('update');
    if (targets.some(u => u.role === 'admin')) error(409, 'Admin accounts cannot be deleted here.');
    const selected = targets.map(u => u.id);
    if (!selected.length) return 0;
    // A published chapter book can contain chapters that have no separate catalog listing.
    const { collections, collectionItems, texts, translations } = schema;
    const officialChapters = tx.select({ id: collectionItems.textId }).from(collectionItems)
      .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
      .where(and(eq(collections.visibility, 'official'), eq(collections.kind, 'chapter_book')));
    await tx.update(texts).set({ ownerId: null }).where(and(inArray(texts.ownerId, selected),
      or(eq(texts.visibility, 'official'), inArray(texts.id, officialChapters))));
    await tx.update(collections).set({ ownerId: null })
      .where(and(inArray(collections.ownerId, selected), eq(collections.visibility, 'official')));
    // Public contributions can keep their attribution-free rows. Private notes belong to their author.
    await tx.delete(translations).where(and(inArray(translations.submittedBy, selected), eq(translations.isPrivate, true)));
    const deleted = await tx.delete(users).where(inArray(users.id, selected)).returning({ id: users.id });
    return deleted.length;
  });
}

export async function recentSiteActivity() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { users, accountEmailAttempts } = schema;
  const joined = gte(users.createdAt, since);
  const [signups, unverifiedSignups, [usage]] = await Promise.all([
    db.$count(users, joined),
    db.$count(users, and(joined, isNull(users.emailVerifiedAt))),
    db.select({
      total: count(),
      unverified: sql<number>`count(*) filter (where not ${accountEmailAttempts.verifiedSignin})`.mapWith(Number),
    }).from(accountEmailAttempts).where(gte(accountEmailAttempts.createdAt, since)),
  ]);
  return {
    signups, unverifiedSignups,
    emailAttempts: usage?.total ?? 0, emailLimit: EMAIL_DAILY_LIMIT,
    unverifiedAttempts: usage?.unverified ?? 0, unverifiedLimit: EMAIL_UNVERIFIED_DAILY_LIMIT,
  };
}
