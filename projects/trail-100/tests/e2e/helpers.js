import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const peaks = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'peaks.json'), 'utf-8')
);

// Load the app with no saved progress and wait for all cards to render.
export async function openFreshApp(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#peaks-container .peak-card')).toHaveCount(peaks.length);
}

export const card = (page, peakId) =>
    page.locator('#peaks-container .peak-card').filter({
        has: page.locator(`[data-peak-id="${peakId}"]`),
    });

export const regionCount = (page, region) =>
    page.locator('#region-progress-list li')
        .filter({ has: page.locator('.region-name', { hasText: region }) })
        .locator('.region-count');
