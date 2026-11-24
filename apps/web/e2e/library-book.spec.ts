import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('a chapter book has one linked cover title and can be renamed with the keyboard', async ({
  page, request,
}) => {
  const title = `Library test ${randomUUID()}`;
  const created = await request.post('/api/v1/collections', {
    data: { title, language: 'hi', kind: 'chapter_book' },
  });
  await expect(created).toBeOK();
  const { collection } = await created.json();
  const path = `/collections/${collection.id}`;
  try {
    await page.goto('/library', { waitUntil: 'networkidle' });
    const card = page.locator('.lib-card-wrap').filter({ has: page.locator(`a[href="${path}"]`) });
    await expect(card.getByText(title, { exact: true })).toHaveCount(1);
    const cover = card.locator('.lib-cover');
    const link = cover.getByRole('link', { name: title });
    const menu = cover.getByRole('button', { name: `Actions for ${title}` });
    const progress = cover.getByRole('progressbar', { name: 'Reading progress' });
    await expect(link).toBeVisible();
    await expect(progress).toHaveText('0% read');
    await expect(progress).toHaveAttribute('aria-valuenow', '0');
    const label = link.locator('.title-text');
    await expect(label).toHaveCSS('text-overflow', 'ellipsis');
    expect(await label.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const [coverBox, titleBox, menuBox, barBox] = await Promise.all(
      [cover, link, menu, progress].map(el => el.boundingBox()),
    );
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(menuBox!.x);
    expect(Math.abs(titleBox!.y + titleBox!.height / 2 - menuBox!.y - menuBox!.height / 2)).toBeLessThan(1);
    expect(barBox!.y).toBeGreaterThanOrEqual(menuBox!.y + menuBox!.height);
    expect(barBox!.width).toBeCloseTo(coverBox!.width);
    await expect(card).not.toContainText(/chapter[ _]book|\d+ chapters?\b/i);

    await card.getByRole('button', { name: `Actions for ${title}` }).press('Enter');
    await card.getByRole('button', { name: 'Rename', exact: true }).press('Enter');
    const input = page.getByRole('textbox', { name: 'Book title' });
    await expect(input).toBeFocused();
    const newTitle = `नया नाम ${collection.id}`;
    await input.fill(newTitle);
    await input.press('Enter');
    await expect(card.getByRole('link', { name: newTitle })).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await card.getByRole('link', { name: newTitle }).press('Enter');
    await expect(page.getByRole('heading', { name: newTitle, exact: true })).toBeVisible();
    await expect(page.locator('.cd-meta')).not.toContainText(/chapter[ _]book/i);

    await page.getByRole('button', { name: `Actions for ${newTitle}` }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await input.fill('Discard this edit');
    await input.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: newTitle, exact: true })).toBeVisible();
  } finally {
    await expect(await request.delete(`/api/v1/collections/${collection.id}`)).toBeOK();
  }
});
