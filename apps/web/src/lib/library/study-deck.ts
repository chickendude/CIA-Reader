export type DeckScope = 'target' | 'unknown' | 'learning' | 'all';
export type DeckOptions = {
  scope: DeckScope;
  target: number;
  ignoreProper: boolean;
  ignoreLoans: boolean;
};
export type StudyEntry = {
  status: 'known' | 'learning' | 'unknown' | 'ignored' | 'unresolved';
  frequency: number;
  proper: boolean;
  loan: boolean;
};
export type StudyBand = StudyEntry & { entries: number };

export function eligibleForDeck(row: StudyEntry, options: DeckOptions) {
  if (row.status === 'unresolved' || excludedCategory(row, options)) return false;
  if (options.scope === 'all') return true;
  return row.status === (options.scope === 'target' ? 'unknown' : options.scope);
}

function excludedCategory(row: StudyEntry, options: DeckOptions) {
  return (options.ignoreProper && row.proper) || (options.ignoreLoans && row.loan);
}

// Bands are ordered by decreasing frequency. Every entry in a band has the same study state and filters.
export function studyDeckPlan(bands: StudyBand[], options: DeckOptions) {
  let total = 0;
  let covered = 0;
  for (const band of bands) {
    if (band.status === 'ignored' || excludedCategory(band, options)) continue;
    const occurrences = band.frequency * band.entries;
    total += occurrences;
    if (band.status === 'known' || band.status === 'learning') covered += occurrences;
  }
  const threshold = Math.ceil(total * Math.round(options.target * 10) / 1000);
  let count = 0;
  for (const band of bands) {
    if (options.scope === 'target' && covered >= threshold) break;
    if (!eligibleForDeck(band, options)) continue;
    const needed = options.scope === 'target'
      ? Math.min(band.entries, Math.ceil((threshold - covered) / band.frequency))
      : band.entries;
    count += needed;
    if (band.status === 'unknown') covered += needed * band.frequency;
  }
  return { count, total, covered, reached: total > 0 && covered >= threshold };
}
