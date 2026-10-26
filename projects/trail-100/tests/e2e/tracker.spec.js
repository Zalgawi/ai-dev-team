// Core tracker flows (TASK-001 and TASK-002) in a real browser.
import { test, expect } from '@playwright/test';
import { peaks, openFreshApp, showPeak, card, regionCount, PAGE_SIZE, pageCountFor } from './helpers.js';

test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
});

test('shows all 100 peaks (across gallery pages) with name, region and height', async ({ page }) => {
    await expect(page.locator('#gallery-status')).toContainText(`of ${peaks.length} peaks`);
    for (const peak of [peaks[0], peaks[49], peaks[99]]) {
        await showPeak(page, peak);
        const peakCard = card(page, peak.id);
        await expect(peakCard).toContainText(peak.name);
        await expect(peakCard).toContainText(peak.region);
        await expect(peakCard).toContainText(`${peak.heightM}m`);
    }
    await expect(page.locator('#progress-text')).toHaveText('0% complete (0/100 peaks, 100 remaining)');
});

test('marks and unmarks a peak, updating overall and region progress', async ({ page }) => {
    const peak = peaks[0];
    const regionTotal = peaks.filter(p => p.region === peak.region).length;
    const toggle = card(page, peak.id).locator('.toggle-button');

    await toggle.click();
    await expect(card(page, peak.id)).toHaveClass(/completed/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#progress-text')).toHaveText('1% complete (1/100 peaks, 99 remaining)');
    await expect(page.locator('#overall-progress-bar')).toHaveAttribute('aria-valuenow', '1');
    await expect(regionCount(page, peak.region)).toContainText(`1 / ${regionTotal} peaks`);

    await toggle.click();
    await expect(card(page, peak.id)).not.toHaveClass(/completed/);
    await expect(page.locator('#progress-text')).toHaveText('0% complete (0/100 peaks, 100 remaining)');
    await expect(regionCount(page, peak.region)).toContainText(`0 / ${regionTotal} peaks`);
});

test('marks a peak on a later page without leaving that page', async ({ page }) => {
    const peak = peaks[PAGE_SIZE * 2];
    await showPeak(page, peak);
    const toggle = card(page, peak.id).locator('.toggle-button');
    await toggle.click();
    await expect(card(page, peak.id)).toHaveClass(/completed/);
    await expect(page.locator('#pagination [aria-current="page"]')).toHaveText('3');
    await expect(card(page, peak.id).locator('.toggle-button')).toBeFocused();
});

test('remembers completed peaks after a reload', async ({ page }) => {
    await card(page, peaks[5].id).locator('.toggle-button').click();
    await page.reload();
    await expect(card(page, peaks[5].id)).toHaveClass(/completed/);
    await expect(page.locator('#progress-text')).toHaveText('1% complete (1/100 peaks, 99 remaining)');
});

test('filters by region and status, and resets filters', async ({ page }) => {
    const region = peaks[0].region;
    const inRegion = peaks.filter(p => p.region === region).length;

    await page.getByLabel('Region:').selectOption(region);
    await expect(page.locator('#peaks-container .peak-card')).toHaveCount(Math.min(PAGE_SIZE, inRegion));
    await expect(page.locator('#gallery-status')).toContainText(`of ${inRegion} peaks`);

    await card(page, peaks[0].id).locator('.toggle-button').click();
    await page.getByLabel('Status:').selectOption('completed');
    await expect(page.locator('#peaks-container .peak-card')).toHaveCount(1);
    await expect(page.locator('#pagination .pagination')).toHaveCount(0);

    await page.getByRole('button', { name: 'Reset Filters' }).click();
    await expect(page.locator('#peaks-container .peak-card')).toHaveCount(PAGE_SIZE);
    await expect(page.locator('#pagination .page-number')).toHaveCount(pageCountFor(peaks.length));
});

test('lists every region with an accessible progress bar', async ({ page }) => {
    const regions = [...new Set(peaks.map(p => p.region))].sort();
    // The list is collapsed by default on small screens; open it first.
    const toggle = page.locator('#region-progress-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const items = page.locator('#region-progress-list li');
    await expect(items).toHaveCount(regions.length);
    await expect(items.locator('.region-name')).toHaveText(regions);
    for (const region of regions.slice(0, 3)) {
        await expect(page.getByRole('progressbar', { name: `${region} completion` })).toHaveAttribute('aria-valuenow', '0');
    }
});

test('has no horizontal scrolling at this screen size', async ({ page }) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
