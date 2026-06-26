// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// bookComprehensionPct runs one aggregate query and maps the row; mock the
// db so we exercise the rounding / null-handling logic without a real DB.
const executeFn = vi.fn();

vi.mock('./db/index.js', () => ({
  db: { execute: (...a: unknown[]) => executeFn(...a) },
}));

const { bookComprehensionPct } = await import('./learning-stats.js');

beforeEach(() => {
  executeFn.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('bookComprehensionPct', () => {
  it('returns known ÷ total word-tokens as a rounded percent', async () => {
    executeFn.mockResolvedValueOnce([{ total: 100, known: 72 }]);
    expect(await bookComprehensionPct('u1', ['t1', 't2'])).toBe(72);
  });

  it('rounds to the nearest whole percent', async () => {
    executeFn.mockResolvedValueOnce([{ total: 3, known: 1 }]); // 33.33%
    expect(await bookComprehensionPct('u1', ['t1'])).toBe(33);
  });

  it('is null when the texts have no word tokens yet (worker not run)', async () => {
    executeFn.mockResolvedValueOnce([{ total: 0, known: 0 }]);
    expect(await bookComprehensionPct('u1', ['t1'])).toBeNull();
  });

  it('is null (and runs no query) for an empty text set', async () => {
    expect(await bookComprehensionPct('u1', [])).toBeNull();
    expect(executeFn).not.toHaveBeenCalled();
  });
});
