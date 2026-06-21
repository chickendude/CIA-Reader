/**
 * Client-side Latin → native-script transliteration for the
 * `<ScriptAwareInput>` component (T-6.2a).
 *
 * Implements a small ITRANS-flavored mapping for Devanagari (Hindi +
 * Marathi) and Odia. It's intentionally limited — the goal is good
 * enough that a learner can type "kitaab" and see "किताब" appear
 * without a server round-trip. The full aksharamukha pipeline runs
 * server-side (services/nlp/app/romanize.py) when we need
 * canonical transliteration; the client copy is an interactive
 * stand-in.
 *
 * Pure function — no DOM, no async. Tests cover the edge cases.
 */
import { LANGUAGES, type LanguageCode } from '@ciareader/shared-types';

type Mapping = ReadonlyArray<readonly [string, string]>;

// ITRANS-style consonants. Multi-letter sequences come first so the
// scanner consumes the longest match (kh > k).
const DEVA_CONS: Mapping = [
  ['kSh', 'क्ष'],
  ['jny', 'ज्ञ'],
  ['Sh', 'ष'],
  ['sh', 'श'],
  ['ch', 'च'],
  ['Ch', 'छ'],
  ['kh', 'ख'],
  ['gh', 'घ'],
  ['Th', 'ठ'],
  ['Dh', 'ढ'],
  ['th', 'थ'],
  ['dh', 'ध'],
  ['ph', 'फ'],
  ['bh', 'भ'],
  ['jh', 'झ'],
  ['Rh', 'ढ़'],
  ['Gh', 'ग़'],
  ['Kh', 'ख़'],
  ['Zh', 'ज़'],
  ['Fh', 'फ़'],
  ['k', 'क'],
  ['g', 'ग'],
  ['G', 'ग'],
  ['j', 'ज'],
  ['T', 'ट'],
  ['D', 'ड'],
  ['t', 'त'],
  ['d', 'द'],
  ['n', 'न'],
  ['N', 'ण'],
  ['p', 'प'],
  ['b', 'ब'],
  ['m', 'म'],
  ['y', 'य'],
  ['r', 'र'],
  ['R', 'ड़'],
  ['l', 'ल'],
  ['L', 'ळ'],
  ['v', 'व'],
  ['w', 'व'],
  ['s', 'स'],
  ['S', 'स'],
  ['h', 'ह'],
  ['z', 'ज़'],
  ['f', 'फ़'],
  ['q', 'क़'],
  // Vowel-letter forms (independent vowels at word start)
  ['aa', 'आ'],
  ['A', 'आ'],
  ['ii', 'ई'],
  ['I', 'ई'],
  ['uu', 'ऊ'],
  ['U', 'ऊ'],
  ['ai', 'ऐ'],
  ['au', 'औ'],
  ['e', 'ए'],
  ['o', 'ओ'],
  ['i', 'इ'],
  ['u', 'उ'],
  ['a', 'अ'],
  ['M', 'ं'],
  ['H', 'ः'],
];

// Vowel signs (matras) — applied AFTER a consonant. The `a`
// short-vowel is implicit and produces no sign (and no virama).
const DEVA_VOWEL_SIGNS: Record<string, string> = {
  aa: 'ा',
  A: 'ा',
  ii: 'ी',
  I: 'ी',
  uu: 'ू',
  U: 'ू',
  ai: 'ै',
  au: 'ौ',
  i: 'ि',
  u: 'ु',
  e: 'े',
  o: 'ो',
  a: '', // implicit schwa
};

// Odia uses different codepoints but the same ITRANS scheme. We
// mirror Devanagari's structure; the table is derived by mapping
// the same Latin keys to Odia-equivalent consonants.
const ORYA_CONS: Mapping = [
  ['kSh', 'କ୍ଷ'],
  ['jny', 'ଜ୍ଞ'],
  ['Sh', 'ଷ'],
  ['sh', 'ଶ'],
  ['ch', 'ଚ'],
  ['Ch', 'ଛ'],
  ['kh', 'ଖ'],
  ['gh', 'ଘ'],
  ['Th', 'ଠ'],
  ['Dh', 'ଢ'],
  ['th', 'ଥ'],
  ['dh', 'ଧ'],
  ['ph', 'ଫ'],
  ['bh', 'ଭ'],
  ['jh', 'ଝ'],
  ['k', 'କ'],
  ['g', 'ଗ'],
  ['j', 'ଜ'],
  ['T', 'ଟ'],
  ['D', 'ଡ'],
  ['t', 'ତ'],
  ['d', 'ଦ'],
  ['n', 'ନ'],
  ['N', 'ଣ'],
  ['p', 'ପ'],
  ['b', 'ବ'],
  ['m', 'ମ'],
  ['y', 'ୟ'],
  ['r', 'ର'],
  ['R', 'ଡ଼'],
  ['l', 'ଲ'],
  ['L', 'ଳ'],
  ['v', 'ଵ'],
  ['w', 'ଵ'],
  ['s', 'ସ'],
  ['S', 'ସ'],
  ['h', 'ହ'],
  ['aa', 'ଆ'],
  ['A', 'ଆ'],
  ['ii', 'ଈ'],
  ['I', 'ଈ'],
  ['uu', 'ଊ'],
  ['U', 'ଊ'],
  ['ai', 'ଐ'],
  ['au', 'ଔ'],
  ['e', 'ଏ'],
  ['o', 'ଓ'],
  ['i', 'ଇ'],
  ['u', 'ଉ'],
  ['a', 'ଅ'],
  ['M', 'ଂ'],
  ['H', 'ଃ'],
];

const ORYA_VOWEL_SIGNS: Record<string, string> = {
  aa: 'ା',
  A: 'ା',
  ii: 'ୀ',
  I: 'ୀ',
  uu: 'ୂ',
  U: 'ୂ',
  ai: 'ୈ',
  au: 'ୌ',
  i: 'ି',
  u: 'ୁ',
  e: 'େ',
  o: 'ୋ',
  a: '',
};

const VIRAMA: Record<string, string> = { Deva: '्', Orya: '୍' };

// ----------------------------------------------------------------
// Yiddish: YIVO romanization → Hebrew script.
//
// Client-side mirror of `_yivo_to_hebrew` in
// services/nlp/app/romanize.py — keep the two in sync. Unlike the
// Indic tables there are no vowel signs or viramas; the wrinkles are
// digraphs (sh/kh/ts/zh + the ay/ey/oy diphthongs), word-final letter
// forms (מ→ם etc.), the shtumer alef before word-initial vocalic
// vov/yud (un → און), and the distinguishing points on i/u next to a
// look-alike letter (yidish → ייִדיש, vu → וווּ).
// ----------------------------------------------------------------

const YI_KHIRIK = 'ִ';
const YI_DAGESH = 'ּ';

// Longest-first scan table. Values are the Hebrew renderings; vocalic
// vs consonantal distinctions are resolved by the post-passes below.
const YIVO_TO_HEBR: Mapping = [
  ['dzh', 'דזש'],
  ['tsh', 'טש'],
  ['zh', 'זש'],
  ['sh', 'ש'],
  ['kh', 'כ'],
  ['ts', 'צ'],
  // Letter-pair spellings throughout (matches the server-side
  // converter): modern typed Yiddish writes these as individual
  // letters, not the U+05F0-U+05F2 ligature codepoints.
  ['ay', 'ייַ'],
  ['ey', 'יי'],
  ['oy', 'וי'],
  ['a', 'אַ'],
  ['o', 'אָ'],
  ['u', 'ו'],
  ['i', 'י'],
  ['e', 'ע'],
  ['b', 'ב'],
  ['d', 'ד'],
  ['f', 'פֿ'],
  ['g', 'ג'],
  ['h', 'ה'],
  ['k', 'ק'],
  ['l', 'ל'],
  ['m', 'מ'],
  ['n', 'נ'],
  ['p', 'פּ'],
  ['r', 'ר'],
  ['s', 'ס'],
  ['t', 'ט'],
  ['v', 'וו'],
  ['y', 'י'],
  ['z', 'ז'],
];

// Latin sequences that begin a word with a *vocalic* vov/yud and take
// a leading shtumer alef. Consonantal y/v (yor → יאָר) do not.
const YI_VOCALIC_STARTS = new Set(['u', 'i', 'oy', 'ey', 'ay']);

const YI_FINAL_FORMS: Record<string, string> = {
  מ: 'ם',
  נ: 'ן',
  פֿ: 'ף', // fe loses its rafe in final position
  צ: 'ץ',
  כ: 'ך',
};

function yivoWordToHebrew(word: string): string {
  const units: Array<readonly [string, string]> = [];
  const lower = word.toLowerCase();
  let i = 0;
  while (i < word.length) {
    const m = longestMatch(lower, i, YIVO_TO_HEBR);
    if (m) {
      units.push([lower.substr(i, m.len), m.out]);
      i += m.len;
    } else {
      units.push([word[i]!, word[i]!]);
      i += 1;
    }
  }
  if (units.length === 0) return word;
  // Vocalic i/u adjacent to a look-alike letter take their
  // distinguishing point: khirik yud next to any yud or vov, melupm
  // vov only next to a consonantal vov. Adjacency is judged on the
  // unpointed units so one fix can't suppress its neighbor's.
  const isYudOrVov = (ch: string) => ch === 'י' || ch === 'ו';
  const pointed = units.map(([seq, heb], idx) => {
    const [prevSeq, prevHeb] = units[idx - 1] ?? ['', ''];
    const [nextSeq, nextHeb] = units[idx + 1] ?? ['', ''];
    if (
      seq === 'i' &&
      (isYudOrVov(prevHeb.slice(-1)) || isYudOrVov(nextHeb.charAt(0)))
    ) {
      return [seq, heb + YI_KHIRIK] as const;
    }
    if (seq === 'u' && (prevSeq === 'v' || nextSeq === 'v')) {
      return [seq, heb + YI_DAGESH] as const;
    }
    return [seq, heb] as const;
  });
  const out = pointed.map(([, heb]) => heb);
  if (YI_VOCALIC_STARTS.has(pointed[0]![0])) {
    out.unshift('א');
  }
  const last = out[out.length - 1]!;
  if (YI_FINAL_FORMS[last]) {
    out[out.length - 1] = YI_FINAL_FORMS[last]!;
  }
  return out.join('');
}

function yivoToHebrew(latin: string): string {
  return latin.replace(/[A-Za-z]+/g, (word) => yivoWordToHebrew(word));
}

const VOWEL_KEYS = ['aa', 'A', 'ii', 'I', 'uu', 'U', 'ai', 'au', 'i', 'u', 'e', 'o', 'a'];

/** Lookup the longest matching key in `mapping` at position `i`
 *  inside `latin`. Returns the matched length + the native form, or
 *  null when no key matches. */
function longestMatch(
  latin: string,
  i: number,
  mapping: Mapping,
): { len: number; out: string } | null {
  for (const [k, v] of mapping) {
    if (latin.startsWith(k, i)) return { len: k.length, out: v };
  }
  return null;
}

function longestVowelKey(latin: string, i: number): string | null {
  for (const k of VOWEL_KEYS) {
    if (latin.startsWith(k, i)) return k;
  }
  return null;
}

const CONSONANT_KEYS = new Set<string>();
for (const [k] of DEVA_CONS) {
  if (!VOWEL_KEYS.includes(k) && k !== 'M' && k !== 'H') CONSONANT_KEYS.add(k);
}

/** Detect whether the just-emitted Devanagari/Odia char is a base
 *  consonant (so we may need to attach a vowel sign or virama). The
 *  mapping table key is the source of truth. */
function isConsonantKey(key: string): boolean {
  return CONSONANT_KEYS.has(key);
}

function transliterateScript(
  latin: string,
  cons: Mapping,
  signs: Record<string, string>,
  virama: string,
): string {
  let out = '';
  let i = 0;
  let pendingConsonant = false;
  while (i < latin.length) {
    const ch = latin[i]!;
    if (/\s/.test(ch) || /[.,!?;:'"()-]/.test(ch)) {
      // Non-letter character — flush a pending consonant with a
      // virama? No: a consonant at end-of-word keeps its inherent
      // schwa. We just close the syllable.
      out += ch;
      i += 1;
      pendingConsonant = false;
      continue;
    }
    // If the previous character was a consonant, prefer a vowel-sign
    // match before falling back to a fresh consonant or independent
    // vowel.
    if (pendingConsonant) {
      const vk = longestVowelKey(latin, i);
      if (vk) {
        out += signs[vk]!;
        i += vk.length;
        pendingConsonant = false;
        continue;
      }
      // No vowel followed — flush a virama so this consonant
      // becomes "halant" (joined to the next consonant).
      const next = longestMatch(latin, i, cons);
      if (next && isConsonantKey(latin.substr(i, next.len))) {
        out += virama;
      }
      pendingConsonant = false;
    }
    const m = longestMatch(latin, i, cons);
    if (!m) {
      // Unknown character — pass through.
      out += ch;
      i += 1;
      continue;
    }
    out += m.out;
    const matchedKey = latin.substr(i, m.len);
    pendingConsonant = isConsonantKey(matchedKey);
    i += m.len;
  }
  return out;
}

/**
 * Main entry point: convert a Latin-romanized string to the native
 * script of `language`. Devanagari languages (hi, mr) and Odia (or)
 * use ITRANS-flavored maps; Yiddish (yi) uses YIVO romanization. Any
 * other language returns the input unchanged.
 */
export function latinToNative(language: LanguageCode, latin: string): string {
  const script = LANGUAGES[language].script;
  if (script === 'Deva') {
    return transliterateScript(latin, DEVA_CONS, DEVA_VOWEL_SIGNS, VIRAMA.Deva!);
  }
  if (script === 'Orya') {
    return transliterateScript(latin, ORYA_CONS, ORYA_VOWEL_SIGNS, VIRAMA.Orya!);
  }
  if (script === 'Hebr') {
    return yivoToHebrew(latin);
  }
  return latin;
}

/**
 * Heuristic: does this string look like it was already typed in the
 * native script, or is it Latin awaiting transliteration? We use
 * the Unicode-block check — any single native char counts as
 * "native". The Hebrew check includes the Alphabetic Presentation
 * Forms block (ligature/pointed variants some keyboards emit).
 */
export function looksLikeNativeScript(s: string, language: LanguageCode): boolean {
  if (!s) return false;
  const script = LANGUAGES[language].script;
  if (script === 'Deva') return /[ऀ-ॿ]/.test(s);
  if (script === 'Orya') return /[଀-୿]/.test(s);
  if (script === 'Hebr') return /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(s);
  // Latin-script languages (e.g. Basque) write *in* Latin, so any input is
  // already native \u2014 there is nothing to transliterate. Returning true keeps
  // <ScriptAwareInput> in its plain "native" mode, not the romanization path.
  if (script === 'Latn') return true;
  return false;
}

/** NFC-normalize. Defined here so callers don't need a polyfill
 *  branch; modern browsers + Node both have `String.normalize`. */
export function nfc(s: string): string {
  return typeof s.normalize === 'function' ? s.normalize('NFC') : s;
}
