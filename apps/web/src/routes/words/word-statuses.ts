export const WORD_STATUSES = ['learning', 'known', 'ignored'] as const;
export type WordStatus = (typeof WORD_STATUSES)[number];

export function encodeStatuses(selected: WordStatus[]): string {
  if (selected.length === WORD_STATUSES.length) return 'all';
  return selected.join(',') || 'none';
}
