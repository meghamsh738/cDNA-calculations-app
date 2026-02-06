import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 80_000,
  fullyParallel: true,
  expect: {
    // Self-hosted fonts may take a moment to be marked as "ready" in headless Chromium.
    // Increase expectation timeout to avoid flaky screenshot generation.
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' }
  },
  use: {
    baseURL: 'http://localhost:5176',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev:front -- --port 5176',
    url: 'http://localhost:5176',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chromium'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        reducedMotion: 'reduce'
      }
    }
  ]
})
