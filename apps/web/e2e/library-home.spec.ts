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
  const sidebar = page.getByRole('navigation', { name: 'Primary navigation' });
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

test('keeps the account and language controls inside the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/library');
  const opener = page.getByRole('button', { name: 'Open navigation' });
  const title = page.getByRole('banner').getByRole('heading', { level: 1, name: 'Library' });
  await expect(title).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const buttonBox = (await opener.boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  expect(titleBox.x).toBeGreaterThanOrEqual(buttonBox.x + buttonBox.width);
  expect(Math.abs(titleBox.y + titleBox.height / 2 - buttonBox.y - buttonBox.height / 2)).toBeLessThan(1);
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await expect(signOut).toBeHidden();
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer.getByRole('button', { name: /Switch language/ })
    .or(drawer.getByRole('link', { name: 'Add a language' }))).toBeVisible();
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  await expect(signOut.locator('..')).toHaveAttribute('action', '/logout');
  await drawer.getByRole('button', { name: 'Dismiss navigation' }).click();
  await expect(opener).toBeFocused();
});

test('keeps a subpage title and its return link together in the mobile bar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/library/all');
  const bar = page.getByRole('banner');
  await expect(bar.getByRole('heading', { name: 'All books', level: 1 })).toBeVisible();
  await bar.getByRole('link', { name: 'Close all books and return to Library' }).press('Enter');
  await expect(bar.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test.describe('signed-in mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('can leave the dictionary for Upload and keep switching pages', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/dictionary/hi');
    const bar = page.getByRole('banner');
    const title = bar.getByRole('heading', { level: 1 });
    await expect(title).toContainText('Hindi Dictionary');
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    for (const name of ['Upload', 'Words', 'Library']) {
      await bar.getByRole('button', { name: 'Open navigation' }).tap();
      await drawer.getByRole('link', { name, exact: true }).tap();
      await expect(page).toHaveURL(new RegExp('/' + name.toLowerCase() + '$'));
      await expect(drawer).toBeHidden();
      await expect(title).toContainText(name);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      if (name === 'Upload') await expect(page.getByRole('button', { name: 'Upload text' })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe('public Library on mobile', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });

  test('keeps the title beside the hamburger throughout a mobile refresh', async ({ page }) => {
    await page.goto('/dictionary/hi');
    const bar = page.getByRole('banner');
    const menu = bar.getByRole('button', { name: 'Open navigation' });
    const heading = bar.getByRole('heading', { level: 1, name: /Hindi Dictionary/ });
    await expect(menu).toBeEnabled();

    let resume!: () => void;
    const scriptsPaused = new Promise<void>(resolve => { resume = resolve; });
    await page.route('**/*', async route => {
      if (route.request().resourceType() === 'script') await scriptsPaused;
      await route.continue();
    });
    try {
      await page.reload({ waitUntil: 'commit' });
      await expect(menu).toBeDisabled();
      await expect(heading).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const before = (await heading.boundingBox())!;
      const button = (await menu.boundingBox())!;
      expect(before.x).toBeGreaterThanOrEqual(button.x + button.width);
      expect(Math.abs(before.y + before.height / 2 - button.y - button.height / 2)).toBeLessThan(1);

      resume();
      await expect(menu).toBeEnabled();
      expect(await heading.boundingBox()).toEqual(before);
    } finally {
      resume();
    }
  });

  test('moves multilingual headings between the mobile bar and desktop content', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/dictionary/hi');
    const title = page.getByRole('heading', { level: 1 });
    await expect(page.getByRole('banner').locator('h1 bdi[lang="hi"]')).toBeVisible();
    await expect(title).toHaveCount(1);
    await expect(title).toContainText('Hindi Dictionary');
    const box = (await title.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await page.setViewportSize({ width: 1024, height: 700 });
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(title).toHaveCount(1);
  });

  test('keeps the selected label and icon readable in every theme', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const active = page.getByRole('navigation').getByRole('link', { name: 'About', exact: true });
    for (const theme of ['light', 'sepia', 'dark']) {
      const contrast = await active.evaluate((link, theme) => {
        document.documentElement.dataset.theme = theme;
        const { color, backgroundColor } = getComputedStyle(link);
        function luminance(rgb: string) {
          const [r, g, b] = rgb.match(/\d+/g)!.map(Number).map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        const fg = luminance(color);
        const bg = luminance(backgroundColor);
        return {
          ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
          iconMatchesLabel: getComputedStyle(link.querySelector('path')!).stroke === color,
        };
      }, theme);
      expect(contrast.ratio, theme).toBeGreaterThanOrEqual(4.5);
      expect(contrast.iconMatchesLabel, theme).toBe(true);
    }
    await page.setViewportSize({ width: 960, height: 720 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(active).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(active).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeEnabled();
  });

  test('links to the dictionary attribution on About', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('cia_reader_immersive', '1'));
    await page.goto('/library');
    const sources = page.getByRole('heading', { name: 'Where the data comes from' });
    await expect(sources).toHaveCount(0);
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await expect(menu).toBeEnabled();
    await menu.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    const navigation = drawer.getByRole('navigation', { name: 'Primary navigation' });
    const about = navigation.getByRole('link', { name: 'About', exact: true });
    await about.press('Enter');
    await expect(page).toHaveURL(/\/about$/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('banner').getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
    await expect(sources).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wiktionary' }))
      .toHaveAttribute('href', 'https://en.wiktionary.org/wiki/Category:Hindi_language');
    await expect(page.getByRole('link', { name: /Creative Commons Attribution-ShareAlike/ }))
      .toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    await menu.press('Enter');
    await expect(about).toHaveAttribute('aria-current', 'page');
    await navigation.getByRole('link', { name: 'Library', exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/library$/);
  });

  test('opens the Official tab and supports switching languages by keyboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Official', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await menu.press('Enter');
    const language = page.getByRole('button', { name: /Switch language/ });
    await language.press('Enter');
    await page.keyboard.press('Escape');
    await expect(language).toBeFocused();
    await expect(language).toHaveAttribute('aria-expanded', 'false');
    await language.press('Enter');
    await page.getByRole('menuitemradio', { name: /Marathi/ }).press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.reload();
    await expect(menu).toBeEnabled();
    await menu.press('Enter');
    await expect(page.getByRole('button', { name: 'Switch language (currently Marathi)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
  });
});
