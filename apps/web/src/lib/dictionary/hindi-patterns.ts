// The choices follow HindiDB's editor. The NLP service generates the actual forms.
const nouns = ['NOUN', 'PROPN'];
const adjectives = ['ADJ', 'DET', 'PRON', 'ADP'];
const verbs = ['VERB', 'AUX'];
// Exclude independent vowels, vowel signs, chandrabindu and anusvara.
const consonant = /[^\u0901-\u0902\u093e-\u094cअ-औॠ-ॡ]$/u;

type Pattern = { id: string; label: string; pos: string[]; ending: RegExp };
const patterns: Pattern[] = [
  { id: 'invariant', label: 'No generated forms', pos: [], ending: /.*/u },
  { id: 'noun_m_aa', label: 'Masculine आ', pos: nouns, ending: /[ाआ]$/u },
  { id: 'noun_f_aa', label: 'Feminine आ', pos: nouns, ending: /[ाआ]$/u },
  { id: 'noun_m_ind_aan', label: 'Masculine आँ', pos: nouns, ending: /आ[ँं]$/u },
  { id: 'noun_mf_aa_ii', label: 'Masculine ा / feminine ी', pos: nouns, ending: /ा$/u },
  { id: 'noun_m_consonant', label: 'Masculine consonant ending', pos: nouns, ending: consonant },
  { id: 'noun_f_consonant', label: 'Feminine consonant ending', pos: nouns, ending: consonant },
  { id: 'noun_m_ii', label: 'Masculine ई', pos: nouns, ending: /ी$/u },
  { id: 'noun_f_ii', label: 'Feminine ई', pos: nouns, ending: /ी$/u },
  { id: 'noun_m_uu', label: 'Masculine ऊ', pos: nouns, ending: /[ूऊ]$/u },
  { id: 'noun_f_uu', label: 'Feminine ऊ', pos: nouns, ending: /[ूऊ]$/u },
  { id: 'noun_mf_uu', label: 'Masculine and feminine ऊ', pos: nouns, ending: /[ूऊ]$/u },
  { id: 'adj_aa', label: 'Adjective agreement (ा, े, ी)', pos: adjectives, ending: /ा$/u },
  { id: 'verb_consonant', label: 'Regular consonant stem', pos: verbs, ending: /(?:[क-ह]|\u093c)ना$/u },
  { id: 'verb_aa', label: 'Regular आ stem', pos: verbs, ending: /[ाआ]ना$/u },
  { id: 'verb_explicit', label: 'Common verb forms and irregulars', pos: verbs, ending: /.+ना$/u },
];

export function hindiPatterns(headword: string, pos: string, current: string) {
  return patterns.filter(
    (p) =>
      p.id === current ||
      p.id === 'invariant' ||
      (p.pos.includes(pos) && p.ending.test(headword.trim().normalize('NFC'))),
  );
}

export function patternLabel(id: string) {
  return patterns.find((p) => p.id === id)?.label ?? id;
}
