// Photo gallery, pagination, peak photos and route links (TASK-004) in a real browser.
import { test, expect } from '@playwright/test';
import { peaks, media, openFreshApp, showPeak, card, PAGE_SIZE, pageCountFor } from './helpers.js';

const cards = page => page.locator('#peaks-container .peak-card');
const pagination = page => page.locator('#pagination');
const currentPage = page => pagination(page).locator('[aria-current="page"]');
const dialog = page => page.locator('#peak-details');
const totalPages = pageCountFor(peaks.length);

// Peaks are chosen from the media data at run time; route coverage will grow,
// so no test assumes how many peaks have routes.
const routeOf = p => (media[p.id] && media[p.id].route) || null;
const peakWithRoute = peaks.find(p => routeOf(p) && routeOf(p).url && routeOf(p).gpxUrl);
// Walkhighlands-style: a route page but no direct GPX file (gpxUrl: null).
const peakWithoutGpxFile = peaks.find(p => routeOf(p) && routeOf(p).url && !routeOf(p).gpxUrl);
const peakWithoutRoute = peaks.find(p => !routeOf(p) || !routeOf(p).url);

async function expectPageShows(page, n) {
    const expected = peaks.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE);
    await expect(cards(page)).toHaveCount(expected.length);
    await expect(cards(page).locator('.peak-name')).toHaveText(expected.map(p => p.name));
    await expect(currentPage(page)).toHaveText(String(n));
    await expect(pagination(page).locator('[aria-current]')).toHaveCount(1);
}

async function openDetails(page, peak) {
    await showPeak(page, peak);
    await page.getByRole('button', { name: `View details for ${peak.name}` }).click();
    await expect(dialog(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
});

test.describe('pagination', () => {
    test('shows 12 peaks per page with numbered, Previous and Next buttons', async ({ page }) => {
        const nav = page.getByRole('navigation', { name: 'Peak gallery pages' });
        await expect(nav).toBeVisible();
        await expect(nav.locator('.page-number')).toHaveCount(totalPages);
        await expectPageShows(page, 1);
        await expect(nav.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        await expect(nav.getByRole('button', { name: 'Next page' })).toBeEnabled();
        await expect(page.locator('#gallery-status')).toHaveText(`Showing 1–${PAGE_SIZE} of ${peaks.length} peaks (page 1 of ${totalPages})`);
    });

    test('Next, Previous and numbered buttons show the right peaks and move focus to the gallery', async ({ page }) => {
        const nav = pagination(page);
        await nav.getByRole('button', { name: 'Next page' }).click();
        await expectPageShows(page, 2);
        await expect(page.locator('#peaks-heading')).toBeFocused();
        await expect(nav.getByRole('button', { name: 'Previous page' })).toBeEnabled();

        await nav.getByRole('button', { name: `Page ${totalPages}`, exact: true }).click();
        await expectPageShows(page, totalPages);
        await expect(page.locator('#peaks-heading')).toBeFocused();
        await expect(nav.getByRole('button', { name: 'Next page' })).toBeDisabled();

        await nav.getByRole('button', { name: 'Previous page' }).click();
        await expectPageShows(page, totalPages - 1);
        await expect(page.locator('#peaks-heading')).toBeFocused();
    });

    test('works from the keyboard', async ({ page }) => {
        await pagination(page).getByRole('button', { name: 'Page 3', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expectPageShows(page, 3);
        await expect(page.locator('#peaks-heading')).toBeFocused();
        // Tabbing on from the gallery start reaches the first card's controls.
        await page.keyboard.press('Tab');
        const focusedPeak = await page.evaluate(() => document.activeElement.dataset.peakId);
        expect(focusedPeak).toBe(peaks[PAGE_SIZE * 2].id);
    });

    test('changing a filter returns to page 1 and the page count follows the filtered results', async ({ page }) => {
        await pagination(page).getByRole('button', { name: 'Page 3', exact: true }).click();
        await expect(currentPage(page)).toHaveText('3');

        // Region with the most peaks, so the result may still span pages.
        const counts = {};
        peaks.forEach(p => { counts[p.region] = (counts[p.region] || 0) + 1; });
        const [region, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        await page.getByLabel('Region:').selectOption(region);

        await expect(cards(page)).toHaveCount(Math.min(PAGE_SIZE, count));
        const regionPeaks = peaks.filter(p => p.region === region);
        await expect(cards(page).first()).toContainText(regionPeaks[0].name);
        if (pageCountFor(count) > 1) {
            await expect(currentPage(page)).toHaveText('1');
            await expect(pagination(page).locator('.page-number')).toHaveCount(pageCountFor(count));
        } else {
            await expect(pagination(page).locator('.pagination')).toHaveCount(0);
        }

        await page.getByLabel('Status:').selectOption('remaining');
        await page.getByRole('button', { name: 'Reset Filters' }).click();
        await expectPageShows(page, 1);
        await expect(pagination(page).locator('.page-number')).toHaveCount(totalPages);
    });
});

test.describe('photo cards', () => {
    test('each card has a lazy-loaded photo with alt text that loads at a fixed aspect ratio', async ({ page }) => {
        const pagePeaks = peaks.slice(0, PAGE_SIZE);
        for (const peak of pagePeaks) {
            const img = card(page, peak.id).locator('.peak-photo img');
            const entry = media[peak.id];
            await expect(img).toHaveAttribute('loading', 'lazy');
            await expect(img).toHaveAttribute('alt', entry.image.alt);
            await expect(img).toHaveAttribute('src', entry.image.src);
            await img.scrollIntoViewIfNeeded();
            await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0), { message: `${peak.id} photo loads` }).toBe(true);
            const box = await card(page, peak.id).locator('.peak-photo').boundingBox();
            expect(Math.abs(box.width / box.height - 4 / 3)).toBeLessThan(0.02);
        }
    });

    test('each card shows number, name, region, height and completion state', async ({ page }) => {
        const peak = peaks[1];
        const peakCard = card(page, peak.id);
        await expect(peakCard.locator('.peak-number')).toHaveText(`#${peak.number}`);
        await expect(peakCard.locator('.peak-name')).toHaveText(peak.name);
        await expect(peakCard.locator('.peak-region')).toHaveText(peak.region);
        await expect(peakCard.locator('.peak-height')).toHaveText(`${peak.heightM}m`);
        await expect(peakCard.locator('.peak-status')).toHaveText('Not climbed');
        await peakCard.locator('.toggle-button').click();
        await expect(card(page, peak.id).locator('.peak-status')).toHaveText('✓ Completed');
    });
});

test.describe('details dialog photo and route', () => {
    test('shows the large photo with credit, licence and source link', async ({ page }) => {
        const peak = peaks[0];
        const image = media[peak.id].image;
        await openDetails(page, peak);
        const photo = dialog(page).locator('.peak-details-photo img');
        await expect(photo).toHaveAttribute('src', image.src);
        await expect(photo).toHaveAttribute('alt', image.alt);
        await expect.poll(() => photo.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
        await expect(dialog(page)).toContainText(`Photo: ${image.credit}`);
        await expect(dialog(page)).toContainText(image.licence);
        if (image.licenceUrl) {
            await expect(dialog(page).locator('.licence-link')).toHaveAttribute('href', image.licenceUrl);
        }
        const source = dialog(page).locator('.photo-source-link');
        await expect(source).toHaveAttribute('href', image.sourceUrl);
        await expect(source).toHaveAttribute('target', '_blank');
        await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    });

    test('a peak with a route shows the route, GPX link and Garmin instructions', async ({ page }) => {
        test.skip(!peakWithRoute, 'No peak has a route in data/peak-media.json');
        const route = media[peakWithRoute.id].route;
        await openDetails(page, peakWithRoute);
        const section = dialog(page).locator('.route-section');
        await expect(section).toContainText(route.title);
        await expect(section).toContainText(route.source);

        const routeLink = section.getByRole('link', { name: /View route page/ });
        await expect(routeLink).toHaveAttribute('href', route.url);
        const gpxLink = section.getByRole('link', { name: /Download GPX/ });
        await expect(gpxLink).toHaveAttribute('href', route.gpxUrl);
        for (const link of [routeLink, gpxLink]) {
            await expect(link).toHaveAttribute('target', '_blank');
            await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }
        await expect(section).toContainText('Garmin Connect');
        await expect(section).toContainText('Courses');
        await expect(section.locator('.garmin-steps li').first()).toHaveText('Download the GPX file to your computer.');

        // Every external link in the dialog opens safely in a new tab.
        const links = await dialog(page).locator('a').evaluateAll(as => as.map(a => ({ target: a.target, rel: a.rel, href: a.getAttribute('href') })));
        for (const link of links) {
            expect(link.target).toBe('_blank');
            expect(link.rel).toBe('noopener noreferrer');
            expect(link.href).toMatch(/^https?:\/\//);
        }
    });

    test('a route without a direct GPX file shows the route page link and note, with no Download GPX link', async ({ page }) => {
        test.skip(!peakWithoutGpxFile, 'Every route in data/peak-media.json has a direct GPX file');
        const route = routeOf(peakWithoutGpxFile);
        await openDetails(page, peakWithoutGpxFile);
        const section = dialog(page).locator('.route-section');
        await expect(section).toContainText(route.title);
        await expect(section).toContainText(route.source);

        const routeLink = section.getByRole('link', { name: /View route page/ });
        await expect(routeLink).toBeVisible();
        await expect(routeLink).toHaveAttribute('href', route.url);
        await expect(routeLink).toHaveAttribute('target', '_blank');
        await expect(routeLink).toHaveAttribute('rel', 'noopener noreferrer');

        const note = section.locator('.route-gpx-note');
        await expect(note).toBeVisible();
        if (route.gpxNote) await expect(note).toHaveText(route.gpxNote);

        await expect(section.getByRole('link', { name: /Download GPX/ })).toHaveCount(0);
        await expect(dialog(page)).not.toContainText('Download GPX');
        await expect(section).not.toContainText('not available');
        await expect(section.locator('a')).toHaveCount(1);
        await expect(dialog(page).locator('a[href=""], a[href="#"], a:not([href])')).toHaveCount(0);
        await expect(section.locator('.garmin-steps li').first()).toContainText('download the GPX file from there');
    });

    test('a peak without a route says no verified route is available, with no route links', async ({ page }) => {
        test.skip(!peakWithoutRoute, 'Every peak has a route in data/peak-media.json');
        await openDetails(page, peakWithoutRoute);
        const section = dialog(page).locator('.route-section');
        await expect(section).toContainText('A verified walking route is not available for this peak yet.');
        await expect(section.locator('a')).toHaveCount(0);
        await expect(dialog(page)).not.toContainText('Download GPX');
        await expect(dialog(page).locator('a[href=""], a:not([href])')).toHaveCount(0);
    });

    test('mark/unmark from the dialog still works on a later page', async ({ page }) => {
        const peak = peaks[PAGE_SIZE + 1];
        await openDetails(page, peak);
        await dialog(page).locator('.details-toggle-button').click();
        await expect(card(page, peak.id)).toHaveClass(/completed/);
        await expect(page.locator('#progress-text')).toHaveText('1% complete (1/100 peaks, 99 remaining)');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: `View details for ${peak.name}` })).toBeFocused();
        await expect(currentPage(page)).toHaveText('2');
    });
});

test.describe('responsive gallery layout', () => {
    const columnCount = page => cards(page).evaluateAll(els => new Set(els.map(el => Math.round(el.getBoundingClientRect().left))).size);

    test('1 column at 360px', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await expect(cards(page)).toHaveCount(PAGE_SIZE);
        expect(await columnCount(page)).toBe(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        // Pagination stays usable on a small screen.
        const next = pagination(page).getByRole('button', { name: 'Next page' });
        const box = await next.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(360);
    });

    test('at least 3 columns at 1280px', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(cards(page)).toHaveCount(PAGE_SIZE);
        expect(await columnCount(page)).toBeGreaterThanOrEqual(3);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });

    test('the details dialog with a photo and route fits the screen', async ({ page }) => {
        const peak = peakWithRoute || peaks[0];
        await openDetails(page, peak);
        const viewport = page.viewportSize();
        const box = await dialog(page).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        expect(await dialog(page).evaluate(d => d.scrollWidth <= d.clientWidth)).toBe(true);
    });
});
