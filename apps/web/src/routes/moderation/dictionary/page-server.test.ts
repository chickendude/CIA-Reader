// @vitest-environment node
import { expect, it } from 'vitest';
import { load } from './+page.server.js';

function visit(query: string) {
  return load({
    url: new URL('http://localhost/moderation/dictionary' + query),
    parent: async () => ({ moderator: { grantedLanguages: ['hi', 'mr'] } }),
  } as unknown as Parameters<typeof load>[0]);
}

it('redirects the previous moderation home to the new home', async () => {
  await expect(visit('')).rejects.toMatchObject({ location: '/moderation' });
});

it('opens saved dictionary searches in the dictionary', async () => {
  await expect(visit('?language=mr&q=test&offset=50')).rejects.toMatchObject({
    location: '/dictionary/mr?q=test&offset=50',
  });
});

it('checks language grants for saved searches', async () => {
  await expect(visit('?language=or')).rejects.toMatchObject({ status: 403 });
});
