// Peak details dialog (TASK-003) in a real browser.
import { test, expect } from '@playwright/test';
import { peaks, openFreshApp, card, regionCount } from './helpers.js';

const peakA = peaks[0];
const peakB = peaks[10];

test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
});

const dialog = page => page.locator('#peak-details');
const detailsButton = (page, peak) => page.getByRole('button', { name: `View details for ${peak.name}` });

async function openWithKeyboard(page, peak) {
    await detailsButton(page, peak).focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
}

test('opens from the keyboard as a modal and moves focus into it', async ({ page }) => {
    await openWithKeyboard(page, peakA);
    expect(await dialog(page).evaluate(d => d.matches(':modal'))).toBe(true);
    await expect(dialog(page).locator('.details-close-button')).toBeFocused();
});

test('shows number, name, region, height and status, and no grid reference when there is none', async ({ page }) => {
    await openWithKeyboard(page, peakA);
    const details = dialog(page);
    await expect(details).toContainText(`#${peakA.number}`);
    await expect(details).toContainText(peakA.name);
    await expect(details).toContainText(peakA.region);
    await expect(details).toContainText(`${peakA.heightM}m`);
    await expect(details).toContainText('Not climbed');
    await expect(details).not.toContainText(/grid ref/i);
    await expect(page.getByRole('dialog', { name: peakA.name })).toBeVisible();
});

test('keeps Tab and Shift+Tab focus inside the dialog', async ({ page }) => {
    await openWithKeyboard(page, peakA);
    const seen = new Set();
    for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 6; i++) {
            await page.keyboard.press(key);
            const where = await page.evaluate(() => {
                const ae = document.activeElement;
                const d = document.getElementById('peak-details');
                return { inDialog: d.contains(ae), isBody: ae === document.body, className: ae?.className ?? '' };
            });
            // Leaving the page for browser UI is fine; reaching page content is not.
            expect(where.inDialog || where.isBody, `focus escaped to "${where.className}"`).toBe(true);
            if (where.inDialog) seen.add(where.className.includes('details-toggle-button') ? 'toggle' : where.className);
        }
    }
    expect(seen).toContain('details-close-button');
    expect(seen).toContain('toggle');
});

test('makes the page behind inert to the mouse', async ({ page }) => {
    await openWithKeyboard(page, peakA);
    const before = await page.locator('#progress-text').textContent();
    // Clicking outside the dialog lands on the backdrop, not the cards behind it.
    await page.mouse.click(5, 5);
    await expect(page.locator('#progress-text')).toHaveText(before);
});

test('marks complete and unmarks from the dialog, updating card and progress', async ({ page }) => {
    const regionTotal = peaks.filter(p => p.region === peakA.region).length;
    await openWithKeyboard(page, peakA);
    const toggle = dialog(page).locator('.details-toggle-button');

    await toggle.click();
    await expect(dialog(page).locator('.peak-status')).toContainText('Completed');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, peakA.id)).toHaveClass(/completed/);
    await expect(page.locator('#progress-text')).toHaveText('1% complete (1/100 peaks, 99 remaining)');
    await expect(regionCount(page, peakA.region)).toContainText(`1 / ${regionTotal} peaks`);
    expect(await page.evaluate(() => localStorage.getItem('trail100_completed'))).toContain(peakA.id);

    await toggle.click();
    await expect(dialog(page).locator('.peak-status')).toContainText('Not climbed');
    await expect(card(page, peakA.id)).not.toHaveClass(/completed/);
    await expect(page.locator('#progress-text')).toHaveText('0% complete (0/100 peaks, 100 remaining)');
});

test('closes with Escape and returns focus to the opener', async ({ page }) => {
    await openWithKeyboard(page, peakA);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(detailsButton(page, peakA)).toBeFocused();
});

test('closes with the Close button and returns focus to the opener', async ({ page }) => {
    await detailsButton(page, peakB).click();
    await expect(dialog(page)).toContainText(peakB.name);
    await dialog(page).locator('.details-close-button').click();
    await expect(dialog(page)).toBeHidden();
    await expect(detailsButton(page, peakB)).toBeFocused();
});

test('returns focus to the opener after unmarking while filtered to Completed', async ({ page }) => {
    await card(page, peakB.id).locator('.toggle-button').click();
    await page.getByLabel('Status:').selectOption('completed');
    await expect(page.locator('#peaks-container .peak-card')).toHaveCount(1);

    await openWithKeyboard(page, peakB);
    await page.keyboard.press('Tab');
    await expect(dialog(page).locator('.details-toggle-button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page).locator('.peak-status')).toContainText('Not climbed');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(detailsButton(page, peakB)).toBeFocused();
});

test('fits the screen without horizontal scrolling and with usable buttons', async ({ page }) => {
    const longest = peaks.reduce((a, b) => (b.name.length > a.name.length ? b : a));
    await detailsButton(page, longest).click();
    await expect(dialog(page)).toBeVisible();

    const viewport = page.viewportSize();
    const box = await dialog(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(await dialog(page).evaluate(d => d.scrollWidth <= d.clientWidth)).toBe(true);

    if (viewport.width >= 1024) {
        expect(box.width).toBeLessThanOrEqual(520);
        expect(Math.abs(box.x - (viewport.width - box.x - box.width))).toBeLessThanOrEqual(2);
    }

    for (const selector of ['.details-close-button', '.details-toggle-button']) {
        const button = await dialog(page).locator(selector).boundingBox();
        expect(button.height, `${selector} touch target`).toBeGreaterThanOrEqual(44);
        expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
});
