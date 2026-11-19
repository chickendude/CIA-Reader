import { expect, it } from 'vitest';
import { load } from './+page.server.js';

it.each(['', '?tab=official&sort=unique'])('opens the Library at the root with query %s', (query) => {
  const url = new URL(`https://example.test/${query}`);
  expect(() => load({ url } as Parameters<typeof load>[0])).toThrow(
    expect.objectContaining({ status: 307, location: `/library${query}` }),
  );
});
