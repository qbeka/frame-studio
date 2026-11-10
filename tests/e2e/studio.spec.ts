import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { live, openFresh, readoutPosition, recordReversal, seekToFraction, STUDIO, STUDIO_HOME, stiffness, surfaceHeight } from './helpers';

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

test('shows a useful empty state with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await expect(page.getByText('Frame records what you do as named commands')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('records commands by name, with the ghost path of the interruption', async ({ page }) => {
  await recordReversal(page);
  await expect(page.locator('.marker')).toHaveCount(2);
  await expect(page.locator('.marker').nth(1)).toContainText('cancel');
  await expect(page.locator('.ribbon-ghost')).toHaveCount(1);
});

test('scrubbing gives a defined sample that matches the drawn component', async ({ page }) => {
  await recordReversal(page);
  for (const fraction of [0.1, 0.2, 0.33, 0.5, 0.8]) {
    await seekToFraction(page, fraction);
    await page.waitForTimeout(50);
    expect(Math.abs((await surfaceHeight(page)) - (await readoutPosition(page)))).toBeLessThan(0.5);
  }
});

test('the same sample twice gives the same drawing', async ({ page }) => {
  await recordReversal(page);
  await seekToFraction(page, 0.25);
  const first = await surfaceHeight(page);
  await seekToFraction(page, 0.9);
  await seekToFraction(page, 0.25);
  expect(await surfaceHeight(page)).toBe(first);
});

test('scrubbing restores typed content and the validation error', async ({ page }) => {
  await live(page).getByRole('button', { name: 'Edit expense' }).click();
  await page.waitForTimeout(700);
  await live(page).getByLabel('Merchant').fill('Harbour Cafe');
  await live(page).getByLabel('Amount').fill('oops');
  await live(page).getByRole('button', { name: 'Save' }).click();
  await expect(live(page).getByRole('alert')).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(live(page).getByRole('alert')).toBeVisible();
  await page.locator('.ribbon-slider').focus();
  await page.keyboard.press('Home');
  await expect(live(page).getByLabel('Merchant')).toHaveValue('Corner Bakery');
  await expect(live(page).getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(live(page).getByLabel('Merchant')).toHaveValue('Harbour Cafe');
  await expect(live(page).getByRole('alert')).toBeVisible();
});

test('a transition after a validation error replays from the grown layout', async ({ page }) => {
  await live(page).getByRole('button', { name: 'Edit expense' }).click();
  await page.waitForTimeout(700);
  await live(page).getByLabel('Amount').fill('oops');
  await live(page).getByRole('button', { name: 'Save' }).click();
  await expect(live(page).getByRole('alert')).toBeVisible();
  await page.waitForTimeout(100);
  const grown = await surfaceHeight(page);
  await live(page).getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // The first frame of the cancel, replayed, must start from the height with the error showing.
  const marker = page.locator('.marker').nth(1);
  await marker.focus();
  await page.keyboard.press('ArrowRight');
  expect(Math.abs((await surfaceHeight(page)) - grown)).toBeLessThan(0.5);
});

test('editing a spring reruns the same take and changes the component', async ({ page }) => {
  await recordReversal(page);
  await seekToFraction(page, 0.2);
  const before = await surfaceHeight(page);
  const events = await page.locator('.marker').count();
  await stiffness(page).fill('1200');
  await expect.poll(() => surfaceHeight(page)).not.toBe(before);
  await expect(page.locator('.marker')).toHaveCount(events);
});

test('dragging the interruption moves it, and the component follows', async ({ page }) => {
  await recordReversal(page);
  const marker = page.locator('.marker').nth(1);
  const box = (await marker.boundingBox())!;
  const atStart = await page.locator('.ribbon-path').getAttribute('d');
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.locator('.ribbon-path').getAttribute('d')).not.toBe(atStart);
  // The playhead sits on the marker, so the reading is the moment of the interruption.
  const reading = await readoutPosition(page);
  expect(Math.abs((await surfaceHeight(page)) - reading)).toBeLessThan(0.5);
});

test('keyboard moves a marker and steps the playhead', async ({ page }) => {
  await recordReversal(page);
  const slider = page.getByRole('slider', { name: 'Playhead' });
  await slider.focus();
  const start = await slider.getAttribute('aria-valuenow');
  await page.keyboard.press('PageUp');
  await expect(slider).not.toHaveAttribute('aria-valuenow', start!);
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '17');
  await expect(slider).toHaveAttribute('aria-valuetext', /17 milliseconds, state/);

  const marker = page.locator('.marker').nth(1);
  const label = await marker.getAttribute('aria-label');
  await marker.focus();
  await page.keyboard.press('ArrowRight');
  await expect(marker).not.toHaveAttribute('aria-label', label!);
});

test('injects a reversal at a precise time', async ({ page }) => {
  await recordReversal(page);
  await seekToFraction(page, 0.7);
  await page.getByLabel('Command to inject').selectOption('open');
  await page.getByRole('button', { name: 'Interrupt here' }).click();
  await expect(page.locator('.marker')).toHaveCount(3);
  // After the interruption the state changes, which is a real semantic change.
  await seekToFraction(page, 0.95);
  await expect(live(page).getByLabel('Merchant')).toBeVisible();
});

test('reports a command that cannot apply instead of hiding it', async ({ page }) => {
  await recordReversal(page);
  await seekToFraction(page, 0.7);
  await page.getByLabel('Command to inject').selectOption('done');
  await page.getByRole('button', { name: 'Interrupt here' }).click();
  await expect(page.locator('.marker[data-outcome=reject]')).toHaveCount(1);
});

test('continue from here keeps moving from the current value', async ({ page }) => {
  await recordReversal(page);
  await seekToFraction(page, 0.22);
  const held = await surfaceHeight(page);
  await page.getByRole('button', { name: 'Continue from here' }).click();
  await expect(page.locator('.mode')).toHaveText('Live');
  await page.waitForTimeout(1200);
  expect(await surfaceHeight(page)).not.toBe(held);
  // 22 percent is before the cancel, so the take ends in Editing and the form takes input again.
  await live(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(live(page).getByRole('button', { name: 'Edit expense' })).toBeVisible();
  // The old cancel was cut. The two markers are the original open and the new cancel.
  await expect(page.locator('.marker')).toHaveCount(2);
});

test('reset goes to a known endpoint', async ({ page }) => {
  await recordReversal(page);
  await page.getByLabel('Reset to state').selectOption('editing');
  await page.getByRole('button', { name: 'Reset to this state' }).click();
  await expect(page.locator('.mode')).toHaveText('Live');
  await expect(live(page).getByLabel('Merchant')).toBeVisible();
  await expect(page.getByText('Use the component by pressing its first control')).toBeVisible();
});

test('inspecting blocks input until you choose how to return', async ({ page }) => {
  await recordReversal(page);
  await expect(page.getByText('The component is paused here, so choose how to go back to it')).toBeVisible();
  await expect(page.locator('.stage-live')).toHaveAttribute('inert', '');
});

test('undo and redo restore the spec and the replay', async ({ page }) => {
  await recordReversal(page);
  await seekToFraction(page, 0.2);
  const before = await surfaceHeight(page);
  await stiffness(page).fill('1200');
  await expect.poll(() => surfaceHeight(page)).not.toBe(before);
  const edited = await surfaceHeight(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(stiffness(page)).toHaveValue('420');
  await expect.poll(() => surfaceHeight(page)).toBeCloseTo(before, 3);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(() => surfaceHeight(page)).toBeCloseTo(edited, 3);
});

test('a bad number is refused and leaves the project alone', async ({ page }) => {
  await recordReversal(page);
  await stiffness(page).fill('-4');
  await expect(page.getByText('Use 1 to 10000.')).toBeVisible();
  await page.getByLabel('Mass').first().click();
  await expect(stiffness(page)).toHaveValue('420');
});

test('recovers a draft after a reload, and can discard it', async ({ page }) => {
  await recordReversal(page);
  await stiffness(page).fill('777');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('Recovered your draft')).toBeVisible();
  await expect(stiffness(page)).toHaveValue('777');
  await expect(page.locator('.marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Discard it' }).click();
  await expect(stiffness(page)).toHaveValue('420');
  await expect(page.getByText('Use the component by pressing its first control')).toBeVisible();
});

test('a take with no recorded layout survives a reload', async ({ page }) => {
  // The example take has no recorded boxes, so restoring it has to measure.
  await page.getByRole('button', { name: /play an example/ }).click();
  await page.waitForTimeout(1200);
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('Recovered your draft')).toBeVisible();
  await expect(page.locator('.marker')).toHaveCount(2);
  await expect(page.locator('.mode')).toHaveText('Inspecting');
  await expect(live(page).getByText('Corner Bakery').first()).toBeVisible();
});

test('a damaged draft cannot block the app', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('frame.draft.frame.fixture.inspector', '{not json'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
});

test('saves a project file, then reopens it exactly', async ({ page }) => {
  await recordReversal(page);
  await stiffness(page).fill('640');
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save project' }).click()]);
  const path = await download.path();
  await expect(page.getByTestId('save-status')).toContainText('Saved');

  await openFresh(page);
  await page.getByTestId('open-file').setInputFiles({ name: 'p.frame.json', mimeType: 'application/json', buffer: readFileSync(path) });
  await expect(page.getByTestId('save-status')).toContainText('Opened p.frame.json');
  await expect(stiffness(page)).toHaveValue('640');
  await expect(page.locator('.marker')).toHaveCount(2);
  await expect(page.locator('.mode')).toHaveText('Inspecting');
});

test('a malformed file is refused with reasons and the project stays intact', async ({ page }) => {
  await recordReversal(page);
  await stiffness(page).fill('640');
  const open = (body: string) =>
    page.getByTestId('open-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(body) });

  await open('{"format":"frame.project","version":1');
  await expect(page.getByRole('alertdialog')).toContainText('not valid JSON');
  await expect(page.getByRole('alertdialog')).toContainText('Your current project has not changed');
  await page.getByRole('button', { name: 'Close' }).click();

  const project = JSON.parse(readFileSync('fixtures/inspector/inspector.frame.json', 'utf8'));
  project.spec.transitions[0].timing.delayMs = '300ms';
  project.spec.states.compact.targets.summary.rotate = 12;
  await open(JSON.stringify(project));
  await expect(page.getByRole('alertdialog')).toContainText('must be a number of milliseconds');
  await expect(page.getByRole('alertdialog')).toContainText('unsupported property');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(stiffness(page)).toHaveValue('640');
  await expect(page.locator('.marker')).toHaveCount(2);
});

test('a project for another component is refused', async ({ page }) => {
  const project = JSON.parse(readFileSync('fixtures/inspector/inspector.frame.json', 'utf8'));
  project.spec.component.id = 'someone.else';
  await page.getByTestId('open-file').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByRole('alertdialog')).toContainText('The file is for "someone.else"');
});

test('a state edit changes the pose used by the same take', async ({ page }) => {
  await recordReversal(page);
  await page.getByRole('button', { name: /^Editing$/ }).click();
  await page.getByLabel('Target', { exact: true }).selectOption('summary');
  await page.getByLabel('X offset').fill('40');
  await seekToFraction(page, 0.3);
  const transform = await live(page).locator('[data-frame-target=summary]').evaluate((e) => (e as HTMLElement).style.transform);
  expect(transform).toContain('translate');
  await expect(page.getByText('This target holds text, so Frame never scales it.')).toBeVisible();
});

test('an interruption rule changes the replayed outcome', async ({ page }) => {
  await recordReversal(page);
  await page.getByLabel('Do this').first().selectOption('ignore');
  // Cancel is now ignored, so at the end of the take the state stays Editing.
  await seekToFraction(page, 0.98);
  await expect(live(page).getByLabel('Merchant')).toBeVisible();
  await expect(page.locator('.marker[data-outcome=ignore]')).toHaveCount(1);
});

test('selecting from the state list and from the graph agree', async ({ page }) => {
  await page.getByRole('button', { name: /Editing to Confirmation/ }).click();
  await expect(page.locator('.properties h2').first()).toHaveText('Editing to Confirmation');
  await page.locator('[data-edge=cancel] .graph-hit').click({ force: true });
  await expect(page.locator('.properties h2').first()).toHaveText('Editing to Compact');
});

test('downloads a zip that holds a complete export', async ({ page }) => {
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toContainText('nothing from Frame');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download zip' }).click()]);
  expect(download.suggestedFilename()).toBe('frame-fixture-inspector-motion.zip');
  const dir = mkdtempSync(join(tmpdir(), 'frame-zip-'));
  const zip = join(dir, 'export.zip');
  writeFileSync(zip, readFileSync(await download.path()));
  execFileSync('unzip', ['-q', zip, '-d', dir]);
  const root = join(dir, 'frame-fixture-inspector-motion');
  expect(readFileSync(join(root, 'motion.config.ts'), 'utf8')).toContain('frame.fixture.inspector');
  expect(readFileSync(join(root, 'runtime/timeline.ts'), 'utf8')).toContain('sampleTimeline');
  expect(JSON.parse(readFileSync(join(root, 'frame-export.json'), 'utf8')).conversions).toHaveLength(5);
});

for (const width of [320, 390, 768, 1440]) {
  test(`has no sideways page scroll at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(STUDIO);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(live(page).getByRole('button', { name: 'Edit expense' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Transport' })).toBeVisible();
  });
}

test('works by touch width from open to inspected take', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(STUDIO);
  await recordReversal(page);
  await expect(page.locator('.ribbon')).toBeVisible();
  await expect(stiffness(page)).toBeVisible();
  await expect(page.locator('.graph')).toBeHidden();
});

test.describe('a first visit, with no draft and no request for an empty take', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(STUDIO_HOME);
    await expect(page.locator('.mode')).toHaveText('Inspecting');
  });

  test('opens on the example take, held at its interruption, with both paths drawn', async ({ page }) => {
    await expect(page.locator('.marker')).toHaveCount(2);
    await expect(page.locator('.marker').nth(1)).toContainText('cancel');
    await expect(page.locator('.ribbon-ghost')).toHaveCount(1);
    await expect(page.locator('.ribbon-tick').first()).toHaveText('0 ms');
    await expect(page.locator('.stage-live')).toHaveAttribute('inert', '');
    await expect(page.locator('.stage-label')).toContainText('frame.fixture.inspector');
    // 150 ms after the open, which is where the example's cancel lands, and mid flight.
    await expect(page.locator('.time')).toHaveText('210 ms');
    const reading = await readoutPosition(page);
    expect(Math.abs((await surfaceHeight(page)) - reading)).toBeLessThan(0.5);
    const rest = await page.locator('.stage-probe [data-frame-target=surface]').count();
    expect(rest).toBeGreaterThan(0);
    await expect(page.locator('.readout')).not.toContainText('not carried');
  });

  test('the example is not the visitor\'s work, so there is nothing to save, undo or recover', async ({ page }) => {
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.locator('.mode')).toHaveText('Inspecting');
    await expect(page.getByText('Recovered your draft')).toHaveCount(0);

    await page.getByRole('button', { name: 'Reset to this state' }).click();
    await expect(page.getByText('Use the component by pressing its first control')).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
    await live(page).getByRole('button', { name: 'Edit expense' }).click();
    await expect(live(page).getByLabel('Merchant')).toBeVisible();
  });

  test('an edit to the example becomes a draft, and the draft wins on the next visit', async ({ page }) => {
    await stiffness(page).fill('777');
    await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.getByText('Recovered your draft')).toBeVisible();
    await expect(stiffness(page)).toHaveValue('777');
    await expect(page.locator('.marker')).toHaveCount(2);
    await page.getByRole('button', { name: 'Discard it' }).click();
    await expect(stiffness(page)).toHaveValue('420');
  });

  test('the property rail draws the curve it is editing', async ({ page }) => {
    const preview = page.locator('.curve-preview-path').first();
    const quiet = await preview.getAttribute('d');
    await page.getByRole('button', { name: 'Lively' }).first().click();
    await expect(preview).not.toHaveAttribute('d', quiet!);
    await page.getByRole('button', { name: 'Timed' }).first().click();
    await expect(page.getByLabel('Duration').first()).toHaveValue('220');
    await expect(preview).not.toHaveAttribute('d', quiet!);
    await expect(page.locator('.section h3').first()).toHaveText('Curve');
  });
});
