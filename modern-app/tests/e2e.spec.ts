import { test, expect } from '@playwright/test'
import { promises as fs } from 'fs'

test('example cDNA calculation flow', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Use Example').check()
  await page.getByTestId('calculate-btn').click()

  await expect(page.getByText('Master mix totals')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Sample1' })).toBeVisible()

  await fs.mkdir('screenshots', { recursive: true })
  await page.screenshot({ path: 'screenshots/example_run.png', fullPage: true })
})
