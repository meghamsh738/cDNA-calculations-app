import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 80_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:5176',
    trace: 'on-first-retry'
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
      use: { ...devices['Desktop Chromium'] }
    }
  ]
})
