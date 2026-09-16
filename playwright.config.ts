import { defineConfig } from '@playwright/test';

/**
 * The game in a real browser, headless, on the machine's own GPU: see smoke/.
 * Chromium's new headless mode (the `chromium` channel) has WebGPU on the real
 * adapter; the older headless shell has none, or only a software one.
 */
const PORT = 5195;

export default defineConfig({
  testDir: 'smoke',
  outputDir: 'test-results',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // the pictures the look tests are held to, kept by name in smoke/screens; they are this machine's GPU
  snapshotPathTemplate: 'smoke/screens/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    channel: 'chromium',
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
