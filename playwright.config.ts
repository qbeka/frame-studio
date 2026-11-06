import { defineConfig } from '@playwright/test';

const STUDIO_PORT = 5172;
const CONSUMER_PORT = 5182;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '.artifacts/playwright',
  use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  webServer: [
    {
      command: 'pnpm dev',
      port: STUDIO_PORT,
      reuseExistingServer: true,
    },
    {
      command: `node scripts/consumer.mjs vite --out .artifacts/consumer-vite --serve ${CONSUMER_PORT}`,
      port: CONSUMER_PORT,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
