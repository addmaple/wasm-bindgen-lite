import { test, expect } from '@playwright/test'

test('wasm loads in main thread and worker', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Check main thread output
  const mainStatus = page.locator('#status')
  await expect(mainStatus).toContainText('Input: 4, 5, 6 → Output: 8, 10, 12')

  // Check worker thread output
  const workerStatus = page.locator('#worker-status')
  await expect(workerStatus).toContainText('Output from worker: 20, 40, 60')
})
