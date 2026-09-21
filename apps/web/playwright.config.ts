import { defineConfig, devices } from '@playwright/test';

const liveE2E = process.env.LIVE_E2E === '1';
const webUrl = liveE2E ? 'http://localhost:5173' : 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'test-results/results.json' }]]
    : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  expect: {
    // ชุด live คุยกับฐานข้อมูลจริงข้ามเครือข่าย และหน้าจอรีเฟรชด้วย invalidateQueries หลังทุก
    // mutation จังหวะ 5 วินาทีเริ่มต้นจึงสั้นเกินไปบน CI (เจอจริงสามจุดใน Staging Live E2E
    // 2026-09-21) ส่วนชุดที่รันกับ build นิ่ง ๆ ยังคุมด้วยค่าเดิมเพื่อจับ UI ที่ช้าผิดปกติ
    timeout: liveE2E ? 20_000 : 5_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.03,
      scale: 'css',
    },
  },
  use: {
    baseURL: webUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/quality-gates.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'quality-390',
      testMatch: '**/quality-gates.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'quality-768',
      testMatch: '**/quality-gates.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'quality-1440',
      testMatch: '**/quality-gates.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'webkit',
      testMatch: '**/quality-gates.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: liveE2E
    ? [
      { command: 'npm run dev -- --host 127.0.0.1', url: webUrl, reuseExistingServer: true },
      { command: 'npm --prefix ../api run dev:e2e', url: 'http://localhost:8787/api/v1/health', reuseExistingServer: true },
    ]
    : { command: 'npm run preview', url: webUrl, reuseExistingServer: !process.env.CI },
});
