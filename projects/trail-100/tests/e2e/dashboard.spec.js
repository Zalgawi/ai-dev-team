// Dashboard layout: overall progress card height and the region progress
// disclosure (TASK-005) in a real browser.
import { test, expect } from '@playwright/test';
import { peaks, openFreshApp, card } from './helpers.js';

const toggle = page => page.locator('#region-progress-toggle');
const regionList = page => page.locator('#region-progress-list');
const regionCount = new Set(peaks.map(p => p.region)).size;

test('region list is collapsed at 360px and expands and collapses with the disclosure button', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openFreshApp(page);

    const button = page.getByRole('button', { name: 'Progress by Region' });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toHaveAttribute('aria-controls', 'region-progress-list');
    await expect(regionList(page)).toBeHidden();
    // Collapsed, the region panel is compact so the gallery is not pushed far down.
    const panel = await page.locator('#region-progress').boundingBox();
    expect(panel.height).toBeLessThan(150);
    const buttonBox = await button.boundingBox();
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(regionList(page)).toBeVisible();
    await expect(regionList(page).locator('li')).toHaveCount(regionCount);
    await expect(page.getByRole('progressbar', { name: `${peaks[0].region} completion` })).toBeVisible();

    // Keyboard works too.
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(regionList(page)).toBeHidden();
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('region progress still updates while collapsed', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openFreshApp(page);
    const peak = peaks[0];
    const total = peaks.filter(p => p.region === peak.region).length;
    await card(page, peak.id).locator('.toggle-button').click();
    await toggle(page).click();
    const item = regionList(page).locator('li').filter({ has: page.locator('.region-name', { hasText: peak.region }) });
    await expect(item.locator('.region-count')).toContainText(`1 / ${total} ${total === 1 ? 'peak' : 'peaks'}`);
});

test('region list is open by default at 1280px in a compact multi-column grid', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFreshApp(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(regionList(page)).toBeVisible();
    const columns = await regionList(page).locator('li').evaluateAll(els => new Set(els.map(el => Math.round(el.getBoundingClientRect().left))).size);
    expect(columns).toBeGreaterThanOrEqual(3);
});

test('overall progress card has no large empty area at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFreshApp(page);
    const cardBox = await page.locator('#progress-summary .progress-container').boundingBox();
    const textBox = await page.locator('#progress-text').boundingBox();
    const paddingBottom = await page.locator('#progress-summary .progress-container')
        .evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
    const emptySpace = (cardBox.y + cardBox.height) - (textBox.y + textBox.height);
    // Only the card's own bottom padding (plus a few px of rounding) below the last line.
    expect(emptySpace).toBeLessThanOrEqual(paddingBottom + 8);
    expect(cardBox.height).toBeLessThan(250);
    // It is not stretched to the height of the region panel.
    const regionBox = await page.locator('#region-progress .progress-container').boundingBox();
    expect(cardBox.height).toBeLessThan(regionBox.height);
});

test('a one-peak region reads "peak", not "peaks"', async ({ page }) => {
    const counts = {};
    peaks.forEach(p => { counts[p.region] = (counts[p.region] || 0) + 1; });
    const single = Object.keys(counts).find(r => counts[r] === 1);
    test.skip(!single, 'No region has exactly one peak');
    await openFreshApp(page);
    if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
    const item = regionList(page).locator('li').filter({ has: page.locator('.region-name', { hasText: single }) }).first();
    await expect(item.locator('.region-count')).toHaveText('0 / 1 peak · 0%');
});
