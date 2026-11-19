import { expect, test } from '@playwright/test';

test('signed-in visitors land on their Library from the site root', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'Recent books' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
});

test('opens About from the desktop sidebar', async ({ page }) => {
  await page.goto('/dictionary');
  const sidebar = page.getByRole('navigation', { name: 'Sections' });
  await expect(sidebar.getByText('About Us', { exact: true })).toBeVisible();
  const about = sidebar.getByRole('link', { name: 'About', exact: true });
  await about.press('Enter');
  await expect(page).toHaveURL(/\/about$/);
  await expect(about).toHaveAttribute('aria-current', 'page');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Return to Library' })).toHaveCount(0);
  const header = await main.getByRole('heading', { name: 'About', level: 1 }).boundingBox();
  const attribution = await main.getByRole('paragraph').filter({ hasText: 'Wiktionary' }).boundingBox();
  expect(attribution).toMatchObject({ x: header!.x, width: header!.width });
});

test.describe('public Library on mobile', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });

  test('links to the dictionary attribution on About', async ({ page }) => {
    await page.goto('/library');
    const sources = page.getByRole('heading', { name: 'Where the data comes from' });
    await expect(sources).toHaveCount(0);
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    const about = navigation.getByRole('link', { name: 'About', exact: true });
    await about.press('Enter');
    await expect(page).toHaveURL(/\/about$/);
    await expect(about).toHaveAttribute('aria-current', 'page');
    await expect(sources).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wiktionary' }))
      .toHaveAttribute('href', 'https://en.wiktionary.org/wiki/Category:Hindi_language');
    await expect(page.getByRole('link', { name: /Creative Commons Attribution-ShareAlike/ }))
      .toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    await navigation.getByRole('link', { name: 'Library', exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/library$/);
  });

  test('opens the Official tab and supports switching languages by keyboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Official', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /Switch language/ }).press('Enter');
    await page.getByRole('menuitemradio', { name: /Marathi/ }).press('Enter');
    await expect(page.getByRole('button', { name: 'Switch language (currently Marathi)' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Switch language (currently Marathi)' })).toBeVisible();
  });
});
