// Captures screenshots of the app for human review. Run with `npm run screenshots`;
// excluded from `npm run test:e2e`. Images are written to screenshots/<project>/.
import { test, expect } from '@playwright/test';
import { peaks, openFreshApp, card } from './helpers.js';

test.describe('@screenshots', () => {
    test('capture app screens', async ({ page }, testInfo) => {
        const shot = name => page.screenshot({
            path: `screenshots/${testInfo.project.name}/${name}.png`,
            fullPage: name.endsWith('-full'),
        });

        await openFreshApp(page);
        await shot('01-home');

        // Some progress so the dashboard isn't empty.
        for (const peak of peaks.filter((_, i) => i % 7 === 0)) {
            await card(page, peak.id).locator('.toggle-button').click();
        }
        await page.locator('#progress-summary').scrollIntoViewIfNeeded();
        await shot('02-progress');
        await shot('03-home-full');

        await page.getByRole('button', { name: `View details for ${peaks[0].name}` }).click();
        await expect(page.locator('#peak-details')).toBeVisible();
        await shot('04-peak-details');
    });
});
