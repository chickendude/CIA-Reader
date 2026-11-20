export const reviewStatusLabels = {
  attention: 'Needs attention',
  needs_review: 'Needs review',
  uncertain: 'Uncertain',
  none_fit: 'No fitting entry',
  unconfirmed: 'Unconfirmed',
  unparsed: 'Unparsed',
  ai_suggested: 'AI suggested',
  confirmed: 'Confirmed',
} as const;

export type ReviewFilter = keyof typeof reviewStatusLabels;
export type ReviewStatus = Exclude<ReviewFilter, 'attention'>;
export const reviewFilters = Object.keys(reviewStatusLabels) as ReviewFilter[];

export function readReviewFilter(value: string | null): ReviewFilter {
  return reviewFilters.find(filter => filter === value) ?? 'attention';
}
