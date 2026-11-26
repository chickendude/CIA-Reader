import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import BookMetrics from './BookMetrics.svelte';

afterEach(cleanup);

it('shows combined coverage with separate Known and Learning counts in the breakdown', async () => {
  render(BookMetrics, { signedIn: true, stats: {
    words: 20, uniqueWords: 5, unresolved: 0, unparsedWords: 0,
    knownWords: 12, learningWords: 4, knownHeadwords: 2, learningHeadwords: 1,
    knownPct: 60, learningPct: 80, uniquePct: 40,
  } });
  expect(screen.getByText('80%')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Vocabulary coverage breakdown' });
  const hover = Object.assign(new Event('pointerenter'), { pointerType: 'mouse' });
  await fireEvent(button.parentElement!, hover);
  const tooltip = screen.getByRole('tooltip');
  expect(tooltip.textContent).toContain('Known 60% (2 words)');
  expect(tooltip.textContent).toContain('Learning 20% (1 word)');
});
