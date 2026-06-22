/**
 * Reader page-counter, progress-percentage, and progress-bar tests.
 *
 * Progress is now WHOLE-BOOK for chapter-books (each chapter is its own
 * one-chapter text inside a collection): the footer percentage spans
 * the entire book, reaching 0% at the start of the first chapter and
 * 100% at the end of the last — not 0→100 within each chapter. The
 * footer is three columns (`.pager-pages` · `.pager-pct` · `.pager-chapter`)
 * and the bar is a single `.read` fill (0 → endPct) plus a `.dot`
 * marker at endPct.
 *
 * Covered behaviors:
 *   - "Page X of Y" increments on next-page click and resets per chapter.
 *   - Whole-book progress is ~0% on the first chapter and ~100% at the
 *     end of the last chapter.
 *   - Per-page range varies with word density (pages with many words
 *     advance the bar more), and progress increases monotonically.
 *   - The `.read` bar width and the `.dot` position both track endPct.
 *
 * Reads an owned chapter-book from the dev DB (`crush@test.local`) so
 * we don't hardcode UUIDs.
 */
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';
const TEST_EMAIL = 'crush@test.local';

// Tight viewport so a multi-thousand-word chapter reliably renders
// across multiple display pages.
test.use({ viewport: { width: 800, height: 600 } });

/** Smallest chapter token count we accept for the multi-page chapter. */
const MIN_CHAPTER_TOKENS = 800;

type Chapter = { id: string; title: string; position: number; words: number };

/** Find one owned chapter-book (the one containing the single biggest
 *  ready chapter) and return all of its chapters in order. The specs
 *  derive the first chapter (book start = 0%), the last chapter (book
 *  end = 100%), and the biggest chapter (multi-page) from this list. */
async function findBookChapters(): Promise<{
  first: Chapter;
  last: Chapter;
  biggest: Chapter;
}> {
  const sql = postgres(DATABASE_URL);
  try {
    const rows = await sql<Array<Chapter>>`
      WITH owned AS (
        SELECT c.id
        FROM collections c
        JOIN users u ON u.id = c.owner_id
        WHERE u.email = ${TEST_EMAIL} AND c.kind = 'chapter_book'
      ),
      members AS (
        SELECT
          ci.collection_id,
          ci.position,
          t.id AS text_id,
          t.title,
          COALESCE(SUM(tc.token_count), 0)::int AS words
        FROM collection_items ci
        JOIN texts t ON t.id = ci.text_id
        LEFT JOIN text_chapters tc ON tc.text_id = t.id
        WHERE ci.collection_id IN (SELECT id FROM owned)
          AND t.status = 'ready'
        GROUP BY ci.collection_id, ci.position, t.id, t.title
      ),
      target_book AS (
        SELECT collection_id
        FROM members
        WHERE words >= ${MIN_CHAPTER_TOKENS}
        ORDER BY words DESC
        LIMIT 1
      )
      SELECT t.id, t.title, m.position, m.words
      FROM members m
      JOIN texts t ON t.id = m.text_id
      WHERE m.collection_id = (SELECT collection_id FROM target_book)
      ORDER BY m.position
    `;
    expect(
      rows.length,
      `need an owned chapter_book with a >= ${MIN_CHAPTER_TOKENS}-word chapter for ${TEST_EMAIL}`,
    ).toBeGreaterThan(0);
    const chapters = rows.map((r) => ({ ...r, words: Number(r.words) }));
    const biggest = chapters.reduce((a, b) => (b.words > a.words ? b : a));
    return {
      first: chapters[0]!,
      last: chapters[chapters.length - 1]!,
      biggest,
    };
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
 *  when start equals end at the formatted precision). Separator is an
 *  en-dash (U+2013). */
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
  await expect
    .poll(async () => (await readPageCounter(page)).total, {
      message: 'pageCount should rise above 1 once measure() has run',
      timeout: 10_000,
    })
    .toBeGreaterThan(1);
  return readPageCounter(page);
}

/** The whole-book range lives in `.pager-pct` (center footer column). */
async function readPctRange(page: Page): Promise<{ start: number; end: number }> {
  return parsePctRange(await page.locator('.pager-pct').first().innerText());
}

/** Inline `width: N%` on the `.read` fill — tracks endPct (read-through). */
async function readBarReadWidth(page: Page): Promise<number> {
  return await page
    .locator('.reader-foot-bar > .read')
    .evaluate((el) => Number.parseFloat((el as HTMLElement).style.width) || 0);
}

/** Inline `left: N%` on the `.dot` position marker — tracks endPct. */
async function readBarDotLeft(page: Page): Promise<number> {
  return await page
    .locator('.reader-foot-bar > .dot')
    .evaluate((el) => Number.parseFloat((el as HTMLElement).style.left) || 0);
}

async function clickNext(page: Page) {
  await page.getByRole('button', { name: /^Next (page|chapter)$/ }).click();
}

async function expectOnPage(page: Page, expected: number) {
  await expect
    .poll(async () => (await readPageCounter(page)).current, {
      timeout: 10_000,
      message: `expected to be on page ${expected}`,
    })
    .toBe(expected);
}

test.describe('Reader page counter + whole-book progress', () => {
  let book: { first: Chapter; last: Chapter; biggest: Chapter };
  test.beforeAll(async () => {
    book = await findBookChapters();
  });

  test('page counter increments on next-page click and shows total', async ({ page }) => {
    await page.goto(`/reader/${book.biggest.id}?mode=page&chapter=0&token=0`);
    const initial = await waitForMeasureSettled(page);
    expect(initial.current).toBe(1);

    await clickNext(page);
    await expectOnPage(page, 2);
    const second = await readPageCounter(page);
    expect(second.total).toBe(initial.total);

    await clickNext(page);
    await expectOnPage(page, 3);
  });

  test('whole-book progress is ~0% at the start of the first chapter', async ({ page }) => {
    await page.goto(`/reader/${book.first.id}?mode=page&chapter=0&token=0`);
    await expect(page.locator('.pager-pct').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    // First chapter → no words before it in the book → the range START
    // is 0%. (The .read fill tracks endPct — how far you've read THROUGH
    // the page — so it's non-zero even on page 1; that's covered by the
    // bar-tracking test below, not here.)
    await expect
      .poll(async () => (await readPctRange(page)).start, { timeout: 5_000 })
      .toBeLessThanOrEqual(0.5);
  });

  test('whole-book progress reaches ~100% at the end of the last chapter', async ({ page }) => {
    await page.goto(`/reader/${book.last.id}?mode=page&endOfChapter=1`);
    await expect(page.locator('.pager-pct').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    // Land on the actual last page, then read the end percentage.
    await expect
      .poll(
        async () => {
          const s = await readPageCounter(page);
          return s.current === s.total;
        },
        { timeout: 10_000, message: 'should settle on the last page of the last chapter' },
      )
      .toBe(true);
    const last = await readPctRange(page);
    expect(last.end, `last page endPct was ${last.end}; expected >= 95`).toBeGreaterThanOrEqual(
      95,
    );
    expect(await readBarReadWidth(page)).toBeGreaterThanOrEqual(95);
  });

  test('progress increases monotonically and the bar + dot track endPct', async ({ page }) => {
    await page.goto(`/reader/${book.biggest.id}?mode=page&chapter=0&token=0`);
    const total = (await waitForMeasureSettled(page)).total;
    const pagesToCheck = Math.min(total, 5);

    let prevEnd = -1;
    for (let i = 0; i < pagesToCheck; i += 1) {
      await page.waitForTimeout(150);
      const { end } = await readPctRange(page);
      const barRead = await readBarReadWidth(page);
      const dotLeft = await readBarDotLeft(page);
      // Both the fill and the dot track the displayed end percentage.
      // Displayed values round to the book's precision, so allow a
      // 1.5-point tolerance for the parse-then-compare round-trip.
      expect(
        Math.abs(barRead - end),
        `page ${i + 1}: bar read width (${barRead}) should match endPct (${end})`,
      ).toBeLessThanOrEqual(1.5);
      expect(
        Math.abs(dotLeft - end),
        `page ${i + 1}: dot position (${dotLeft}) should match endPct (${end})`,
      ).toBeLessThanOrEqual(1.5);
      // Progress never goes backwards as we page forward.
      expect(end, `page ${i + 1}: endPct should not decrease`).toBeGreaterThanOrEqual(prevEnd);
      prevEnd = end;

      if (i < pagesToCheck - 1) {
        await clickNext(page);
        await expectOnPage(page, i + 2);
      }
    }
  });

  test('pages with many words advance the bar more than pages with few words', async ({
    page,
  }) => {
    await page.goto(`/reader/${book.biggest.id}?mode=page&chapter=0&token=0`);
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
    expect(minRange, `minimum per-page range was ${minRange}; expected > 0`).toBeGreaterThan(0);
    // Denser pages contribute meaningfully more than sparser ones.
    // 1.3× is comfortably above the "uniform pages/N split" bug
    // pattern (~1.0×) while tolerant of CSS column-packing smoothing.
    expect(
      maxRange / Math.max(0.01, minRange),
      `max/min range ratio ${maxRange}/${minRange}; expected > 1.3×`,
    ).toBeGreaterThan(1.3);
  });
});
