/**
 * Ad-hoc tokenization for thin API clients (the Primeran subtitle-mining
 * browser extension).
 *
 * The NLP service's `/process` endpoint is internal (docker network only), so a
 * browser extension can't call it directly. This wraps `nlpClient.process` so
 * the `POST /api/v1/parse` route can expose lemmatization of a single subtitle
 * line over the authenticated public API. The route stays a thin Zod + auth
 * shell; the (trivial) shaping lives here so it's unit-testable without HTTP.
 */
import { nlpClient, type NlpToken } from './nlp-client.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type ParseResult = {
  language: string;
  tokens: NlpToken[];
};

/**
 * Tokenize + lemmatize a short piece of text (one subtitle line / a few cues).
 * Returns the token stream only — callers read `tokens[].candidates[].lemma` to
 * get the dictionary form, then look the lemma up locally.
 */
export async function tokenizeText(
  language: LanguageCode,
  text: string,
): Promise<ParseResult> {
  const out = await nlpClient.process(language, text);
  return { language: out.language, tokens: out.tokens };
}
