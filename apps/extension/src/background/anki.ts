/**
 * AnkiConnect client — adds cards to the user's running Anki.
 *
 * Talks to the AnkiConnect add-on on http://127.0.0.1:8765. We deliberately send
 * the body without a JSON content-type (so it's a CORS-simple request, no
 * preflight); AnkiConnect parses the body as JSON regardless. The user must add
 * this extension's origin to AnkiConnect's `webCorsOriginList` so it returns the
 * CORS header.
 */
import { loadConfig } from '../shared/config';

export type AnkiCard = { front: string; back: string; tags?: string[] };

async function ankiConnect(action: string, params?: unknown): Promise<unknown> {
  const { ankiConnectUrl } = await loadConfig();
  let res: Response;
  try {
    res = await fetch(ankiConnectUrl, {
      method: 'POST',
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch {
    throw new Error(
      `Couldn't reach AnkiConnect at ${ankiConnectUrl}. Open Anki with the AnkiConnect add-on, and add this extension's origin to its webCorsOriginList (see settings).`,
    );
  }
  if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
  const data = (await res.json()) as { result: unknown; error: string | null };
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function addAnkiNote(card: AnkiCard): Promise<{ added: boolean; duplicate: boolean }> {
  const { deckName, modelName } = await loadConfig();
  await ankiConnect('createDeck', { deck: deckName });
  try {
    await ankiConnect('addNote', {
      note: {
        deckName,
        modelName,
        fields: { Front: card.front, Back: card.back },
        options: { allowDuplicate: false, duplicateScope: 'deck' },
        tags: card.tags ?? ['primeran', 'eu'],
      },
    });
    return { added: true, duplicate: false };
  } catch (e) {
    if (/duplicate/i.test(String(e))) return { added: false, duplicate: true };
    throw e;
  }
}
