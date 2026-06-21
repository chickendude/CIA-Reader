/**
 * Minimal OpenAI chat-completions client for sentence-level translation.
 *
 * Kept tiny on purpose (one `fetch`, no SDK). `translateSentence` turns a
 * source-language sentence into the target language and returns just the
 * translation text. The API key + model come from `env.ts`; an empty key
 * means the feature is disabled (the caller surfaces a 503).
 */
import { LANGUAGES, isSupportedLanguage } from '@ciareader/shared-types';

import { OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL } from './env.js';

const EXTRA_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
};

function languageName(code: string): string {
  if (isSupportedLanguage(code)) return LANGUAGES[code].displayName;
  return EXTRA_LANGUAGE_NAMES[code] ?? code;
}

export class OpenAiNotConfiguredError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set');
    this.name = 'OpenAiNotConfiguredError';
  }
}

export type ChatFetch = typeof fetch;

export async function translateSentence(
  text: string,
  sourceLanguage: string,
  targetLanguage = 'en',
  opts: { fetchImpl?: ChatFetch; apiKey?: string; model?: string; baseUrl?: string } = {},
): Promise<string> {
  const apiKey = opts.apiKey ?? OPENAI_API_KEY;
  if (!apiKey) throw new OpenAiNotConfiguredError();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = opts.model ?? OPENAI_MODEL;
  const baseUrl = (opts.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, '');

  const system =
    `Translate the user's ${languageName(sourceLanguage)} sentence into ` +
    `${languageName(targetLanguage)}. Reply with only the translation — no quotes, ` +
    `no transliteration, no notes.`;

  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) detail = `: ${err.error.message}`;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 429) {
      throw new Error(`OpenAI quota/rate limit (429)${detail}`);
    }
    throw new Error(`OpenAI request failed (${res.status})${detail}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('OpenAI returned an empty translation');
  return out;
}
