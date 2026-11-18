// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { hindiContextPassage, suggestHindiContext } from './hindi-ai.js';
it('marks the exact occurrence when the word is repeated', () => {
  expect(
    hindiContextPassage(
      [
        { idx: 0, surface: 'एक' },
        { idx: 1, surface: ' ' },
        { idx: 2, surface: 'एक' },
      ],
      2,
    ),
  ).toBe('एक 【एक】');
});
const input = {
  surface: 'एक',
  context: 'अध्याय - एक',
  candidates: [
    { id: 'number', lemma: 'एक', pos: 'NUM', definition: 'one (1), a' },
    { id: 'adjective', lemma: 'एक', pos: 'ADJ', definition: 'sole, only; united' },
  ],
};
function response(value: unknown) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] })),
    );
}
it('keeps supported AI suggestions distinct from human confirmation', async () => {
  const fetchImpl = response({
    outcome: 'selected',
    entryIds: ['number'],
    reason: 'The chapter number.',
  });
  const result = await suggestHindiContext(input, {
    apiKey: 'test',
    model: 'test-model',
    fetchImpl,
  });
  expect(result).toEqual({
    outcome: 'selected',
    entryIds: ['number'],
    reason: 'The chapter number.',
    model: 'test-model',
  });
  const request = JSON.parse(fetchImpl.mock.calls[0]![1].body);
  expect(JSON.parse(request.messages[1].content)).toEqual(input);
});
it('rejects invented IDs and accepts explicit abstentions', async () => {
  await expect(
    suggestHindiContext(input, {
      apiKey: 'test',
      fetchImpl: response({ outcome: 'selected', entryIds: ['invented'], reason: '' }),
    }),
  ).rejects.toThrow('unsupported');
  expect(
    (
      await suggestHindiContext(input, {
        apiKey: 'test',
        fetchImpl: response({ outcome: 'uncertain', entryIds: [], reason: 'Not enough context.' }),
      })
    ).outcome,
  ).toBe('uncertain');
});
