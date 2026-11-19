import { describe, expect, it } from 'vitest';
import { detectStutters, projectStutters } from './hindi-stutters';

function parse(text: string, dictionary: Record<string, string> = {}) {
  const tokens = Array.from(text.matchAll(/[\p{L}\p{M}\u200d]+|\s+|./gu), ([surface], idx) => ({
    idx,
    surface,
    is_word: /\p{L}/u.test(surface),
    is_oov: /\p{L}/u.test(surface) && !dictionary[surface],
  }));
  const occurrences = tokens.flatMap((t) =>
    dictionary[t.surface]
      ? [
          {
            start_idx: t.idx,
            end_idx: t.idx + 1,
            lemma_id: dictionary[t.surface]!,
          },
        ]
      : [],
  );
  const stats = {
    source_words: tokens.filter((t) => t.is_word).length,
    unresolved_occurrences: tokens.filter((t) => t.is_oov).length,
  };
  return { tokens, occurrences, stats };
}

describe('Hindi stutters', () => {
  it('counts the final word and keeps the original Unicode offsets', () => {
    const { tokens, occurrences, stats } = parse('🙂 प-प-पॉटर ब-ब-बता म-म-मैं क्-क्या र-रिडल', {
      पॉटर: 'potter',
      बता: 'tell',
      मैं: 'I',
      क्या: 'what',
    });
    const spans = detectStutters(tokens, occurrences, []);
    expect(spans.map((s) => s.status)).toEqual(Array(5).fill('auto'));
    expect(spans[0]).toMatchObject({ start: 2, surface: 'प-प-पॉटर' });
    const result = projectStutters(tokens, occurrences, stats, spans, 'fixture');
    expect(result.stats).toMatchObject({ source_words: 5, unresolved_occurrences: 1 });
    expect(result.occurrences).toEqual(occurrences);
  });

  it('keeps staff decisions specific to the occurrence', () => {
    const { tokens, occurrences, stats } = parse('कि-कि-किताब कि-कि-किताब हक-हकलाते', {
      कि: 'that',
      किताब: 'book',
    });
    const pending = detectStutters(tokens, occurrences, []);
    expect(pending.map((s) => s.status)).toEqual(['pending', 'pending', 'pending']);
    pending[0]!.status = 'confirmed';
    pending[1]!.status = 'separate';
    const spans = detectStutters(tokens, occurrences, pending);
    expect(spans).toEqual(pending);
    const result = projectStutters(tokens, occurrences, stats, spans, 'fixture');
    expect(result.occurrences.filter((o) => o.lemma_id === 'that')).toHaveLength(2);
    expect(result.stats.source_words).toBe(stats.source_words - 2);
  });

  it('preserves compounds, repetition, spacing and shared dictionary readings', () => {
    const { tokens, occurrences } = parse('क-कम धीरे-धीरे देख-देखकर प - पर शू-शू-मंतर', {
      देख: 'see',
      देखकर: 'see',
    });
    occurrences.push({ start_idx: 0, end_idx: 3, lemma_id: 'compound' });
    expect(detectStutters(tokens, occurrences, [])).toEqual([]);
  });
});
