import { test, expect } from '@playwright/test';

test('fictional manager previews and publishes an exactly reconciled invoice', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Historical HSB source events')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fictional billing walkthrough' })).toBeVisible();
  await page.getByLabel('Email').fill('manager@example.test');
  await page.getByLabel('Password').fill('fictional-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Manager draft')).toBeVisible();
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Existing fictional draft loaded.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Existing fictional draft loaded.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create draft' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('Read-only preview')).toBeVisible();
  await expect(page.getByText(/DEMO_A: 3000 mL.*total 400 paise/)).toBeVisible();
  await expect(page.getByText(/DEMO_B: 2000 mL.*total 300 paise/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published fictional statements.')).toBeVisible();
});
test('fictional resident sees only own statement', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('resident@example.test');
  await page.getByLabel('Password').fill('fictional-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('My statements')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh statements' }).click();
  await expect(page.getByText(/DEMO_A: 3000 mL; total 400 paise/)).toBeVisible();
  await expect(page.getByText(/DEMO_B: 2000 mL/)).toHaveCount(0);
});
