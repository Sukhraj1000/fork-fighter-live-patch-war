import { expect, test } from '@playwright/test'

test('scores an endless run, reports performance, dies in one hit, and restarts', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('start-run')).toBeVisible()
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/live-matches') &&
      response.request().method() === 'POST',
  )
  await page.getByTestId('start-run').click()
  const matchId = (await (await createdResponse).json()).live.matchId as string

  await expect(page.getByTestId('activity-drafting').first()).toBeVisible()
  await expect(page.getByTestId('run-status')).toContainText('RUNNING')
  await expect(page.getByTestId('live-score')).not.toHaveText('0')
  await expect.poll(async () => {
    const response = await request.get(`/api/live-matches/${matchId}`)
    return (await response.json()).live.match.context.telemetry.primaryObjectiveProgress as number
  }).toBeGreaterThan(0)

  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByTestId('run-status')).toHaveText('GAME OVER')
  await expect(page.getByTestId('game-over')).toContainText('FINAL SCORE')
  await expect(page.getByTestId('game-over')).toContainText('PERSONAL BEST')
  await expect(page.getByTestId('game-over')).toContainText('KILLED BY: GREMLIN')

  await page.getByTestId('restart-run').click()
  await expect(page.getByTestId('run-status')).toContainText('RUNNING')
  await expect(page.getByTestId('game-over')).not.toBeVisible()
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

test('phone players can tap the arena through non-interactive HUD overlays', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  await page.goto('/')
  await page.getByTestId('start-run').click()
  const canvas = page.locator('.arena-canvas canvas')
  await canvas.waitFor()

  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true)
  await canvas.tap()
  await expect(page.getByTestId('run-status')).toContainText('RUNNING')
  await context.close()
})

test('keeps the deployed demo playable when the API route is absent', async ({
  page,
}) => {
  test.setTimeout(50_000)
  await page.route('**/api/live-matches', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'text/html',
      body: '<!doctype html><title>Not found</title>',
    })
  })
  await page.goto('/')
  await page.getByTestId('start-run').click()

  await expect(page.getByTestId('run-status')).toContainText('RUNNING')
  await expect(page.getByTestId('patch-card')).toHaveAttribute('data-status', 'active')
  await expect(page.getByTestId('patch-card')).toContainText('BUBBLE TROUBLE')
  await expect(page.getByText('LOCAL DEMO FALLBACK')).toBeVisible()
  await expect(page.getByTestId('patch-card')).toContainText('SKYLINE SHOVE', {
    timeout: 5_000,
  })
  await expect(page.getByTestId('game-over')).toBeVisible({ timeout: 30_000 })
})
