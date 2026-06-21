/**
 * GET /api/v1/me/anki/export?textId=&language=&deck=&status=
 *
 * Download the caller's learning words as an Anki `.apkg` deck. Scoped to a
 * book when `textId` is given (cards carry frequency + sample sentences),
 * otherwise language-wide.
 */
import { error } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { buildApkg, getAnkiCards } from '$lib/server/anki.js';
import { isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import type { VocabularyStatus } from '$lib/server/vocabulary.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['unknown', 'learning', 'known', 'ignored']);

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}\-_. ]/gu, '').trim() || 'anki-deck';
  return cleaned.replace(/\s+/g, '-');
}

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const { searchParams } = event.url;

  const textId = searchParams.get('textId') ?? undefined;
  if (textId && !UUID_RE.test(textId)) throw error(400, 'Invalid text id');

  const languageParam = searchParams.get('language') ?? undefined;
  if (languageParam && !isSupportedLanguage(languageParam)) {
    throw error(400, 'Unsupported language');
  }
  if (!textId && !languageParam) throw error(400, 'Provide textId or language');

  const statusParam = searchParams.get('status') ?? 'learning';
  if (!STATUSES.has(statusParam)) throw error(400, 'Invalid status');

  const deckName = searchParams.get('deck')?.trim() || 'CIA Reader';

  const { cards } = await getAnkiCards(user.id, {
    textId,
    language: languageParam as LanguageCode | undefined,
    status: statusParam as VocabularyStatus,
  });
  if (cards.length === 0) throw error(404, 'No cards to export');

  const apkg = await buildApkg(deckName, cards);
  return new Response(apkg as unknown as BodyInit, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${safeFilename(deckName)}.apkg"`,
      'cache-control': 'private, no-store',
    },
  });
};
