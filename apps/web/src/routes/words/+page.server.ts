import { and, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { error, redirect } from '@sveltejs/kit';

import { vocabularyDefinition } from '$lib/server/vocabulary.js';
import { db } from '$lib/server/db/index.js';
import { lemmas, userKnownLemmas } from '$lib/server/db/schema.js';
import type { Actions, PageServerLoad } from './$types';
import { encodeStatuses, WORD_STATUSES, type WordStatus } from './word-statuses';

const ROW_LIMIT = 200;
const DEFAULT_STATUSES: WordStatus[] = ['learning', 'known'];

function parseStatuses(raw: string): WordStatus[] | undefined {
  if (raw === 'all' || raw === 'unknown') return [...WORD_STATUSES];
  if (raw === 'none') return [];
  const values = raw.split(',');
  if (!values.every((value) => WORD_STATUSES.some((status) => status === value))) return undefined;
  return WORD_STATUSES.filter((status) => values.includes(status));
}

function preferenceCookie(userId: string): string {
  return `words_statuses_${userId}`;
}

export const load: PageServerLoad = async ({ url, locals, parent, cookies }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const { currentLanguage: language } = await parent();
  if (!language) throw redirect(303, '/');

  const requested = url.searchParams.get('status');
  const statuses = requested
    ? parseStatuses(requested)
    : parseStatuses(cookies.get(preferenceCookie(locals.user.id)) ?? '') ?? DEFAULT_STATUSES;
  if (!statuses) throw error(400, `Unknown status '${requested}'`);

  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedOffset = Number(url.searchParams.get('offset'));
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  const definition = vocabularyDefinition(locals.user.id);
  const pattern = `%${q}%`;
  const scope = and(
    eq(userKnownLemmas.userId, locals.user.id),
    eq(lemmas.language, language),
    q ? or(ilike(lemmas.headword, pattern), sql`${definition} ilike ${pattern}`) : undefined,
  );
  const joinLemma = eq(lemmas.id, userKnownLemmas.lemmaId);
  const [rows, totals] = await Promise.all([
    db.select({
      lemmaId: userKnownLemmas.lemmaId,
      headword: lemmas.headword,
      pos: lemmas.pos,
      definition,
      status: userKnownLemmas.status,
      updatedAt: userKnownLemmas.updatedAt,
    })
      .from(userKnownLemmas)
      .innerJoin(lemmas, joinLemma)
      .where(and(scope, inArray(userKnownLemmas.status, statuses)))
      .orderBy(desc(userKnownLemmas.updatedAt), userKnownLemmas.lemmaId)
      .limit(ROW_LIMIT)
      .offset(offset),
    db.select({ status: userKnownLemmas.status, total: count() })
      .from(userKnownLemmas)
      .innerJoin(lemmas, joinLemma)
      .where(and(scope, ne(userKnownLemmas.status, 'unknown')))
      .groupBy(userKnownLemmas.status),
  ]);

  const counts = { learning: 0, known: 0, ignored: 0 };
  for (const { status, total } of totals) {
    if (status !== 'unknown') counts[status] = total;
  }
  return {
    rows,
    pagination: { offset, limit: ROW_LIMIT, total: statuses.reduce((sum, status) => sum + counts[status], 0) },
    counts,
    filters: { language, statuses, q },
  };
};

export const actions = {
  filter: async ({ locals, request, cookies, url }) => {
    if (!locals.user) throw redirect(303, '/login?next=/words');
    const form = await request.formData();
    const raw = form.get('status');
    const selected = typeof raw === 'string' && parseStatuses(raw);
    if (!selected) throw error(400, 'Invalid status selection');

    const status = encodeStatuses(selected);
    cookies.set(preferenceCookie(locals.user.id), status, {
      path: '/words',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
    });
    const params = new URLSearchParams({ status });
    const q = form.get('q');
    if (typeof q === 'string' && q.trim()) params.set('q', q.trim());
    throw redirect(303, `/words?${params}`);
  },
} satisfies Actions;
