import { expect, type Page } from '@playwright/test';

/**
 * The studio opens on its example take. These suites record their own, so they ask for an empty
 * one. STUDIO_URL points them at a studio served somewhere else.
 */
export const STUDIO_HOME = process.env.STUDIO_URL ?? 'http://localhost:5172/';
export const STUDIO = `${STUDIO_HOME}?take=none`;

export const live = (page: Page) => page.locator('.stage-live');
export const surface = (page: Page) => live(page).locator('[data-frame-target=surface]');
export const surfaceHeight = (page: Page) => surface(page).evaluate((el) => el.getBoundingClientRect().height);

/** The transition's own stiffness. The authored fixture also has a rule with its own curve. */
export const stiffness = (page: Page) => page.getByLabel('Stiffness').first();

/** Reads the position in the transport, in the units shown. */
export async function readoutPosition(page: Page) {
  const text = await page.locator('.readout div').first().locator('dd').textContent();
  return Number.parseFloat(text!);
}

/** Starts clean: no draft, no take. */
export async function openFresh(page: Page) {
  await page.goto(STUDIO);
  await page.evaluate(() => localStorage.clear());
  await page.goto(STUDIO);
  await expect(page.getByText('Use the component.')).toBeVisible();
}

/** Opens the inspector and cancels partway through, using the real UI. */
export async function recordReversal(page: Page, cancelAfterMs = 120) {
  await live(page).getByRole('button', { name: 'Edit expense' }).click();
  await page.waitForTimeout(cancelAfterMs);
  await live(page).getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.mode')).toHaveText('Inspecting');
}

export async function seekToFraction(page: Page, fraction: number) {
  const box = (await page.locator('.ribbon-svg').boundingBox())!;
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}
