import { writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const url = 'https://aqualedger-demo.onrender.com';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks: string[] = [];
try {
  const page = await browser.newPage();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response || response.status() !== 200) throw new Error('Public site unavailable');
  await expect(page.getByRole('heading', { name: /Every reading has a history/ })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  checks.push('self-explaining hero and no sign-in barrier');
  await page.getByRole('link', { name: 'Inspect the event pipeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Watch the backend verify a water event.' })).toBeVisible();
  await page.getByLabel('Historical CSV line').fill('27');
  await page.getByRole('button', { name: /Inspect chosen row/ }).click();
  await expect(page.getByText('csv:0000027')).toBeVisible();
  await page.getByRole('button', { name: /Changed source key/ }).click();
  await expect(page.getByText('Changed-key conflict', { exact: true })).toBeVisible();
  checks.push('live public source adapter dry run and changed-key classification');
  await page.getByRole('link', { name: 'See the billing sample', exact: true }).click();
  await page.getByLabel('Usage-based charge in paise').fill('901');
  await page.getByLabel('Fixed charge in paise').fill('99');
  await page.getByRole('button', { name: /Recalculate bill/ }).click();
  await expect(page.getByText('₹5.91')).toBeVisible();
  await expect(page.getByText('₹4.09')).toBeVisible();
  checks.push('public fictional allocation and exact reconciliation');
  await page.getByRole('tab', { name: 'Resident view' }).click();
  await page.getByRole('button', { name: 'Flat B' }).click();
  await expect(page.getByText(/Flat B used 2.0 L/)).toBeVisible();
  checks.push('resident sample and explanation');
} finally { await browser.close(); }
const output = 'docs/data/public-demo-deployed-smoke.json';
writeFileSync(output, JSON.stringify({ observedAt: new Date().toISOString(), url, checks, scope: 'public read-only fictional walkthrough' }, null, 2) + '\n');
console.log(JSON.stringify({ output, checks: checks.length, allPassed: true }));
