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

test('cDNA sample grid accepts TSV paste and calculates custom rows', async ({ page }) => {
  await page.goto('/')
  await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; } .signature { display: none !important; }' })

  const setupOverlay = page.getByTestId('setup-overlay')
  if (await setupOverlay.isVisible()) {
    await page.getByTestId('setup-finish').click()
    await expect(setupOverlay).toBeHidden()
  }

  await page.getByLabel('Use example').uncheck()
  await page.getByRole('button', { name: 'Clear' }).click()

  const sampleBlock = [
    'Custom1\t120',
    'Custom2\t8'
  ].join('\n')

  await page.getByTestId('samples-grid-cell-0-0').evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, sampleBlock)

  await expect(page.getByText('Detected: 2 samples')).toBeVisible()
  await page.getByTestId('calculate-btn').click()
  await page.getByRole('button', { name: 'Output table' }).click()

  const editor = page.locator('section.editor')
  await expect(editor.getByRole('cell', { name: 'Custom1' })).toBeVisible()
  await expect(editor.getByRole('cell', { name: 'Custom2' })).toBeVisible()
  await expect(editor.getByRole('cell', { name: /MASTER MIX/ })).toBeVisible()
})
