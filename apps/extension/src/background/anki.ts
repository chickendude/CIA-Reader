/**
 * AnkiConnect client + card builder.
 *
 * The extension owns a custom note type ("Primeran") with separate fields —
 * Word, Definition, Sentence, Audio, Picture (the last two are placeholders for
 * the Phase-2 media). The styling lives in the model CSS (a premium dark theme
 * in darkened Basque-flag colours), so the field content stays clean data.
 *
 * We send the request body without a JSON content-type (CORS-simple → no
 * preflight); AnkiConnect parses it as JSON regardless. The user must add this
 * extension's origin to AnkiConnect's `webCorsOriginList`.
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
  /** A `data:image/...;base64,` screenshot to attach (Picture field). */
  screenshot?: string | null;
};

const MODEL_NAME = 'Primeran';
const MODEL_FIELDS = ['Word', 'Definition', 'Sentence', 'Audio', 'Picture'];

const norm = (s: string): string => s.toLocaleLowerCase();
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeHtml(s).replace(/"/g, '&quot;');

// Darkened Ikurriña palette: deep maroon background, dark green + red accents.
const MODEL_CSS = `
.card{font-family:-apple-system,"Segoe UI",system-ui,sans-serif;
  background:radial-gradient(130% 150% at 50% -10%,#2a1518 0%,#150f11 62%);
  color:#ece6e7;padding:28px 22px}
.pm-word{font-size:36px;font-weight:800;text-align:center;color:#fff;letter-spacing:.01em}
.pm-sentence{margin:20px auto 0;max-width:620px;padding:15px 20px;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);
  border-left:4px solid #1f9c57;border-radius:9px;font-size:22px;line-height:1.75;color:#f1ebeb}
.pm-target{color:#ff6b4a;font-weight:700}
.pm-w[data-def]{border-bottom:1px dotted rgba(255,255,255,.35);cursor:help;position:relative}
.pm-w[data-def]:hover::after{content:attr(data-def);position:absolute;left:0;bottom:140%;
  background:#0c0809;color:#f3eded;border:1px solid rgba(255,255,255,.14);padding:7px 11px;
  border-radius:7px;font-size:14px;font-weight:400;line-height:1.4;white-space:normal;
  width:max-content;max-width:280px;box-shadow:0 10px 26px rgba(0,0,0,.6);z-index:5}
hr#answer{border:0;height:1px;max-width:620px;margin:22px auto;
  background:linear-gradient(90deg,transparent,#9b2b22,#1f9c57,transparent)}
.pm-defs{max-width:620px;margin:0 auto}
.pm-group{display:flex;gap:12px;margin:9px 0;align-items:baseline}
.pm-lang{flex:0 0 auto;font-size:11px;font-weight:700;letter-spacing:.04em;color:#d79a93;
  border:1px solid rgba(215,154,147,.4);border-radius:4px;padding:1px 6px}
.pm-bodies{flex:1}
.pm-def{margin:2px 0;font-size:18px;color:#e8e2e2}
.pm-picture img{max-width:100%;border-radius:9px;margin-top:16px}
`;

const FRONT_TEMPLATE = `<div class="pm-word">{{Word}}</div>
{{#Sentence}}<div class="pm-sentence">{{Sentence}}</div>{{/Sentence}}`;

const BACK_TEMPLATE = `{{FrontSide}}
<hr id="answer">
<div class="pm-defs">{{Definition}}</div>
{{#Picture}}<div class="pm-picture">{{Picture}}</div>{{/Picture}}
{{Audio}}`;

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

let modelEnsured = false;
async function ensureModel(): Promise<void> {
  if (modelEnsured) return;
  const names = (await ankiConnect('modelNames')) as string[];
  const templates = [{ Name: 'Card 1', Front: FRONT_TEMPLATE, Back: BACK_TEMPLATE }];
  if (names.includes(MODEL_NAME)) {
    // Keep an existing model's look/template fresh across extension versions.
    await ankiConnect('updateModelStyling', { model: { name: MODEL_NAME, css: MODEL_CSS } });
    await ankiConnect('updateModelTemplates', {
      model: { name: MODEL_NAME, templates: { 'Card 1': { Front: FRONT_TEMPLATE, Back: BACK_TEMPLATE } } },
    });
  } else {
    await ankiConnect('createModel', {
      modelName: MODEL_NAME,
      inOrderFields: MODEL_FIELDS,
      css: MODEL_CSS,
      cardTemplates: templates,
    });
  }
  modelEnsured = true;
}

/** Map of normalized word → concise gloss, from one parse of the sentence. */
async function glossSentence(language: string, sentence: string): Promise<Map<string, string>> {
  const glosses = new Map<string, string>();
  let tokens: ParseResponse['tokens'];
  try {
    tokens = (await api.postJson<ParseResponse>('/api/v1/parse', { language, text: sentence })).tokens;
  } catch {
    return glosses;
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

async function buildFields(card: AnkiCardInput): Promise<Record<string, string>> {
  // Definitions grouped by language (one label per language).
  const byLang = new Map<string, string[]>();
  for (const d of card.defs) {
    const lang = d.lang.toUpperCase();
    const list = byLang.get(lang);
    if (list) list.push(d.body);
    else byLang.set(lang, [d.body]);
  }
  const definition = [...byLang]
    .map(([lang, bodies]) => {
      const items = bodies.map((b) => `<div class="pm-def">${escapeHtml(b)}</div>`).join('');
      return `<div class="pm-group"><span class="pm-lang">${escapeHtml(lang)}</span><div class="pm-bodies">${items}</div></div>`;
    })
    .join('');

  // Sentence with the target word coloured + per-word hover glosses.
  let sentence = '';
  if (card.sentence) {
    const glosses = await glossSentence(card.language, card.sentence);
    const target = norm(card.surface);
    sentence = splitCueWords(card.sentence)
      .map((p) => {
        if (!p.word) return escapeHtml(p.text);
        const key = norm(p.text);
        const isTarget = key === target;
        const gloss = glosses.get(key);
        if (!isTarget && !gloss) return escapeHtml(p.text);
        const cls = `pm-w${isTarget ? ' pm-target' : ''}`;
        const attr = gloss ? ` data-def="${escapeAttr(gloss)}"` : '';
        return `<span class="${cls}"${attr}>${escapeHtml(p.text)}</span>`;
      })
      .join('');
  }

  let picture = '';
  if (card.screenshot) {
    const base64 = card.screenshot.replace(/^data:image\/\w+;base64,/, '');
    const filename = `primeran-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
    await ankiConnect('storeMediaFile', { filename, data: base64 });
    picture = `<img src="${filename}">`;
  }

  return { Word: card.front, Definition: definition, Sentence: sentence, Audio: '', Picture: picture };
}

/** Whether a card with this Word already exists in Anki (any deck). */
export async function ankiNoteExists(front: string): Promise<boolean> {
  try {
    const ids = await ankiConnect('findNotes', {
      query: `"Word:${front.replace(/["]/g, '')}"`,
    });
    return Array.isArray(ids) && ids.length > 0;
  } catch {
    return false; // Anki not running / not configured — just don't show the badge
  }
}

export async function addAnkiNote(card: AnkiCardInput): Promise<{ added: boolean; duplicate: boolean }> {
  const { deckName } = await loadConfig();
  await ankiConnect('createDeck', { deck: deckName });
  await ensureModel();
  const fields = await buildFields(card);
  try {
    await ankiConnect('addNote', {
      note: {
        deckName,
        modelName: MODEL_NAME,
        fields,
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
