const connectionKey = 'parhiba.anki.connected';

export function hasConnectedToAnki(): boolean {
  try {
    return localStorage.getItem(connectionKey) === '1';
  } catch {
    return false;
  }
}

export function rememberAnkiConnection() {
  try {
    localStorage.setItem(connectionKey, '1');
  } catch {
    // Connecting still works when browser storage is unavailable.
  }
}

export async function ankiConnect<T>(
  action: string,
  params: unknown = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch('http://127.0.0.1:8765', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  if (!res.ok) throw new Error(`AnkiConnect returned HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

export const cardTypes = ['new', 'young', 'mature', 'suspended'] as const;
export const assignments = ['ignore', 'learning', 'known'] as const;
export type CardType = (typeof cardTypes)[number];
export type Assignment = (typeof assignments)[number];
export type CardMapping = Record<CardType, Assignment>;
export const defaultMapping: CardMapping = {
  new: 'ignore',
  young: 'learning',
  mature: 'known',
  suspended: 'ignore',
};

export function readMapping(saved: string | null): CardMapping {
  const mapping = { ...defaultMapping };
  if (saved) {
    try {
      const value = JSON.parse(saved);
      for (const type of cardTypes) {
        if (assignments.includes(value?.[type])) mapping[type] = value[type];
      }
    } catch {
      // A malformed preference falls back to the defaults.
    }
  }
  return mapping;
}

export type DesktopCard = {
  deckName: string;
  type: number;
  queue: number;
  interval: number;
  fields: Record<string, { value: string }>;
};

function classify(card: DesktopCard): CardType {
  if (card.queue === -1) return 'suspended';
  if (card.type === 0) return 'new';
  if (card.type === 2 && card.interval >= 21) return 'mature';
  return 'young';
}

export function collectEntries(cards: DesktopCard[], decks: string[], mapping: CardMapping) {
  const selectedDecks = new Set(decks);
  const entries = new Map<string, 'learning' | 'known'>();
  const ignored = new Set<string>();
  const headwords = new Map<string, string>();
  let missingId = 0;
  for (const card of cards) {
    if (!selectedDecks.has(card.deckName)) continue;
    const status = mapping[classify(card)];
    const id = card.fields.HindiDB_ID?.value.replace(/<[^>]*>/g, '').trim();
    if (!id) {
      if (status !== 'ignore') missingId++;
      continue;
    }
    const headword = card.fields.Lemma?.value.replace(/<[^>]*>/g, '').trim();
    if (headword) headwords.set(id, headword);
    if (status === 'ignore') {
      ignored.add(id);
      entries.delete(id);
    } else if (!ignored.has(id) && (status === 'known' || !entries.has(id))) {
      entries.set(id, status);
    }
  }
  return {
    missingId,
    headwords,
    ignoredIds: [...ignored],
    entries: [...entries].map(([id, status]) => ({ id, status })),
  };
}

export type DeckNode = {
  name: string;
  path: string;
  children: DeckNode[];
  decks: string[];
};

export function buildDeckTree(names: string[]): DeckNode[] {
  const roots: DeckNode[] = [];
  const nodes = new Map<string, DeckNode>();
  for (const deck of [...new Set(names)].sort((a, b) => a.localeCompare(b))) {
    let children = roots;
    let path = '';
    for (const name of deck.split('::')) {
      path = path ? path + '::' + name : name;
      let node = nodes.get(path);
      if (!node) {
        node = { name, path, children: [], decks: [] };
        nodes.set(path, node);
        children.push(node);
      }
      node.decks.push(deck);
      children = node.children;
    }
  }
  return roots;
}

export async function readDecks(decks: string[]) {
  const ids = new Set<number>();
  // Anki searches subdecks automatically. An ancestor query covers every selected child.
  const selected = new Set(decks);
  for (const deck of selected) {
    const parts = deck.split('::');
    if (parts.some((_, i) => i > 0 && selected.has(parts.slice(0, i).join('::')))) continue;
    const query = '"deck:' + deck.replace(/[\\"]/g, '\\$&') + '"';
    for (const id of await ankiConnect<number[]>('findCards', { query })) ids.add(id);
  }
  const all = [...ids];
  const cards: DesktopCard[] = [];
  for (let i = 0; i < all.length; i += 250) {
    const batch = await ankiConnect<DesktopCard[]>('cardsInfo', { cards: all.slice(i, i + 250) });
    for (const { deckName, type, queue, interval, fields } of batch) {
      if (!fields) continue;
      // cardsInfo also returns rendered HTML and media links for each note.
      cards.push({
        deckName,
        type,
        queue,
        interval,
        fields: {
          ...(fields.HindiDB_ID && { HindiDB_ID: fields.HindiDB_ID }),
          ...(fields.Lemma && { Lemma: fields.Lemma }),
        },
      });
    }
  }
  return cards;
}
