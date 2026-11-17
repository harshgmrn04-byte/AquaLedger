import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: 'apps/web/e2e', workers: 1, use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', ...(existsSync('/Applications/Google Chrome.app') ? { channel: 'chrome' } : {}) },
  webServer: [
    { command: 'npm run dev --workspace=@water/web -- --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 30000, env: { VITE_API_URL: 'http://127.0.0.1:3001' } }
  ]
});
