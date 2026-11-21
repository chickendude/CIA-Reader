export type HindiMerge = {
  first: number;
  last: number;
  surface: string;
  lemmaId: string;
  headword: string;
  pos: string;
};

type Word = { idx: number; surface: string; isWord: boolean };
const hyphen = /^[-‐‑]$/u;
const consonant = /^[क-हक़-य़]$/u;
const normalize = (word: string) => word.replace(/\u200c|\u200d|\ufeff/gu, '').normalize('NFC');

function syllableSpellings(parts: string[]) {
  return parts.map((part, i) => {
    const left = parts[i - 1]?.at(-1) ?? '';
    if (!consonant.test(left) || !consonant.test(part[0]!)) return [part];
    // A spoken break can repeat the consonant or omit the halant that joins two consonants.
    return left === part[0] ? [part, '्' + part, part.slice(1)] : [part, '्' + part];
  });
}

function matchesWord(syllables: string[][], word: string) {
  // Different joins can reach the same position in a word with repeated consonants.
  let offsets = new Set([0]);
  for (const spellings of syllables) {
    const next = new Set<number>();
    for (const start of offsets) {
      for (const spelling of spellings) {
        if (word.startsWith(spelling, start)) next.add(start + spelling.length);
      }
    }
    if (!next.size) return false;
    offsets = next;
  }
  return offsets.has(word.length);
}

export function hindiSyllableRuns(tokens: Word[]) {
  const runs = [];
  for (let i = 0; i < tokens.length; i++) {
    const first = i;
    if (!tokens[i]!.isWord) continue;
    while (hyphen.test(tokens[i + 1]?.surface ?? '') && tokens[i + 2]?.isWord) i += 2;
    if (first === i) continue;
    const span = tokens.slice(first, i + 1);
    const parts = span.filter((_, n) => n % 2 === 0).map((t) => normalize(t.surface));
    if (!parts.every((s) => /^[\p{Script=Devanagari}]+$/u.test(s) && /\p{L}/u.test(s))) continue;
    runs.push({
      first: tokens[first]!.idx,
      last: tokens[i]!.idx,
      prefix: parts[0]!,
      syllables: syllableSpellings(parts),
      surface: span.map((t) => t.surface).join(''),
      gap: tokens[i + 1]?.surface ?? '',
    });
  }
  return runs;
}

export function matchHindiMerges(
  runs: ReturnType<typeof hindiSyllableRuns>,
  entries: { id: string; headword: string; pos: string }[],
) {
  const matches: HindiMerge[] = [];
  for (const [i, start] of runs.entries()) {
    for (const { id, headword, pos } of entries) {
      const words = normalize(headword).split(' ');
      let surface = '';
      for (const [n, word] of words.entries()) {
        const run = runs[i + n];
        if (!run || !matchesWord(run.syllables, word)) break;
        if (n) {
          const prev = runs[i + n - 1]!;
          if (prev.last + 2 !== run.first || !/^[^\S\r\n]+$/u.test(prev.gap)) break;
          surface += prev.gap;
        }
        surface += run.surface;
        if (n === words.length - 1)
          matches.push({ first: start.first, last: run.last, surface, lemmaId: id, headword, pos });
      }
    }
  }
  return matches.sort((a, b) => b.last - b.first - (a.last - a.first));
}
