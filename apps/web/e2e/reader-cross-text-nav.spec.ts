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
  test('a reference visit preserves progress across chapters and refresh', async ({ page }) => {
    const { prevChapter, currentChapter } = await findChapterPair();
    const progressWrites: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/me/text-progress/')) progressWrites.push(request.method());
    });

    await page.goto(`/reader/${currentChapter.id}?mode=page&token=0&sp=0`);
    await expect(page.getByRole('button', { name: 'Bookmark this position' })).toBeEnabled();
    await page.getByRole('button', { name: 'Previous chapter', exact: true }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname === `/reader/${prevChapter.id}` && url.searchParams.get('sp') === '0');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Bookmark this position' })).toBeEnabled();
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await page.goto('/library');
    expect(progressWrites).toEqual([]);

    await page.goto(`/reader/${prevChapter.id}?mode=page&token=0`);
    await expect(page.getByRole('button', { name: 'Bookmark this position' })).toBeEnabled();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => progressWrites).toContain('PATCH');
    expect(progressWrites).toContain('POST');
  });

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
    const destinationPath = `/reader/${currentChapter.id}/__data.json`;
    const chapterRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === destinationPath) chapterRequests.push(request.url());
    });

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
    await expect.poll(() => chapterRequests.length).toBe(1);
    await nextButton.click();

    await page.waitForURL(
      (url) => url.pathname === `/reader/${currentChapter.id}`,
      { timeout: 10_000 },
    );
    await expect(page.locator('.pager-pages').first()).toBeVisible({ timeout: 10_000 });
    const end = await readPageState(page);
    expect(end.current).toBe(1);
    expect(chapterRequests).toHaveLength(1);
  });
});

test.describe('Page mode on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 740 }, hasTouch: true, isMobile: true });

  test('applies the saved mobile arrows setting before hydration', async ({ page }) => {
    const { prevChapter } = await findChapterPair();
    await page.goto(`/reader/${prevChapter.id}?mode=page`);
    await expect.poll(async () => (await readPageState(page)).total).toBeGreaterThan(1);
    const next = page.locator('.page-arrow-r');
    await expect(next).toBeVisible();
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page.getByRole('radiogroup', { name: 'Page arrows' }).getByLabel('Hide').check();
    await expect(next).toBeHidden();

    // Inspect the server-rendered page while the app's hydration scripts are unavailable.
    await page.route('**/*', (route) => route.request().resourceType() === 'script'
      ? route.abort()
      : route.continue());
    await page.reload();
    await expect(next).toBeAttached();
    await expect(next).toBeHidden();
    await page.setViewportSize({ width: 1024, height: 740 });
    await expect(next).toBeVisible();
  });

  test('remembers the same word after reflow, repeated reloads and reopening the book', async ({
    page,
  }) => {
    const { prevChapter } = await findChapterPair();
    const reader = `/reader/${prevChapter.id}`;
    await page.goto(`${reader}?mode=page&chapter=0&token=0`);
    await expect.poll(async () => (await readPageState(page)).total).toBeGreaterThan(3);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.pager-pages')).toHaveText(/^Page 2 of /);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.pager-pages')).toHaveText(/^Page 3 of /);
    const token = Number(new URL(page.url()).searchParams.get('token'));
    expect(token).toBeGreaterThan(0);

    const word = page.locator(`.reader-page-content [data-token-idx="${token}"]`).first();
    async function expectPassage() {
      await expect.poll(() => word.evaluate((el) => {
        const box = el.getClientRects()[0]!;
        const clip = el.closest('.reader-page-window')!.getBoundingClientRect();
        return box.left >= clip.left - 1 && box.left < clip.right &&
          box.top < clip.bottom && box.bottom > clip.top;
      })).toBe(true);
      await expect(page).toHaveURL(new RegExp(`[?&]token=${token}(?:&|$)`));
    }

    const original = await readPageState(page);
    // Wait for the new column layout before reloading the tab.
    await page.setViewportSize({ width: 390, height: 575 });
    await expect.poll(async () => (await readPageState(page)).total).not.toBe(original.total);
    await expectPassage();
    await page.reload();
    await expectPassage();
    await page.setViewportSize({ width: 390, height: 740 });
    await page.reload();
    await expectPassage();
    await expect(page.locator('.pager-pages')).toHaveText(/^Page 3 of /);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/me/text-progress/${prevChapter.id}`);
      return (await response.json()).progress?.lastTokenIdx;
    }).toBe(token);
    await page.goto(reader);
    await expectPassage();
  });

  test('keeps vertical drags still and preserves the passage through resize and chapter turns', async ({
    page,
  }) => {
    const { prevChapter, currentChapter } = await findChapterPair();
    await page.goto(`/reader/${prevChapter.id}?mode=page&chapter=0&token=0`);
    const pager = page.locator('.pager-pages');
    await expect.poll(async () => (await readPageState(page)).total).toBeGreaterThan(3);
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.context().newCDPSession(page);
    // Reserve space for a visible mobile address bar even when the large viewport is available.
    await cdp.send('Emulation.setSmallViewportHeightDifferenceOverride', { difference: 64 });
    await expect.poll(() => page.locator('.reader').evaluate((el) =>
      window.innerHeight - el.getBoundingClientRect().height,
    )).toBe(64);

    async function drag(dx: number, dy: number) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: 190, y: 360 }],
      });
      for (let step = 1; step <= 5; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: 190 + dx * step / 5, y: 360 + dy * step / 5 }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }

    await drag(-110, 4);
    await expect(pager).toHaveText(/^Page 2 of /);
    await expect(page.locator('.reader-page-wrap')).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'auto');
    await drag(0, -150);
    await drag(0, 150);
    await expect(pager).toHaveText(/^Page 2 of /);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await drag(110, -4);
    await expect(pager).toHaveText(/^Page 1 of /);

    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(pager).toHaveText(/^Page 4 of /);
    const token = new URL(page.url()).searchParams.get('token');
    expect(Number(token)).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 490 });
    await expect.poll(() => page.locator(`.reader-page-content [data-token-idx="${token}"]`).first()
      .evaluate((word) => {
        const rect = word.getClientRects()[0]!;
        const clip = word.closest('.reader-page-window')!.getBoundingClientRect();
        return rect.left >= clip.left - 1 && rect.left < clip.right;
      })).toBe(true);
    await page.setViewportSize({ width: 390, height: 740 });
    await expect(pager).toHaveText(/^Page 4 of /);

    await page.getByRole('button', { name: /Choose chapter/ }).tap();
    const savedChapter = page.waitForRequest((request) =>
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === `/api/v1/me/text-progress/${currentChapter.id}`,
    );
    await page.locator(`[role="menuitemradio"][href^="/reader/${currentChapter.id}?"]`).tap();
    await expect(page).toHaveURL(new RegExp(currentChapter.id));
    expect((await savedChapter).postDataJSON().chapterIdx).toBe(0);
    await expect(pager).toHaveText(/^Page 1 of /);
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(new RegExp(prevChapter.id));
    const last = await readPageState(page);
    expect(last.current).toBeGreaterThan(3);
    expect(last.current).toBe(last.total);
    await page.keyboard.press('ArrowLeft');
    await expect(pager).toHaveText(`Page ${last.total - 1} of ${last.total}`);
  });
});
