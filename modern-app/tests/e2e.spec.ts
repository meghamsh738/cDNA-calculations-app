import { test, expect } from '@playwright/test'

test('example cDNA calculation flow', async ({ page }) => {
  await page.goto('/')
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; } .signature { display: none !important; }' })

  const setupOverlay = page.getByTestId('setup-overlay')
  if (await setupOverlay.isVisible()) {
    await page.getByTestId('setup-finish').click()
    await expect(setupOverlay).toBeHidden()
  }

  await page.getByLabel('Use example').check()
  await page.getByTestId('calculate-btn').click()

  await page.waitForTimeout(500)
  await expect(page).toHaveScreenshot('example_run.png', { fullPage: true })
  await expect(page).toHaveScreenshot('plan_view.png', { fullPage: true })

  await page.getByRole('button', { name: 'Output table' }).click()
  await expect(page.getByRole('cell', { name: 'Sample1' }).first()).toBeVisible()
  await expect(page).toHaveScreenshot('output_tab.png', { fullPage: true })

  await page.getByRole('button', { name: 'Master mix' }).click()
  await expect(page).toHaveScreenshot('master_tab.png', { fullPage: true })

  await page.getByRole('button', { name: 'Notes & rules' }).click()
  await expect(page).toHaveScreenshot('notes_tab.png', { fullPage: true })
})
