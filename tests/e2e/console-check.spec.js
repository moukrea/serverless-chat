import { test, expect } from '@playwright/test';

test('check console errors and page load', async ({ page }) => {
  const errors = [];
  const logs = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', error => {
    errors.push(error.message);
  });

  await page.goto('/', { waitUntil: 'networkidle', timeout: 30000 });

  console.log('\n=== All console output ===');
  logs.forEach(log => console.log(log));

  console.log('\n=== Errors ===');
  errors.forEach(err => console.log(err));

  console.log('\n=== Page content check ===');
  const html = await page.content();
  console.log('HTML length:', html.length);
  console.log('Has script tags:', html.includes('<script'));
  console.log('Has CSS:', html.includes('stylesheet') || html.includes('<style'));

  const title = await page.title();
  console.log('Title:', title);

  const hasInput = await page.locator('#messageInput').count();
  console.log('Has message input:', hasInput);
});
