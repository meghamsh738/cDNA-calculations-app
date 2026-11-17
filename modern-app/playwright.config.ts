import { defineConfig, devices } from '@playwright/test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const moduleRoot = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const runtime = require(path.join(moduleRoot, 'desktop', 'electron', 'next-runtime.cjs'))
const runtimeLayout = runtime.resolveRuntimeLayout({ projectRoot: moduleRoot })
process.env.PLAYWRIGHT_BROWSERS_PATH = runtime.assertNoSymlinkPathComponents(runtimeLayout.browserCachePath)
runtime.assertNoSymlinkPathComponents(runtimeLayout.browserTestOutputPath)

export default defineConfig({
  testDir: './tests',
  outputDir: runtimeLayout.browserTestOutputPath,
  timeout: 80_000,
  fullyParallel: true,
  expect: {
    // Self-hosted fonts may take a moment to be marked as "ready" in headless Chromium.
    // Increase expectation timeout to avoid flaky screenshot generation.
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' }
  },
  use: {
    baseURL: 'http://127.0.0.1:19511',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev:full',
    url: 'http://127.0.0.1:19511',
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
