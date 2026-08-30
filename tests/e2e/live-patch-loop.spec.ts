import { expect, test } from '@playwright/test'

test('plays through drafting, rejection, live mutation, expiry, and extraction', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('start-run')).toBeVisible()
  await page.getByTestId('start-run').click()

  await expect(page.getByTestId('activity-drafting')).toContainText('AGENTS DRAFTING')
  await expect(page.getByTestId('run-status')).toContainText('PATCH WINDOW')
  await expect(page.getByTestId('activity-rejected').first()).toContainText(
    'PATCH REJECTED',
  )
  await expect(page.getByTestId('activity-selected').first()).toContainText(
    'PATCH SELECTED',
  )
  await expect(page.getByTestId('patch-card')).toHaveAttribute('data-status', 'active')

  await page.keyboard.down('ArrowRight')
  await expect(page.getByText('MUTATION TRIGGERED').first()).toBeVisible()
  await page.keyboard.up('ArrowRight')

  await expect(page.getByTestId('activity-expired').first()).toContainText(
    'PATCH EXPIRED',
  )

  await page.keyboard.down('ArrowRight')
  await expect(page.getByTestId('run-status')).toHaveText('EXTRACTED', {
    timeout: 12_000,
  })
  await page.keyboard.up('ArrowRight')
  await expect(page.getByText('RUN EXTRACTED')).toBeVisible()
})

test('proposal work leaves the live game responsive', async ({ request }) => {
  const created = await request.post('/api/live-matches')
  expect(created.status()).toBe(201)
  const matchId = (await created.json()).live.matchId as string

  const before = await request.get(`/api/live-matches/${matchId}`)
  const beforeTick = (await before.json()).live.game.tick as number
  await new Promise((resolve) => setTimeout(resolve, 400))
  const after = await request.get(`/api/live-matches/${matchId}`)
  const afterTick = (await after.json()).live.game.tick as number

  expect(afterTick).toBeGreaterThan(beforeTick)
})
