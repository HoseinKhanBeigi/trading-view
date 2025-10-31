import { test, expect } from '@playwright/test';

test('place buy order updates balances and shows toast', async ({ page }) => {
  await page.goto('/btcusdt');

  // Wait for chart data to load and Order Ticket to appear
  await expect(page.getByRole('heading', { name: 'Order Ticket' })).toBeVisible();

  // Read current balances from header text
  const header = page.locator('header:has-text("Order Ticket")');
  const beforeText = await header.textContent();
  expect(beforeText).toBeTruthy();

  // Fill Buy box (first form card). Labels are spans, so target inputs directly.
  const buyCard = page.locator('h4:text("Buy")').first().locator('..');
  const buyContainer = buyCard.locator('..');
  await buyContainer.locator('input').first().fill('0.02'); // quantity
  // Leave price empty (auto)

  // Place Buy
  await buyContainer.getByRole('button', { name: 'Buy' }).click();

  // Toast appears
  await expect(page.getByText(/Order placed successfully/i)).toBeVisible();

  // Balances updated in header (USD down, BTC up)
  const afterText = await header.textContent();
  expect(afterText).toBeTruthy();
  expect(afterText).not.toEqual(beforeText);
});


