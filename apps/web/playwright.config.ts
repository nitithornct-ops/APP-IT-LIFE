import { defineConfig, devices } from '@playwright/test';

const liveE2E = process.env.LIVE_E2E === '1';
const webUrl = liveE2E ? 'http://localhost:5173' : 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: webUrl,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: liveE2E
    ? [
      { command: 'npm run dev -- --host 127.0.0.1', url: webUrl, reuseExistingServer: true },
      { command: 'npm --prefix ../api run dev', url: 'http://localhost:8787/api/v1/health', reuseExistingServer: true },
    ]
    : { command: 'npm run preview', url: webUrl, reuseExistingServer: !process.env.CI },
});
