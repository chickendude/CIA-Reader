import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import DefinitionMeanings from './DefinitionMeanings.svelte';

afterEach(cleanup);

it('numbers major meanings while preserving commas within each sense', () => {
  const { getAllByRole, getByRole } = render(DefinitionMeanings, {
    text: 'who, which; whoever, whichever, whatever',
  });
  expect(getByRole('list').tagName).toBe('OL');
  expect(getAllByRole('listitem').map((row) => row.textContent)).toEqual([
    'who, which',
    'whoever, whichever, whatever',
  ]);
});
