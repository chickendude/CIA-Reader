/**
 * Praharaj (DSAL) Odia importer — *Purnnachandra Ordia Bhashakosha*
 * (Utkal Sahitya Press, 1931–40), the ~9,500-page, 7-volume lexicon of
 * Odia (~120k+ entries), digitized by the Digital Dictionaries of
 * South Asia.
 *
 * Copyright status is nuanced and recorded in
 * docs/dictionary-sources.md ("Praharaj copyright status"): public
 * domain in India (~2007) and the EU; US URAA restoration keeps each
 * volume US-copyrighted 95 years from publication (vol. 1 clears
 * Jan 2027, the last ~2036). Imported now by explicit project decision
 * with that status documented.
 *
 * Two Praharaj-specific behaviors:
 *
 * 1. POS. The `<gramGrp>` marker embeds the POS abbreviation after an
 *    etymology prefix — `ସଂ. ବି. (ଅଭି+ଧା …)` is "Sanskrit-origin,
 *    noun (ବିଶେଷ୍ୟ), derivation" — so we token-search rather than
 *    table-lookup: ବିଣ (ବିଶେଷଣ) adjective, ବି (ବିଶେଷ୍ୟ) noun, କ୍ରି
 *    (କ୍ରିୟା) verb, କ୍ରି+ବିଣ adverb, ସର୍ବ (ସର୍ବନାମ) pronoun.
 *
 * 2. Definition language. Praharaj glosses in BOTH Odia and English —
 *    parsed senses keep the printed `ଓଡ଼ିଆ— 1. English.` shape. Each
 *    sense is tagged by Latin-letter share of its alphabetic
 *    codepoints: ≥ 0.5 → 'en' (the sense carries an English gloss,
 *    possibly alongside Odia), else 'or' (pure/mostly Odia — including
 *    the appended verse quotations). The reader popup already groups
 *    definitions by language with filter chips (Basque precedent).
 *    This is a HEURISTIC — worst case a definition files under the
 *    wrong chip, never data loss.
 *
 * Acquired via `pnpm dsal:scrape dsal-praharaj && pnpm dsal:parse dsal-praharaj`.
 */
import { makeDsalSource } from './dsal.js';

const POS_TOKEN_RANGES = /[^଀-୿]+/;

/** Token-search the gramGrp marker for Odia grammar abbreviations. */
export function mapPraharajPos(posRaw: string | undefined): string | null {
  if (!posRaw) return null;
  const tokens = new Set(posRaw.split(POS_TOKEN_RANGES).filter(Boolean));
  if (tokens.has('କ୍ରି') && tokens.has('ବିଣ')) return 'ADV';
  if (tokens.has('କ୍ରି')) return 'VERB';
  if (tokens.has('ବିଣ')) return 'ADJ';
  if (tokens.has('ବି')) return 'NOUN';
  if (tokens.has('ସର୍ବ')) return 'PRON';
  return null;
}

/**
 * Share of Latin letters among a sense's alphabetic codepoints.
 * Exported for tests and for the PR-review sampling pass.
 */
export function latinShare(body: string): number {
  let latin = 0;
  let alpha = 0;
  for (const ch of body) {
    if (/[A-Za-z]/.test(ch)) {
      latin += 1;
      alpha += 1;
    } else if (/\p{L}/u.test(ch)) {
      alpha += 1;
    }
  }
  return alpha === 0 ? 0 : latin / alpha;
}

export function praharajGlossLanguage(body: string): string {
  return latinShare(body) >= 0.5 ? 'en' : 'or';
}

export const dsalPraharajSource = makeDsalSource({
  name: 'dsal-praharaj',
  language: 'or',
  script: 'Orya',
  attribution:
    'Praharaj, Purnnachandra Ordia Bhashakosha (1931–40), via DSAL, University of Chicago — public domain in India & EU',
  license: 'PublicDomain-IN-EU (US: see docs/dictionary-sources.md)',
  posMap: {},
  mapPos: mapPraharajPos,
  glossLanguageFor: praharajGlossLanguage,
  envVar: 'DSAL_PRAHARAJ_FILE',
  defaultPath: 'data/dictionaries/dsal-praharaj/raw.jsonl',
});
