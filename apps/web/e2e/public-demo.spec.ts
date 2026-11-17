import { test, expect } from '@playwright/test';

test('recruiter can understand and use the public walkthrough without signing in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Every reading has a history/ })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await page.getByRole('link', { name: 'Explore the sample bill', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Explore a sample bill.' })).toBeVisible();
  await page.getByLabel('Usage-based charge in paise').fill('901');
  await page.getByLabel('Fixed charge in paise').fill('99');
  await page.getByRole('button', { name: /Recalculate bill/ }).click();
  await expect(page.getByText('₹10.00').first()).toBeVisible();
  await expect(page.getByText('₹5.91')).toBeVisible();
  await expect(page.getByText('₹4.09')).toBeVisible();
  await page.getByRole('tab', { name: 'Resident view' }).click();
  await page.getByRole('button', { name: 'Flat B' }).click();
  await expect(page.getByText(/Flat B used 2.0 L/)).toBeVisible();
  await expect(page.getByText(/Exact reconciliation/)).toBeVisible();
});

test('public sample remains usable while the API is unavailable', async ({ page }) => {
  await page.route('**/api/v1/demo/preview**', route => route.abort());
  await page.goto('/');
  await page.getByLabel('Usage-based charge in paise').fill('901');
  await page.getByLabel('Fixed charge in paise').fill('99');
  await page.getByRole('button', { name: /Recalculate bill/ }).click();
  await expect(page.getByText('₹5.91')).toBeVisible();
  await expect(page.getByText(/Calculated in your browser while the API is unavailable/)).toBeVisible();
});
