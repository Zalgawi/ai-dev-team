import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = name => JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', name), 'utf-8')
);

export const peaks = dataFile('peaks.json');
// Photos and routes keyed by peak id.
export const media = dataFile('peak-media.json');

export const PAGE_SIZE = 12;

export const pageCountFor = n => Math.max(1, Math.ceil(n / PAGE_SIZE));

// Load the app with no saved progress and wait for the first page of cards.
export async function openFreshApp(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#peaks-container .peak-card')).toHaveCount(Math.min(PAGE_SIZE, peaks.length));
}

// With no filters applied, go to the gallery page that contains the peak.
export async function showPeak(page, peak) {
    const target = Math.floor(peaks.findIndex(p => p.id === peak.id) / PAGE_SIZE) + 1;
    const current = page.locator('#pagination [aria-current="page"]');
    if ((await current.textContent()) !== String(target)) {
        await page.locator('#pagination').getByRole('button', { name: `Page ${target}`, exact: true }).click();
        await expect(current).toHaveText(String(target));
    }
    await expect(card(page, peak.id)).toBeVisible();
}

export const card = (page, peakId) =>
    page.locator('#peaks-container .peak-card').filter({
        has: page.locator(`[data-peak-id="${peakId}"]`),
    });

export const regionCount = (page, region) =>
    page.locator('#region-progress-list li')
        .filter({ has: page.locator('.region-name', { hasText: region }) })
        .locator('.region-count');
