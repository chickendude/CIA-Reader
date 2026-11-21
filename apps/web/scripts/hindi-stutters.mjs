// Offline imports apply the same occurrence decisions as reader reprocessing.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applyHindiStutters } from '../src/lib/server/texts/hindi-stutters.ts';
import {
  coveredStutters,
  fragmentReading,
  projectHindiMerges,
  sameMerge,
  storedHindiMerges,
} from '../src/lib/server/texts/hindi-merge-projection.ts';
import { hindiSyllableRuns, matchHindiMerges } from '../src/lib/dictionary/hindi-merge.ts';

const input = JSON.parse(readFileSync(0, 'utf8'));
const hash = createHash('sha256').update(input.body).digest('hex');
const previous = input.previous?.stutter_text_hash === hash ? input.previous : {};
const { tokens, analysis } = applyHindiStutters(
  input.tokens,
  input,
  [...(previous.stutters ?? []), ...coveredStutters(previous)],
  hash,
);
const saved = storedHindiMerges(previous);
const options = saved.length
  ? matchHindiMerges(
      hindiSyllableRuns(tokens.map((t) => ({ ...t, isWord: t.is_word }))),
      input.entries,
    )
  : [];
const result = projectHindiMerges(
  tokens,
  analysis.occurrences,
  analysis.stats,
  options.filter((m) => saved.some((s) => sameMerge(s, m))),
  fragmentReading,
);
process.stdout.write(
  JSON.stringify({
    stats: result.stats,
    occurrences: result.occurrences,
    changed: result.tokens.filter((t, i) => t !== input.tokens[i]),
  }),
);
