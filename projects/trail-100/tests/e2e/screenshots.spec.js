// Captures screenshots of the app for human review. Run with `npm run screenshots`;
// excluded from `npm run test:e2e`. Images are written to screenshots/<project>/.
import { test, expect } from '@playwright/test';
import { peaks, media, openFreshApp, showPeak, card } from './helpers.js';

// Wait until every photo currently in the gallery has loaded.
async function waitForGalleryPhotos(page) {
    const imgs = page.locator('#peaks-container .peak-photo img');
    for (const img of await imgs.all()) {
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    }
}

const routePeak = () => peaks.find(p => media[p.id] && media[p.id].route && media[p.id].route.gpxUrl) || peaks[0];

test.describe('@screenshots', () => {
    test('capture app screens', async ({ page }, testInfo) => {
        const shot = name => page.screenshot({
            path: `screenshots/${testInfo.project.name}/${name}.png`,
            fullPage: name.endsWith('-full'),
        });

        await page.emulateMedia({ colorScheme: 'light' });
        await openFreshApp(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot('01-home');

        // Some progress so the dashboard isn't empty.
        for (const peak of peaks.slice(0, 12).filter((_, i) => i % 3 === 0)) {
            await card(page, peak.id).locator('.toggle-button').click();
        }
        await page.locator('#progress-summary').scrollIntoViewIfNeeded();
        await shot('02-progress');

        await waitForGalleryPhotos(page);
        await page.locator('#peaks-heading').scrollIntoViewIfNeeded();
        await shot('03-gallery');
        await shot('04-home-full');

        await page.locator('#pagination').getByRole('button', { name: 'Next page' }).click();
        await waitForGalleryPhotos(page);
        await page.locator('#peaks-heading').scrollIntoViewIfNeeded();
        await shot('05-gallery-page-2');

        const withRoute = routePeak();
        await showPeak(page, withRoute);
        await page.getByRole('button', { name: `View details for ${withRoute.name}` }).click();
        const dialog = page.locator('#peak-details');
        await expect(dialog).toBeVisible();
        await expect.poll(() => dialog.locator('img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
        await shot('06-peak-details-route');
        await dialog.locator('.route-section').scrollIntoViewIfNeeded();
        await shot('07-peak-details-route-section');
        await page.keyboard.press('Escape');

        // A route whose GPX is only downloadable from the route page.
        const noGpx = peaks.find(p => media[p.id] && media[p.id].route && media[p.id].route.url && !media[p.id].route.gpxUrl);
        if (noGpx) {
            await showPeak(page, noGpx);
            await page.getByRole('button', { name: `View details for ${noGpx.name}` }).click();
            await expect(dialog).toBeVisible();
            await dialog.locator('.route-section').scrollIntoViewIfNeeded();
            await shot('08-peak-details-route-page-gpx');
            await page.keyboard.press('Escape');
        }
    });

    test('capture app screens in dark mode', async ({ page }, testInfo) => {
        const shot = name => page.screenshot({
            path: `screenshots/${testInfo.project.name}/${name}.png`,
            fullPage: name.endsWith('-full'),
        });

        await page.emulateMedia({ colorScheme: 'dark' });
        await openFreshApp(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot('09-dark-home');

        for (const peak of peaks.slice(0, 12).filter((_, i) => i % 3 === 0)) {
            await card(page, peak.id).locator('.toggle-button').click();
        }
        const regionToggle = page.locator('#region-progress-toggle');
        if ((await regionToggle.getAttribute('aria-expanded')) !== 'true') await regionToggle.click();
        await page.locator('#progress-summary').scrollIntoViewIfNeeded();
        await shot('10-dark-progress');

        await waitForGalleryPhotos(page);
        await page.locator('#peaks-heading').scrollIntoViewIfNeeded();
        await shot('11-dark-gallery');
        await shot('12-dark-home-full');

        const withRoute = routePeak();
        await showPeak(page, withRoute);
        await page.getByRole('button', { name: `View details for ${withRoute.name}` }).click();
        const dialog = page.locator('#peak-details');
        await expect(dialog).toBeVisible();
        await expect.poll(() => dialog.locator('img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
        await shot('13-dark-peak-details');
        await dialog.locator('.route-section').scrollIntoViewIfNeeded();
        await shot('14-dark-peak-details-route-section');
        await page.keyboard.press('Escape');

        // Toggle back to light from the header to show the button in both states.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('#theme-toggle').focus();
        await shot('15-dark-theme-toggle-focused');
    });
});
