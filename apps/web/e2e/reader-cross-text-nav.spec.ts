/**
 * Reader cross-text prev navigation lands on the LAST page of the
 * previous chapter, not page 1.
 *
 * Repro:
 *   - Open chapter N (a chapter-book member) on its first page.
 *   - Click the prev arrow (no prev page or prev internal chapter
 *     in this text → it must walk into the previous text).
 *   - Verify the URL becomes /reader/<prevTextId>?...endOfChapter=1
 *     AND the footer reads "Page N of N" (last page), not "Page 1".
 *
 * Reads a multi-chapter chapter-book collection from the dev DB at
 * setup time so the test doesn't hardcode chapter UUIDs.
 */
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';
const TEST_EMAIL = 'crush@test.local';

type ChapterSibling = { id: string; title: string };

/** Find two consecutive chapters of an owned chapter-book collection
 *  for the seeded test user. The prev chapter MUST have enough text
 *  to span multiple display pages — otherwise "last page" equals
 *  "page 1" and we can't tell whether the cross-text handoff
 *  actually jumped to the end. We filter by chapter `token_count`
 *  and pick the earliest qualifying neighbour-pair. */
async function findChapterPair(): Promise<{
  prevChapter: ChapterSibling;
  currentChapter: ChapterSibling;
}> {
  const sql = postgres(DATABASE_URL);
  try {
    const rows = await sql<
      Array<{
        prev_id: string;
        prev_title: string;
        cur_id: string;
        cur_title: string;
      }>
    >`
      WITH owned_books AS (
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
          tc.token_count
        FROM collection_items ci
        JOIN texts t ON t.id = ci.text_id
        JOIN text_chapters tc ON tc.text_id = t.id
        WHERE ci.collection_id IN (SELECT id FROM owned_books)
          AND t.status = 'ready'
      )
      SELECT
        a.text_id AS prev_id,
        a.title AS prev_title,
        b.text_id AS cur_id,
        b.title AS cur_title
      FROM members a
      JOIN members b
        ON b.collection_id = a.collection_id
       AND b.position = a.position + 1
      WHERE a.token_count >= 500
      ORDER BY a.position
      LIMIT 1
    `;
    const row = rows[0];
    expect(
      row,
      `need an owned chapter_book with a multi-page chapter for ${TEST_EMAIL}`,
    ).toBeDefined();
    return {
      prevChapter: { id: row!.prev_id, title: row!.prev_title },
      currentChapter: { id: row!.cur_id, title: row!.cur_title },
    };
  } finally {
    await sql.end();
  }
}

/** Parse the reader footer to read out the current and total pages.
 *  The footer renders "Page X of Y · Ch. … / …" inside `.pager-pages`. */
async function readPageState(page: Page): Promise<{ current: number; total: number }> {
  const pager = page.locator('.pager-pages').first();
  await expect(pager).toBeVisible();
  const text = (await pager.innerText()).trim();
  const m = /Page\s+(\d+)\s+of\s+(\d+)/.exec(text);
  if (!m) throw new Error(`Pager text didn't match: ${text}`);
  return { current: Number.parseInt(m[1]!, 10), total: Number.parseInt(m[2]!, 10) };
}

test.describe('Reader cross-text prev navigation', () => {
  test('clicking prev from page 1 of chapter N lands on the LAST page of chapter N-1', async ({
    page,
  }) => {
    const { prevChapter, currentChapter } = await findChapterPair();

    // Land on the current chapter in page mode at page 1.
    await page.goto(`/reader/${currentChapter.id}?mode=page&chapter=0&token=0`);
    await expect(page.locator('.pager-pages').first()).toBeVisible({ timeout: 10_000 });
    // Wait for hydration to settle before clicking — in CI's cold
    // start the SSR'd button is on the page before Svelte's onclick
    // handler is attached, so a too-early click was firing without
    // triggering navigation. `networkidle` is a robust proxy for
    // "the page has finished hydrating" in dev mode.
    await page.waitForLoadState('networkidle');
    const start = await readPageState(page);
    expect(start.current).toBe(1);

    // Click the prev arrow. Its aria-label says "Previous chapter"
    // when the click will leave the current chapter — that's our
    // case here because the chapter-book chapter has a single
    // internal chapter, so prev-page at page 1 = prev-text.
    const prevButton = page.getByRole('button', { name: /^Previous (chapter|page)$/ });
    await expect(prevButton).toBeEnabled();
    await prevButton.click();

    // After navigation, URL points at the previous chapter's text
    // with the `endOfChapter=1` handoff flag.
    await page.waitForURL(
      (url) =>
        url.pathname === `/reader/${prevChapter.id}` &&
        url.searchParams.get('endOfChapter') === '1',
      { timeout: 10_000 },
    );

    // The footer should report we're on the LAST page — not page 1.
    // Wait for measurement to settle (pageCount > 0 + the
    // pendingJumpToLast effect to fire).
    await expect(page.locator('.pager-pages').first()).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => (await readPageState(page)).current, {
        message: 'reader should jump to the last page, not stay on page 1',
        timeout: 10_000,
      })
      .toBeGreaterThan(1);
    const end = await readPageState(page);
    expect(end.current).toBe(end.total);
  });

  test('clicking next from the last page of chapter N-1 returns to page 1 of chapter N', async ({
    page,
  }) => {
    const { prevChapter, currentChapter } = await findChapterPair();

    // Land at the end of the previous chapter. The reader measures
    // the column flow in waves (initial paint, then again after
    // token spans render), so we poll until current === total
    // rather than reading the state in one shot the moment current
    // first exceeds 1.
    await page.goto(`/reader/${prevChapter.id}?mode=page&endOfChapter=1`);
    await expect(page.locator('.pager-pages').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    await expect
      .poll(
        async () => {
          const s = await readPageState(page);
          return s.current === s.total;
        },
        {
          timeout: 10_000,
          message: 'reader should settle on the last page of the previous chapter',
        },
      )
      .toBe(true);

    // Click next — should walk into the next text at its first page.
    const nextButton = page.getByRole('button', { name: /^Next (chapter|page)$/ });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await page.waitForURL(
      (url) => url.pathname === `/reader/${currentChapter.id}`,
      { timeout: 10_000 },
    );
    await expect(page.locator('.pager-pages').first()).toBeVisible({ timeout: 10_000 });
    const end = await readPageState(page);
    expect(end.current).toBe(1);
  });
});
