import { NLP_SERVICE_URL } from './env.js';

export interface LemmaCandidate {
  lemma: string;
  pos: string;
  score: number;
  features: Record<string, string>;
}

export interface NumberLanguageForm {
  spelled: string;
  romanized: string;
}

/** Per-token number-form payload populated by the NLP service for
 *  digit-only NUM tokens (T-2.8 / T-2.8a). Null on every other token.
 *
 *  `value` is the canonical Latin-digit string form so signed +
 *  decimal numerals (T-2.8a) round-trip losslessly: `"-3.14"`,
 *  `"0.001"`, `"123"` are all valid. The integer part is bounded by
 *  10⁷; the fractional part may be arbitrarily long. */
export interface NumberForms {
  value: string;
  digits_latin: string;
  digits_deva: string;
  digits_orya: string;
  hi: NumberLanguageForm;
  mr: NumberLanguageForm;
  // Wire field is `odia`, not the ISO 639-1 `or`, because `or` is a
  // reserved Python keyword and can't be an attribute name on the
  // server-side Pydantic model. The TypeScript mirror matches.
  odia: NumberLanguageForm;
}

export interface NlpToken {
  idx: number;
  surface: string;
  is_word: boolean;
  candidates: LemmaCandidate[];
  is_ambiguous: boolean;
  is_oov: boolean;
  romanization: string | null;
  number_forms: NumberForms | null;
}

/** T-14.5: rule-based phrase proposal. The NLP service runs a
 *  per-language `PhraseDetector` (see `services/nlp/app/phrases/`)
 *  over the token stream and emits one of these per pattern match.
 *  The web worker (T-14.5a) writes proposals to `phrase_proposals`
 *  and a periodic promotion pass moves ≥3-chapter occurrences into
 *  `phrases` (`source='nlp'`). Surfaces are NFC-normalised on the
 *  Python side. */
export interface ProposedPhrase {
  start_idx: number;
  end_idx: number;
  pattern_id: string;
  surfaces: string[];
}

export interface ProcessResponse {
  language: string;
  pipeline_id: string;
  tokens: NlpToken[];
  /** T-14.5. Empty array when no patterns matched; older NLP
   *  service builds may omit the field, so consumers must default
   *  to an empty list. */
  proposed_phrases?: ProposedPhrase[];
}

export interface HealthResponse {
  status: string;
  languages: string[];
}

export interface RomanizeResponse {
  /** One entry per input surface, same order. `null` when the input
   *  was empty / on an unsupported script — caller leaves the row's
   *  romanization NULL in those cases. */
  romanizations: Array<string | null>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(new URL(path, NLP_SERVICE_URL), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NLP service ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export const nlpClient = {
  health(): Promise<HealthResponse> {
    return request<HealthResponse>('/health');
  },
  process(language: string, text: string): Promise<ProcessResponse> {
    return request<ProcessResponse>('/process', {
      method: 'POST',
      body: JSON.stringify({ language, text }),
    });
  },
  romanize(language: string, surfaces: string[]): Promise<RomanizeResponse> {
    return request<RomanizeResponse>('/romanize', {
      method: 'POST',
      body: JSON.stringify({ language, surfaces }),
    });
  },
};
