import { writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { chromium, expect } from '@playwright/test';
import { z } from 'zod';

loadEnvFile('.env');
const env = z.object({
  DEMO_MANAGER_EMAIL: z.email(), DEMO_MANAGER_PASSWORD: z.string().min(12),
  DEMO_A_EMAIL: z.email(), DEMO_A_PASSWORD: z.string().min(12),
  DEMO_B_EMAIL: z.email(), DEMO_B_PASSWORD: z.string().min(12)
}).parse(process.env);
const url = 'https://aqualedger-demo.onrender.com';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks: { role: string; siteStatus: number; signInMs: number; expectedPanel: boolean; ownStatementOnly?: boolean; explanationVisible?: boolean }[] = [];
try {
  for (const [label, email, password, heading] of [
    ['manager', env.DEMO_MANAGER_EMAIL, env.DEMO_MANAGER_PASSWORD, 'Manager draft'],
    ['resident A', env.DEMO_A_EMAIL, env.DEMO_A_PASSWORD, 'My statements'],
    ['resident B', env.DEMO_B_EMAIL, env.DEMO_B_PASSWORD, 'My statements']
  ] as const) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!response || response.status() !== 200) throw new Error(`${label}: site unavailable`);
      await expect(page.getByRole('heading', { name: 'Fictional billing walkthrough' })).toBeVisible();
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      const started = performance.now();
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 20000 });
      const entry: typeof checks[number] = { role: label, siteStatus: response.status(), signInMs: Math.round(performance.now() - started), expectedPanel: true };
      if (label === 'manager') {
        await expect(page.getByText('Published fictional statements.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Create revision draft' })).toBeVisible();
      } else {
        const article = page.locator('article');
        await expect(article).toHaveCount(1);
        await expect(article.getByText(label === 'resident A' ? /DEMO_A: 3000 mL/ : /DEMO_B: 2000 mL/)).toBeVisible();
        if ((await article.innerText()).includes(label === 'resident A' ? 'DEMO_B:' : 'DEMO_A:')) throw new Error(`${label}: cross-flat statement visible`);
        entry.ownStatementOnly = true;
        if (label === 'resident A') {
          await page.getByRole('button', { name: 'Explain fictional bill' }).click();
          await expect(article.getByText(/Source: validated cached explanation|Source: validated Groq selection|Source: deterministic explanation/)).toBeVisible({ timeout: 20000 });
          entry.explanationVisible = true;
        }
      }
      checks.push(entry);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const output = 'docs/data/stage4-deployed-web-smoke.json';
writeFileSync(output, JSON.stringify({ observedAt: new Date().toISOString(), url, checks, scope: 'fictional Auth accounts and deployed React UI' }, null, 2) + '\n');
console.log(JSON.stringify({ output, roleCount: checks.length, allPassed: true }));
