/**
 * Client-side mirror of the `grammar_features` table.
 *
 * Stanza emits raw UD feature codes (`{Tense:Past, Person:1,
 * Number:Sing}`) onto each token and the popup renders pills
 * (`past`, `1`, `sg`) with hover-tooltips ("past tense", "first
 * person", "singular"). The table below is the authoritative data
 * for those labels on the client; the matching DB table is for the
 * curator's grammar-features admin (later) and for the form-editor
 * to render the same pills server-side.
 *
 * Keep the two in sync — the
 * `feature-labels.consistency.test.ts` test asserts every (key,
 * value, short, long, sort, scope) tuple here matches the DB seed
 * row.
 *
 * Unknown (key, value) pairs (e.g. Stanza emits a feature we
 * haven't catalogued yet) fall through with the raw value as both
 * short and long label so the user still sees something useful and
 * the missing entry becomes visible.
 */

export type FeaturePillEntry = {
  featKey: string;
  featValue: string;
  /** POSes this row applies to. Empty array = "all POSes". */
  posScope: readonly string[];
  shortLabel: string;
  longLabel: string;
  /** Drives display order in the popup pill row. */
  sortOrder: number;
};

export const FEATURE_LABELS: readonly FeaturePillEntry[] = [
  // Polarity (verbs + particles)
  { featKey: 'Polarity', featValue: 'Neg', posScope: ['VERB', 'PART'], shortLabel: 'neg', longLabel: 'negative', sortOrder: 10 },
  { featKey: 'Polarity', featValue: 'Pos', posScope: ['VERB', 'PART'], shortLabel: 'pos', longLabel: 'positive', sortOrder: 11 },
  // Tense (verbs)
  { featKey: 'Tense', featValue: 'Past', posScope: ['VERB'], shortLabel: 'past', longLabel: 'past tense', sortOrder: 20 },
  { featKey: 'Tense', featValue: 'Pres', posScope: ['VERB'], shortLabel: 'pres', longLabel: 'present tense', sortOrder: 21 },
  { featKey: 'Tense', featValue: 'Fut', posScope: ['VERB'], shortLabel: 'fut', longLabel: 'future tense', sortOrder: 22 },
  // Aspect (verbs)
  { featKey: 'Aspect', featValue: 'Hab', posScope: ['VERB'], shortLabel: 'hab', longLabel: 'habitual aspect', sortOrder: 30 },
  { featKey: 'Aspect', featValue: 'Imp', posScope: ['VERB'], shortLabel: 'imperf', longLabel: 'imperfective aspect', sortOrder: 31 },
  { featKey: 'Aspect', featValue: 'Perf', posScope: ['VERB'], shortLabel: 'perf', longLabel: 'perfective aspect', sortOrder: 32 },
  { featKey: 'Aspect', featValue: 'Prog', posScope: ['VERB'], shortLabel: 'prog', longLabel: 'progressive aspect', sortOrder: 33 },
  // Mood (verbs)
  { featKey: 'Mood', featValue: 'Ind', posScope: ['VERB'], shortLabel: 'ind', longLabel: 'indicative mood', sortOrder: 40 },
  { featKey: 'Mood', featValue: 'Imp', posScope: ['VERB'], shortLabel: 'imper', longLabel: 'imperative mood', sortOrder: 41 },
  { featKey: 'Mood', featValue: 'Sub', posScope: ['VERB'], shortLabel: 'subj', longLabel: 'subjunctive mood', sortOrder: 42 },
  { featKey: 'Mood', featValue: 'Cnd', posScope: ['VERB'], shortLabel: 'cond', longLabel: 'conditional mood', sortOrder: 43 },
  // VerbForm (verbs)
  { featKey: 'VerbForm', featValue: 'Fin', posScope: ['VERB'], shortLabel: 'fin', longLabel: 'finite verb', sortOrder: 50 },
  { featKey: 'VerbForm', featValue: 'Inf', posScope: ['VERB'], shortLabel: 'inf', longLabel: 'infinitive', sortOrder: 51 },
  { featKey: 'VerbForm', featValue: 'Part', posScope: ['VERB'], shortLabel: 'part', longLabel: 'participle', sortOrder: 52 },
  { featKey: 'VerbForm', featValue: 'Conv', posScope: ['VERB'], shortLabel: 'conv', longLabel: 'converb', sortOrder: 53 },
  { featKey: 'VerbForm', featValue: 'Ger', posScope: ['VERB'], shortLabel: 'ger', longLabel: 'gerund', sortOrder: 54 },
  // Voice (verbs)
  { featKey: 'Voice', featValue: 'Act', posScope: ['VERB'], shortLabel: 'act', longLabel: 'active voice', sortOrder: 60 },
  { featKey: 'Voice', featValue: 'Pass', posScope: ['VERB'], shortLabel: 'pass', longLabel: 'passive voice', sortOrder: 61 },
  { featKey: 'Voice', featValue: 'Mid', posScope: ['VERB'], shortLabel: 'mid', longLabel: 'middle voice', sortOrder: 62 },
  // Person (verbs + pronouns)
  { featKey: 'Person', featValue: '1', posScope: ['VERB', 'PRON'], shortLabel: '1', longLabel: 'first person', sortOrder: 70 },
  { featKey: 'Person', featValue: '2', posScope: ['VERB', 'PRON'], shortLabel: '2', longLabel: 'second person', sortOrder: 71 },
  { featKey: 'Person', featValue: '3', posScope: ['VERB', 'PRON'], shortLabel: '3', longLabel: 'third person', sortOrder: 72 },
  // Number (most inflecting POSes)
  { featKey: 'Number', featValue: 'Sing', posScope: ['NOUN', 'VERB', 'ADJ', 'PRON', 'DET'], shortLabel: 'sg', longLabel: 'singular', sortOrder: 80 },
  { featKey: 'Number', featValue: 'Plur', posScope: ['NOUN', 'VERB', 'ADJ', 'PRON', 'DET'], shortLabel: 'pl', longLabel: 'plural', sortOrder: 81 },
  // Gender
  { featKey: 'Gender', featValue: 'Masc', posScope: ['NOUN', 'VERB', 'ADJ', 'PRON', 'DET'], shortLabel: 'm', longLabel: 'masculine', sortOrder: 90 },
  { featKey: 'Gender', featValue: 'Fem', posScope: ['NOUN', 'VERB', 'ADJ', 'PRON', 'DET'], shortLabel: 'f', longLabel: 'feminine', sortOrder: 91 },
  { featKey: 'Gender', featValue: 'Neut', posScope: ['NOUN', 'VERB', 'ADJ', 'PRON', 'DET'], shortLabel: 'n', longLabel: 'neuter', sortOrder: 92 },
  // Case
  { featKey: 'Case', featValue: 'Nom', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'nom', longLabel: 'nominative case', sortOrder: 100 },
  { featKey: 'Case', featValue: 'Acc', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'acc', longLabel: 'accusative case', sortOrder: 101 },
  { featKey: 'Case', featValue: 'Gen', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'gen', longLabel: 'genitive case', sortOrder: 102 },
  { featKey: 'Case', featValue: 'Dat', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'dat', longLabel: 'dative case', sortOrder: 103 },
  { featKey: 'Case', featValue: 'Loc', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'loc', longLabel: 'locative case', sortOrder: 104 },
  { featKey: 'Case', featValue: 'Abl', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'abl', longLabel: 'ablative case', sortOrder: 105 },
  { featKey: 'Case', featValue: 'Ins', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'ins', longLabel: 'instrumental case', sortOrder: 106 },
  { featKey: 'Case', featValue: 'Voc', posScope: ['NOUN', 'PRON', 'ADJ'], shortLabel: 'voc', longLabel: 'vocative case', sortOrder: 107 },
  // Definite
  { featKey: 'Definite', featValue: 'Def', posScope: ['DET'], shortLabel: 'def', longLabel: 'definite', sortOrder: 110 },
  { featKey: 'Definite', featValue: 'Ind', posScope: ['DET'], shortLabel: 'indef', longLabel: 'indefinite', sortOrder: 111 },
  // PronType
  { featKey: 'PronType', featValue: 'Prs', posScope: ['PRON'], shortLabel: 'pers', longLabel: 'personal pronoun', sortOrder: 120 },
  { featKey: 'PronType', featValue: 'Dem', posScope: ['PRON'], shortLabel: 'dem', longLabel: 'demonstrative pronoun', sortOrder: 121 },
  { featKey: 'PronType', featValue: 'Int', posScope: ['PRON'], shortLabel: 'interr', longLabel: 'interrogative pronoun', sortOrder: 122 },
  { featKey: 'PronType', featValue: 'Rel', posScope: ['PRON'], shortLabel: 'rel', longLabel: 'relative pronoun', sortOrder: 123 },
  { featKey: 'PronType', featValue: 'Ind', posScope: ['PRON'], shortLabel: 'indef', longLabel: 'indefinite pronoun', sortOrder: 124 },
  { featKey: 'PronType', featValue: 'Tot', posScope: ['PRON'], shortLabel: 'tot', longLabel: 'total pronoun', sortOrder: 125 },
  // NumType
  { featKey: 'NumType', featValue: 'Card', posScope: ['NUM', 'DET'], shortLabel: 'card', longLabel: 'cardinal', sortOrder: 130 },
  { featKey: 'NumType', featValue: 'Ord', posScope: ['NUM', 'DET'], shortLabel: 'ord', longLabel: 'ordinal', sortOrder: 131 },
  { featKey: 'NumType', featValue: 'Mult', posScope: ['NUM', 'DET'], shortLabel: 'mult', longLabel: 'multiplicative', sortOrder: 132 },
  // Politeness
  { featKey: 'Politeness', featValue: 'Form', posScope: ['VERB', 'PRON'], shortLabel: 'formal', longLabel: 'formal', sortOrder: 140 },
  { featKey: 'Politeness', featValue: 'Infm', posScope: ['VERB', 'PRON'], shortLabel: 'informal', longLabel: 'informal', sortOrder: 141 },
  { featKey: 'Politeness', featValue: 'Elev', posScope: ['VERB', 'PRON'], shortLabel: 'honorific', longLabel: 'honorific', sortOrder: 142 },
  // Clusivity (inclusive/exclusive 1pl in some Indo-Aryan dialects)
  { featKey: 'Clusivity', featValue: 'In', posScope: ['VERB', 'PRON'], shortLabel: 'incl', longLabel: 'inclusive (we, including you)', sortOrder: 150 },
  { featKey: 'Clusivity', featValue: 'Ex', posScope: ['VERB', 'PRON'], shortLabel: 'excl', longLabel: 'exclusive (we, not including you)', sortOrder: 151 },
];

export type FeaturePill = {
  featKey: string;
  featValue: string;
  shortLabel: string;
  longLabel: string;
};

const INDEX = new Map<string, FeaturePillEntry>(
  FEATURE_LABELS.map((entry) => [`${entry.featKey}::${entry.featValue}`, entry]),
);

/**
 * Turn a `(pos, features)` blob into ordered display pills.
 *
 *  - Filters by `posScope`: a `Tense` row tagged `[VERB]` doesn't
 *    contribute to a NOUN lemma (Stanza occasionally cross-pollinates
 *    features when a participle is tagged ADJ).
 *  - Output sorted by the catalog's `sortOrder` so categories
 *    cluster predictably (polarity → tense → aspect → person →
 *    number → gender → case → …).
 *  - Unknown `(key, value)` pairs surface raw — better than dropping
 *    data and the missing seed becomes visible.
 */
export function getFeaturePills(
  pos: string,
  features: Record<string, string>,
): FeaturePill[] {
  type Sortable = FeaturePill & { sortOrder: number };
  const out: Sortable[] = [];
  for (const [key, value] of Object.entries(features)) {
    if (value === undefined || value === '') continue;
    const entry = INDEX.get(`${key}::${value}`);
    if (entry) {
      const scopeOk = entry.posScope.length === 0 || entry.posScope.includes(pos);
      if (!scopeOk) continue;
      out.push({
        featKey: entry.featKey,
        featValue: entry.featValue,
        shortLabel: entry.shortLabel,
        longLabel: entry.longLabel,
        sortOrder: entry.sortOrder,
      });
    } else {
      out.push({
        featKey: key,
        featValue: value,
        shortLabel: value,
        longLabel: `${key}=${value}`,
        sortOrder: 9_999,
      });
    }
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder);
  return out.map(({ sortOrder: _drop, ...rest }) => rest);
}
