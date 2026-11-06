import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, use: { baseURL: 'http://127.0.0.1:4193', headless: true, launchOptions: { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] } },
  webServer: { command: 'node scripts/dev.mjs', url: 'http://127.0.0.1:4193', reuseExistingServer: false, env: { PORT: '4193', ADMIN_PASSWORD: 'browser-test-only-password', ADMIN_SESSION_SECRET: 'browser-test-only-session-secret-over-32-characters', BLOB_READ_WRITE_TOKEN: '', VERCEL: '' } }
});
