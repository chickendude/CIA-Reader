import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { switchCurrentLanguage, addLanguage } from './language-switch.js';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('switchCurrentLanguage', () => {
  it('PUTs the code to the current-language endpoint', async () => {
    await switchCurrentLanguage('mr');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/current-language',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ code: 'mr' }),
      }),
    );
  });

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(switchCurrentLanguage('mr')).rejects.toThrow(/500/);
  });
});

describe('addLanguage', () => {
  it('POSTs the code to the languages endpoint', async () => {
    await addLanguage('or');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/languages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'or' }),
      }),
    );
  });

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await expect(addLanguage('or')).rejects.toThrow(/401/);
  });
});
