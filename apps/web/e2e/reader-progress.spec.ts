/**
 * Reader page-counter, progress-percentage, and progress-bar tests.
 *
 * Covered behaviors:
 *   - The "Page X of Y" counter increments on next-page click and
 *     resets to 1 on a fresh chapter load.
 *   - The displayed start/end percentage range stays in sync with
 *     the inline `width: %` on the `.read` / `.current` progress
 *     bar segments.
 *   - Word-based math: pages with many words advance the bar more
 *     than pages with few words (the per-page range varies with
 *     actual word density, not with a uniform pages/N split).
 *   - Walking from page 1 to the last page covers ~100% of the bar.
 *
 * Reads a multi-page owned chapter from the dev DB (`crush@test.local`)
 * so we don't hardcode UUIDs and so edge-cases naturally surface in
 * real publisher content (chapter intros / outros are often sparse,
 * mid-chapter prose is dense).
 */
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';
const TEST_EMAIL = 'crush@test.local';

// Tight viewport so a multi-thousand-word chapter reliably renders
// across multiple display pages. The default Desktop Chrome viewport
// (1280×720) can fit a 5k-word chapter into a single column on a
// wide screen — fine in practice but it makes the page-counter
// assertions meaningless.
test.use({ viewport: { width: 800, height: 600 } });

/** Smallest chapter token count we accept — enough to span at least
 *  several display pages at the default viewport. */
const MIN_CHAPTER_TOKENS = 800;

async function findMultiPageChapter(): Promise<{ id: string; title: string }> {
  const sql = postgres(DATABASE_URL);
  try {
    const rows = await sql<Array<{ id: string; title: string }>>`
      SELECT t.id, t.title
      FROM texts t
      JOIN text_chapters tc ON tc.text_id = t.id
      JOIN collection_items ci ON ci.text_id = t.id
      JOIN collections c ON c.id = ci.collection_id
      JOIN users u ON u.id = c.owner_id
      WHERE u.email = ${TEST_EMAIL}
        AND c.kind = 'chapter_book'
        AND t.status = 'ready'
        AND tc.token_count >= ${MIN_CHAPTER_TOKENS}
      ORDER BY tc.token_count DESC
      LIMIT 1
    `;
    expect(
      rows[0],
      `need a ready chapter-book chapter with >= ${MIN_CHAPTER_TOKENS} words for ${TEST_EMAIL}`,
    ).toBeDefined();
    return rows[0]!;
  } finally {
    await sql.end();
  }
}

function parsePageCounter(text: string): { current: number; total: number } {
  const m = /Page\s+(\d+)\s+of\s+(\d+)/.exec(text);
  if (!m) throw new Error(`Could not parse page counter from "${text}"`);
  return { current: Number.parseInt(m[1]!, 10), total: Number.parseInt(m[2]!, 10) };
}

/** Parse the formatted `startPct–endPct%` range (or single `endPct%`
 *  when start equals end at the formatted precision). Note: the
 *  separator is an en-dash (U+2013), not a hyphen. */
function parsePctRange(text: string): { start: number; end: number } {
  const range = /([\d.]+)[–-]([\d.]+)\s*%/.exec(text);
  if (range)
    return {
      start: Number.parseFloat(range[1]!),
      end: Number.parseFloat(range[2]!),
    };
  const single = /([\d.]+)\s*%/.exec(text);
  if (!single) throw new Error(`Could not parse pct range from "${text}"`);
  const v = Number.parseFloat(single[1]!);
  return { start: v, end: v };
}

async function readPageCounter(page: Page): Promise<{ current: number; total: number }> {
  return parsePageCounter(await page.locator('.pager-pages').first().innerText());
}

/** Wait for the column-flow measurement to settle so `pageCount`
 *  reflects the real chapter (initially 1 until measure() runs). */
async function waitForMeasureSettled(page: Page): Promise<{ current: number; total: number }> {
  await expect.poll(
    async () => (await readPageCounter(page)).total,
    {
      message: 'pageCount should rise above 1 once measure() has run',
      timeout: 10_000,
    },
  ).toBeGreaterThan(1);
  return readPageCounter(page);
}

async function readPctRange(page: Page): Promise<{ start: number; end: number }> {
  return parsePctRange(
    await page.locator('.reader-foot-meta > .muted').last().innerText(),
  );
}

/** Inline `width: N%` on the .read element of the progress bar. */
async function readBarReadWidth(page: Page): Promise<number> {
  return await page
    .locator('.reader-foot-bar > .read')
    .evaluate((el) => Number.parseFloat((el as HTMLElement).style.width) || 0);
}

/** Inline `width: N%` on the .current element of the progress bar. */
async function readBarCurrentWidth(page: Page): Promise<number> {
  return await page
    .locator('.reader-foot-bar > .current')
    .evaluate((el) => Number.parseFloat((el as HTMLElement).style.width) || 0);
}

/** Click the within-chapter next-page arrow. Either label fires
 *  the same handler — the label flips to "Next chapter" when the
 *  next click will leave the current chapter. */
async function clickNext(page: Page) {
  await page
    .getByRole('button', { name: /^Next (page|chapter)$/ })
    .click();
}

/** Wait until the page counter reports the expected page number.
 *  Allows the click + measure + layout flush to settle. */
async function expectOnPage(page: Page, expected: number) {
  await expect
    .poll(async () => (await readPageCounter(page)).current, {
      timeout: 10_000,
      message: `expected to be on page ${expected}`,
    })
    .toBe(expected);
}

test.describe('Reader page counter + progress', () => {
  let chapterId: string;
  test.beforeAll(async () => {
    chapterId = (await findMultiPageChapter()).id;
  });

  test('page counter increments on next-page click and shows total', async ({ page }) => {
    await page.goto(`/reader/${chapterId}?mode=page&chapter=0&token=0`);
    const initial = await waitForMeasureSettled(page);
    expect(initial.current).toBe(1);

    await clickNext(page);
    await expectOnPage(page, 2);
    const second = await readPageCounter(page);
    expect(second.total).toBe(initial.total);

    await clickNext(page);
    await expectOnPage(page, 3);
  });

  test('start percentage on page 1 is 0%', async ({ page }) => {
    await page.goto(`/reader/${chapterId}?mode=page&chapter=0&token=0`);
    await waitForMeasureSettled(page);
    await expect.poll(async () => (await readPctRange(page)).start, {
      timeout: 5_000,
    }).toBe(0);
    // Bar's "read" segment should also be 0%.
    expect(await readBarReadWidth(page)).toBe(0);
  });

  test('progress bar widths track the displayed startPct and (endPct - startPct)', async ({
    page,
  }) => {
    await page.goto(`/reader/${chapterId}?mode=page&chapter=0&token=0`);
    const total = (await waitForMeasureSettled(page)).total;
    const pagesToCheck = Math.min(total, 5);

    for (let i = 0; i < pagesToCheck; i += 1) {
      // Wait for the current page state to settle (poll until the
      // bar width is stable for one iteration).
      await page.waitForTimeout(150);
      const { start, end } = await readPctRange(page);
      const barRead = await readBarReadWidth(page);
      const barCurrent = await readBarCurrentWidth(page);
      // Displayed values are rounded to integer percent precision
      // for short chapters, so we allow a 1.5%-point tolerance to
      // cover the parse-then-compare round-trip. The .read bar
      // tracks startPct verbatim; the .current bar tracks the
      // (end - start) range.
      expect(
        Math.abs(barRead - start),
        `page ${i + 1}: bar read width (${barRead}) should match startPct (${start})`,
      ).toBeLessThanOrEqual(1.5);
      expect(
        Math.abs(barCurrent - (end - start)),
        `page ${i + 1}: bar current width (${barCurrent}) should match endPct - startPct (${end - start})`,
      ).toBeLessThanOrEqual(1.5);

      if (i < pagesToCheck - 1) {
        await clickNext(page);
        await expectOnPage(page, i + 2);
      }
    }
  });

  test('pages with many words advance the bar more than pages with few words', async ({
    page,
  }) => {
    // Word-based math: each page contributes (wordsOnPage / totalWords)
    // to the bar. Real publisher content is uneven — chapter intros
    // / outros pack fewer words per page than mid-chapter prose. If
    // the per-page range were uniform, this test would fail.
    await page.goto(`/reader/${chapterId}?mode=page&chapter=0&token=0`);
    const total = (await waitForMeasureSettled(page)).total;
    test.skip(total < 4, 'need at least 4 pages to see meaningful variance');

    const ranges: number[] = [];
    for (let i = 1; i <= total; i += 1) {
      await page.waitForTimeout(120);
      const { start, end } = await readPctRange(page);
      ranges.push(end - start);
      if (i < total) {
        await clickNext(page);
        await expectOnPage(page, i + 1);
      }
    }

    const minRange = Math.min(...ranges);
    const maxRange = Math.max(...ranges);
    expect(
      minRange,
      `minimum per-page range was ${minRange}; expected > 0`,
    ).toBeGreaterThan(0);
    // The denser page should contribute meaningfully more than the
    // sparser one. Real publisher content shows 2-3× variance; the
    // CI seed (lorem-ipsum with mixed paragraph sizes) typically
    // settles around 1.3-1.6× because CSS column packing smooths
    // variance. 1.3× is comfortably above the "uniform pages/N
    // split" bug pattern (which would produce ~1.0×) and still
    // strict enough that a regression to "all pages equal" fails.
    expect(
      maxRange / Math.max(0.1, minRange),
      `max/min range ratio ${maxRange}/${minRange}; expected > 1.3×`,
    ).toBeGreaterThan(1.3);
  });

  test('walking from page 1 to the last page covers ~100% of the chapter', async ({
    page,
  }) => {
    await page.goto(`/reader/${chapterId}?mode=page&chapter=0&token=0`);
    const total = (await waitForMeasureSettled(page)).total;

    // First page should start at 0%.
    await expect.poll(async () => (await readPctRange(page)).start).toBe(0);

    // Jump straight to the last page via the cross-text "endOfChapter"
    // handoff URL — the same flag the reader uses internally when
    // arriving via prev-text nav. Verifies endPct hits ~100% there.
    await page.goto(`/reader/${chapterId}?mode=page&endOfChapter=1`);
    await waitForMeasureSettled(page);
    await expect
      .poll(async () => (await readPageCounter(page)).current, {
        timeout: 10_000,
      })
      .toBe(total);
    const last = await readPctRange(page);
    expect(
      last.end,
      `last page endPct was ${last.end}; expected ≥ 95`,
    ).toBeGreaterThanOrEqual(95);
  });
});
