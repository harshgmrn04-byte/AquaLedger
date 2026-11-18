import { test, expect } from '@playwright/test';

test('recruiter can understand and use the public walkthrough without signing in', async ({ page }) => {
  await page.route('**/api/v1/source-events/summary', route => route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'source-test-request' }, body: JSON.stringify({ status: 'available', eventCount: '1000', apartmentCount: '16', datasetVersion: '1.1.0' }) }));
  await page.route('**/api/v1/demo/event-check**', route => {
    const query = new URL(route.request().url()).searchParams;
    const changed = query.get('scenario') === 'changed';
    const line = Number(query.get('line') ?? '2');
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'test-request-id' }, body: JSON.stringify({
      provenance: changed ? 'injected_change_to_published_row' : 'published_hsb_sample', mode: 'stateless_dry_run',
      source: { csvLine: line, sourceRowKey: 'csv:' + String(line).padStart(7, '0') }, normalized: { sensorId: 'S0101', apartment: 'APT_005', timestamp: '2019-12-31T00:00:00.000Z', volumeMl: '10000', channel: 'cold' },
      checks: { sensorMapping: 'pass', utcTimestamp: 'pass', positiveVolume: 'pass', pinnedArchiveHash: changed ? 'fail' : 'pass' },
      comparison: { priorState: changed ? 'pinned_row_assumed_present' : 'no_prior_row_assumed', priorHashPrefix: changed ? 'abcdef123456' : null, incomingHashPrefix: '123456abcdef' },
      outcome: changed ? 'conflict' : 'accepted', reasonCode: changed ? 'changed_source_row_key' : 'new_verified_row'
    }) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Every reading has a history/ })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await page.getByRole('link', { name: 'Inspect the event pipeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Watch the backend verify a water event.' })).toBeVisible();
  await page.getByLabel('Historical CSV line').fill('27');
  await page.getByRole('button', { name: /Inspect chosen row/ }).click();
  await expect(page.getByText('csv:0000027')).toBeVisible();
  await page.getByRole('button', { name: /Changed source key/ }).click();
  await expect(page.getByText('Changed-key conflict', { exact: true })).toBeVisible();
  await expect(page.getByText('FAIL', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'See the billing sample', exact: true }).click();
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
  await expect(page.getByText(/Live PostgreSQL summary/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Open database-backed API JSON/ })).toBeVisible();
});

test('public sample remains usable while the API is unavailable', async ({ page }) => {
  await page.route('**/api/v1/demo/preview**', route => route.abort());
  await page.route('**/api/v1/demo/event-check**', route => route.abort());
  await page.goto('/');
  await expect(page.getByText('The API could not answer right now.')).toBeVisible();
  await page.getByLabel('Usage-based charge in paise').fill('901');
  await page.getByLabel('Fixed charge in paise').fill('99');
  await page.getByRole('button', { name: /Recalculate bill/ }).click();
  await expect(page.getByText('₹5.91')).toBeVisible();
  await expect(page.getByText(/Calculated in your browser while the API is unavailable/)).toBeVisible();
});
