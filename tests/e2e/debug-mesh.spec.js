import { test, expect } from '@playwright/test';

test('debug mesh initialization', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#messageInput');

  // Wait a bit for JS to load
  await page.waitForTimeout(3000);

  const debug = await page.evaluate(() => {
    return {
      hasMesh: typeof window.mesh !== 'undefined',
      hasIdentity: typeof window.identity !== 'undefined',
      meshKeys: window.mesh ? Object.keys(window.mesh) : [],
      globalKeys: Object.keys(window).filter(k => k.includes('mesh') || k.includes('peer') || k.includes('identity'))
    };
  });

  console.log('Debug info:', JSON.stringify(debug, null, 2));
});
