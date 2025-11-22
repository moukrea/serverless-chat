import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('should load application in single browser', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#messageInput');

    const title = await page.title();
    expect(title).toBe('P2P Mesh Chat');

    const hasInput = await page.locator('#messageInput').count();
    expect(hasInput).toBe(1);
  });

  test('should load application in two browser contexts', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await Promise.all([
      page1.goto('/', { waitUntil: 'domcontentloaded' }),
      page2.goto('/', { waitUntil: 'domcontentloaded' })
    ]);

    await Promise.all([
      page1.waitForSelector('#messageInput'),
      page2.waitForSelector('#messageInput')
    ]);

    const title1 = await page1.title();
    const title2 = await page2.title();

    expect(title1).toBe('P2P Mesh Chat');
    expect(title2).toBe('P2P Mesh Chat');

    await context1.close();
    await context2.close();
  });
});
