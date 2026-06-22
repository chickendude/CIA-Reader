import { Agent, type Dispatcher } from 'undici';

import { NLP_SERVICE_URL } from './env.js';

/**
 * Undici's default `headersTimeout` and `bodyTimeout` are 5 minutes
 * each — fine for a typical web fetch, way too short for Stanza's
 * Hindi pipeline running on CPU. Long chapters can take 10+ minutes
 * for the parser to emit response headers, surfacing as
 * `UND_ERR_HEADERS_TIMEOUT` in `processTextNow` and a "fetch failed"
 * `status_error` row in the texts table.
 *
 * 30 minutes is enough headroom for the largest book chapters we've
 * seen in practice; chunking the request on the dispatcher side is
 * the proper long-term fix, but bumping the patience here unblocks
 * the in-process worker without an app-level rewrite. `keepAlive`
 * stays on so the dispatcher reuses sockets across the per-chapter
 * `/process` calls a single `processTextNow` makes.
 */
const NLP_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const nlpDispatcher: Dispatcher = new Agent({
  headersTimeout: NLP_REQUEST_TIMEOUT_MS,
  bodyTimeout: NLP_REQUEST_TIMEOUT_MS,
  keepAliveTimeout: 30_000,
});

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
  // Basque (Euskara). Latin script, so `romanized` is the empty string —
  // the spelled-out form is already the reading. Base-20 (vigesimal).
  eu: NumberLanguageForm;
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

/** A word's bounding box on a PDF page image, normalized to 0..1 of the
 *  page width/height (mirrors the Python `BBox`). Drives the clickable
 *  word hotspots in the image reader. */
export interface OcrBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A `NlpToken` plus its page-image bounding box. `bbox` is null for
 *  whitespace/punctuation and for words the aligner couldn't place. */
export interface OcrToken extends NlpToken {
  bbox: OcrBBox | null;
}

export interface OcrResponse {
  language: string;
  pipeline_id: string;
  /** Page image pixel dimensions (echoed from the upload). */
  width: number;
  height: number;
  /** Reconstructed page text — stored as the chapter body. */
  body: string;
  tokens: OcrToken[];
  proposed_phrases?: ProposedPhrase[];
}

/** One run from a PDF's embedded text layer, extracted client-side via
 *  pdf.js. Coords are normalized 0..1, top-left origin. `eol` marks the
 *  end of a visual line. */
export interface BornDigitalItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  eol?: boolean;
}

export interface BornDigitalPayload {
  items: BornDigitalItem[];
}

/** A previously-captured OCR layout: the page text plus one box per
 *  character (parallel to `text`; null for whitespace). Replaying it lets
 *  the server re-tokenize a page with the current model WITHOUT calling
 *  Vision again (free reprocess). */
export interface OcrLayout {
  text: string;
  charBoxes: Array<[number, number, number, number] | null>;
}

export interface OcrOptions {
  /** Rendered page-image pixel dimensions (the client knows these). */
  width: number;
  height: number;
  /** Image mime; the served file's Content-Type is derived from it. */
  mime?: string;
  /** 'vision' (default) or 'vision_llm' (on-demand AI proofread). */
  engine?: 'vision' | 'vision_llm';
  /** When the page came from a PDF text layer, the extracted runs —
   *  Python uses them instead of calling Vision. */
  bornDigital?: BornDigitalPayload | null;
  /** Stored OCR layout to replay for a free re-tokenize (no Vision). */
  layout?: OcrLayout | null;
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
  // The `dispatcher` field is undici-specific; node's `fetch()`
  // forwards it to undici under the hood. Tests stub `fetch` with
  // vi.stubGlobal, in which case the stub ignores the extra option
  // and the timeout config is a no-op — exactly what we want.
  const res = await fetch(new URL(path, NLP_SERVICE_URL), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    // @ts-expect-error — RequestInit doesn't type `dispatcher`, but
    // Node's fetch reads it. Without this override every long
    // chapter would die on undici's 5-minute headersTimeout.
    dispatcher: nlpDispatcher,
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
  /**
   * OCR one PDF page image into tokens + per-token bounding boxes. Posts
   * a multipart body (image blob + fields) — we can't reuse `request`,
   * which forces a JSON content-type; here fetch must set the multipart
   * boundary itself.
   */
  async ocr(
    language: string,
    imageBytes: Uint8Array,
    opts: OcrOptions,
  ): Promise<OcrResponse> {
    const form = new FormData();
    form.set('language', language);
    form.set('width', String(opts.width));
    form.set('height', String(opts.height));
    form.set('engine', opts.engine ?? 'vision');
    if (opts.bornDigital) {
      form.set('born_digital', JSON.stringify(opts.bornDigital));
    }
    if (opts.layout) {
      form.set(
        'layout',
        JSON.stringify({ text: opts.layout.text, char_boxes: opts.layout.charBoxes }),
      );
    }
    form.set(
      'image',
      // Cast: TS's DOM lib types BlobPart as ArrayBuffer-backed, but a
      // Uint8Array<ArrayBufferLike> is a valid blob part at runtime.
      new Blob([imageBytes as BlobPart], { type: opts.mime ?? 'image/webp' }),
      'page',
    );
    const res = await fetch(new URL('/ocr', NLP_SERVICE_URL), {
      method: 'POST',
      body: form,
      // @ts-expect-error — Node's fetch reads undici's `dispatcher`;
      // RequestInit doesn't type it. Keeps the long timeout for Vision.
      dispatcher: nlpDispatcher,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`NLP service ${res.status}: ${body || res.statusText}`);
    }
    return (await res.json()) as OcrResponse;
  },
};
