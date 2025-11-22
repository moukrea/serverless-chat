import { test } from '@playwright/test';

test('detailed error check', async ({ page }) => {
  const errors = [];
  const warnings = [];

  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();

    console.log(`[BROWSER ${type.toUpperCase()}]`, text);

    if (type === 'error') errors.push(text);
    if (type === 'warning') warnings.push(text);
  });

  page.on('pageerror', error => {
    console.log('[PAGE ERROR]', error.message);
    console.log('Stack:', error.stack);
    errors.push(error.message);
  });

  await page.goto('/', { waitUntil: 'load', timeout: 30000 });

  await page.waitForTimeout(5000);

  const hasWindow = await page.evaluate(() => {
    return {
      mesh: typeof window.mesh,
      identity: typeof window.identity
    };
  });

  console.log('\nWindow globals:', hasWindow);
  console.log('\nTotal errors:', errors.length);
  console.log('\nTotal warnings:', warnings.length);
});
