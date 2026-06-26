// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./nlp-client.js', () => ({
  nlpClient: { process: vi.fn() },
}));

import { nlpClient } from './nlp-client.js';
import { tokenizeText } from './parse.js';

const processMock = vi.mocked(nlpClient.process);

beforeEach(() => {
  processMock.mockReset();
});

describe('tokenizeText', () => {
  it('returns the language + token stream from the NLP service', async () => {
    processMock.mockResolvedValue({
      language: 'eu',
      pipeline_id: 'stanza-eu',
      tokens: [
        {
          idx: 0,
          surface: 'etxe',
          is_word: true,
          candidates: [{ lemma: 'etxe', pos: 'NOUN', score: 1, features: {} }],
          is_ambiguous: false,
          is_oov: false,
          romanization: null,
          number_forms: null,
        },
      ],
    });

    const out = await tokenizeText('eu', 'etxe');

    expect(out.language).toBe('eu');
    expect(out.tokens).toHaveLength(1);
    expect(out.tokens[0]!.candidates[0]!.lemma).toBe('etxe');
    expect(processMock).toHaveBeenCalledWith('eu', 'etxe');
  });

  it('drops pipeline_id and propagates an empty token list', async () => {
    processMock.mockResolvedValue({ language: 'eu', pipeline_id: 'stanza-eu', tokens: [] });

    const out = await tokenizeText('eu', '...');

    expect(out).toEqual({ language: 'eu', tokens: [] });
    expect(out).not.toHaveProperty('pipeline_id');
  });
});
