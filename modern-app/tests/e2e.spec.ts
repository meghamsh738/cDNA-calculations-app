import { test, expect } from '@playwright/test'
import { promises as fs } from 'fs'

test('example cDNA calculation flow', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Use example').check()
  await page.getByTestId('calculate-btn').click()

  await fs.mkdir('screenshots', { recursive: true })
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'screenshots/example_run.png', fullPage: true })
  await page.screenshot({ path: 'screenshots/plan_view.png', fullPage: true })
  await page.screenshot({ path: 'screenshots/plan_tab.png', fullPage: true })

  await page.getByRole('button', { name: 'Output table' }).click()
  await expect(page.getByRole('cell', { name: 'Sample1' }).first()).toBeVisible()
  await page.screenshot({ path: 'screenshots/output_tab.png', fullPage: true })

  await page.getByRole('button', { name: 'Master mix' }).click()
  await page.screenshot({ path: 'screenshots/master_tab.png', fullPage: true })

  await page.getByRole('button', { name: 'Notes & rules' }).click()
  await page.screenshot({ path: 'screenshots/notes_tab.png', fullPage: true })
})
