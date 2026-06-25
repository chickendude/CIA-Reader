/**
 * AnkiConnect client + card builder.
 *
 * Talks to the AnkiConnect add-on on http://127.0.0.1:8765. We send the body
 * without a JSON content-type (CORS-simple → no preflight); AnkiConnect parses
 * it as JSON regardless. The user must add this extension's origin to
 * AnkiConnect's `webCorsOriginList`.
 *
 * The card back is built here so it can annotate the sentence: each word gets a
 * CSS-only hover tooltip with its gloss from the offline dictionary (works in
 * Anki without JS/network), and the target word is coloured.
 */
import type { ParseResponse } from '../shared/api-types';
import { loadConfig } from '../shared/config';
import { splitCueWords } from '../shared/tokenize';
import { api } from './api-client';
import { localDictionary } from './dictionary-local';

export type AnkiCardInput = {
  language: string;
  front: string;
  surface: string;
  sentence: string | null;
  defs: { body: string; lang: string }[];
};

const norm = (s: string): string => s.toLocaleLowerCase();

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

const CARD_STYLE = `<style>
.pm-card{text-align:left;max-width:560px;margin:0 auto;font-size:18px;line-height:1.5}
.pm-defs .pm-def{margin:3px 0}
.pm-def .pm-lang{font-size:10px;letter-spacing:.03em;border:1px solid currentColor;border-radius:3px;padding:0 4px;margin-right:7px;opacity:.55;vertical-align:middle}
.pm-sentence{margin-top:16px;padding:12px 16px;border-left:4px solid #4a90e2;border-radius:4px;font-size:22px;line-height:1.75}
.pm-w[data-def]{border-bottom:1px dotted #9aa;cursor:help;position:relative}
.pm-w[data-def]:hover::after{content:attr(data-def);position:absolute;left:0;bottom:135%;background:#1d1f23;color:#eee;padding:6px 10px;border-radius:6px;font-size:14px;line-height:1.35;font-weight:400;white-space:normal;width:max-content;max-width:280px;box-shadow:0 6px 20px rgba(0,0,0,.45);z-index:5}
.pm-target{color:#e0533d;font-weight:700}
</style>`;

/** Map of normalized word → concise gloss, from one parse of the sentence. */
async function glossSentence(language: string, sentence: string): Promise<Map<string, string>> {
  const glosses = new Map<string, string>();
  let tokens: ParseResponse['tokens'];
  try {
    tokens = (await api.postJson<ParseResponse>('/api/v1/parse', { language, text: sentence })).tokens;
  } catch {
    return glosses; // no annotation if parsing is unavailable
  }
  for (const t of tokens) {
    if (!t.is_word) continue;
    const key = norm(t.surface);
    if (glosses.has(key)) continue;
    const lemma = t.candidates[0]?.lemma ?? t.surface;
    const entries = await localDictionary.lookup(language, lemma);
    const gloss =
      entries.flatMap((e) => e.translations.map((tr) => tr.body))[0] ??
      entries.map((e) => e.gloss).find(Boolean) ??
      undefined;
    if (gloss) glosses.set(key, gloss);
  }
  return glosses;
}

async function buildBack(card: AnkiCardInput): Promise<string> {
  const defsHtml = card.defs
    .map(
      (d) =>
        `<div class="pm-def"><span class="pm-lang">${escapeHtml(d.lang.toUpperCase())}</span>${escapeHtml(d.body)}</div>`,
    )
    .join('');

  let sentenceHtml = '';
  if (card.sentence) {
    const glosses = await glossSentence(card.language, card.sentence);
    const target = norm(card.surface);
    const parts = splitCueWords(card.sentence).map((p) => {
      if (!p.word) return escapeHtml(p.text);
      const key = norm(p.text);
      const isTarget = key === target;
      const gloss = glosses.get(key);
      const cls = `pm-w${isTarget ? ' pm-target' : ''}`;
      const attr = gloss ? ` data-def="${escapeAttr(gloss)}"` : '';
      return isTarget || gloss ? `<span class="${cls}"${attr}>${escapeHtml(p.text)}</span>` : escapeHtml(p.text);
    });
    sentenceHtml = `<div class="pm-sentence">${parts.join('')}</div>`;
  }

  return `${CARD_STYLE}<div class="pm-card"><div class="pm-defs">${defsHtml}</div>${sentenceHtml}</div>`;
}

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

export async function addAnkiNote(card: AnkiCardInput): Promise<{ added: boolean; duplicate: boolean }> {
  const { deckName, modelName } = await loadConfig();
  const back = await buildBack(card);
  await ankiConnect('createDeck', { deck: deckName });
  try {
    await ankiConnect('addNote', {
      note: {
        deckName,
        modelName,
        fields: { Front: card.front, Back: back },
        options: { allowDuplicate: false, duplicateScope: 'deck' },
        tags: ['primeran', card.language],
      },
    });
    return { added: true, duplicate: false };
  } catch (e) {
    if (/duplicate/i.test(String(e))) return { added: false, duplicate: true };
    throw e;
  }
}
