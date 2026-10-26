// Night mode (TASK-006): light / dark theme, the header toggle, persistence,
// no flash of the wrong theme, storage failures and dark-mode layout.
import { test, expect } from '@playwright/test';
import { peaks, media, openFreshApp, showPeak, card } from './helpers.js';

const THEME_KEY = 'trail100_theme';
const LIGHT_BG = 'rgb(245, 242, 234)';
const DARK_BG = 'rgb(14, 24, 19)';

const html = page => page.locator('html');
const themeToggle = page => page.locator('#theme-toggle');
const bodyBackground = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function openWithScheme(page, colorScheme) {
    await page.emulateMedia({ colorScheme });
    await openFreshApp(page);
}

// Runs in the page: checks every visible element in main, footer and the open
// dialog. Returns light backgrounds / dark text (in dark mode) and text whose
// contrast against its nearest opaque background is below 4.5:1.
function auditColours(theme) {
    const parse = c => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (x, y) => { const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };
    const visible = el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    // Nearest opaque background colour, or null when the text sits on a photo,
    // gradient or translucent layer (not checked here).
    const backdropOf = el => {
        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
            const s = getComputedStyle(node);
            if (s.backgroundImage !== 'none' && !node.classList.contains('progress-bar')) return null;
            const bg = parse(s.backgroundColor);
            if (bg && bg.a > 0 && bg.a < 1) return null;
            if (bg && bg.a === 1) return bg;
        }
        return parse(getComputedStyle(document.body).backgroundColor);
    };
    const problems = [];
    const roots = [...document.querySelectorAll('main, footer, dialog[open]')];
    const describeEl = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')}`;
    for (const root of roots) {
        for (const el of [root, ...root.querySelectorAll('*')]) {
            if (!visible(el) || el.closest('svg') || el.closest('.visually-hidden')) continue;
            const s = getComputedStyle(el);
            const bg = parse(s.backgroundColor);
            if (theme === 'dark' && bg && bg.a > 0.5 && lum(bg) > 0.2) {
                problems.push(`light background ${s.backgroundColor} on ${describeEl(el)}`);
            }
            const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
            if (!hasText || el.disabled) continue;
            const fg = parse(s.color);
            if (theme === 'dark' && lum(fg) < 0.25) problems.push(`dark text ${s.color} on ${describeEl(el)}`);
            const back = backdropOf(el);
            if (back && ratio(fg, back) < 4.5) {
                problems.push(`contrast ${ratio(fg, back).toFixed(2)} for ${describeEl(el)}`);
            }
        }
    }
    return problems;
}

test.describe('default theme follows the device preference', () => {
    test('emulated light colour scheme shows the light theme', async ({ page }) => {
        await openWithScheme(page, 'light');
        await expect(html(page)).toHaveAttribute('data-theme', 'light');
        await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
        expect(await bodyBackground(page)).toBe(LIGHT_BG);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    });

    test('emulated dark colour scheme shows the dark theme', async ({ page }) => {
        await openWithScheme(page, 'dark');
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
        expect(await bodyBackground(page)).toBe(DARK_BG);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
    });

    test('with no saved choice, a change in the device setting is followed live', async ({ page }) => {
        await openWithScheme(page, 'light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        await page.emulateMedia({ colorScheme: 'light' });
        await expect(html(page)).toHaveAttribute('data-theme', 'light');
    });
});

test.describe('theme toggle', () => {
    test('clicking switches the theme and updates the accessible name', async ({ page }) => {
        await openWithScheme(page, 'light');
        const button = themeToggle(page);
        await expect(button).toHaveAccessibleName('Switch to dark theme');
        await expect(button).toContainText('Dark theme');

        await button.click();
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        await expect(button).toHaveAccessibleName('Switch to light theme');
        await expect(button).toContainText('Light theme');
        expect(await bodyBackground(page)).toBe(DARK_BG);
        expect(await page.evaluate(key => localStorage.getItem(key), THEME_KEY)).toBe('dark');

        await button.click();
        await expect(html(page)).toHaveAttribute('data-theme', 'light');
        await expect(button).toHaveAccessibleName('Switch to dark theme');
        expect(await bodyBackground(page)).toBe(LIGHT_BG);
        expect(await page.evaluate(key => localStorage.getItem(key), THEME_KEY)).toBe('light');
    });

    test('works with the keyboard (Tab to it, Enter and Space) and shows a focus outline', async ({ page }) => {
        await openWithScheme(page, 'light');
        await page.locator('body').click({ position: { x: 1, y: 1 } });
        await page.keyboard.press('Tab');
        const button = themeToggle(page);
        await expect(button).toBeFocused();
        const outline = await button.evaluate(el => {
            const s = getComputedStyle(el);
            return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
        });
        expect(outline.style).toBe('solid');
        expect(outline.width).toBeGreaterThanOrEqual(2);

        await page.keyboard.press('Enter');
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        await expect(button).toBeFocused();
        await page.keyboard.press('Space');
        await expect(html(page)).toHaveAttribute('data-theme', 'light');
    });

    test('works with touch', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile', 'Touch is emulated in the mobile project');
        await openWithScheme(page, 'light');
        await themeToggle(page).tap();
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    });
});

test.describe('saved choice', () => {
    test('persists after reload and overrides a light device preference', async ({ page }) => {
        await openWithScheme(page, 'light');
        await themeToggle(page).click();
        await page.reload();
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        await expect(themeToggle(page)).toHaveAccessibleName('Switch to light theme');
        expect(await bodyBackground(page)).toBe(DARK_BG);
        // Changing the device setting no longer changes the theme.
        await page.emulateMedia({ colorScheme: 'light' });
        await page.reload();
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    });

    test('persists after reload and overrides a dark device preference', async ({ page }) => {
        await openWithScheme(page, 'dark');
        await themeToggle(page).click();
        await expect(html(page)).toHaveAttribute('data-theme', 'light');
        await page.reload();
        await expect(html(page)).toHaveAttribute('data-theme', 'light');
        await expect(themeToggle(page)).toHaveAccessibleName('Switch to dark theme');
        expect(await bodyBackground(page)).toBe(LIGHT_BG);
    });

    test('is applied before first paint, without waiting for app.js', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto('/');
        await page.evaluate(key => localStorage.setItem(key, 'dark'), THEME_KEY);
        // Without the app module, only the inline <head> script can set the theme.
        await page.route('**/src/app.js', route => route.abort());
        // Record the theme at the moment <body> is first parsed (before any paint).
        await page.addInitScript(() => {
            new MutationObserver((_, observer) => {
                if (document.body) {
                    window.__themeAtBody = document.documentElement.getAttribute('data-theme');
                    observer.disconnect();
                }
            }).observe(document, { childList: true, subtree: true });
        });
        await page.reload();
        expect(await page.evaluate(() => window.__themeAtBody)).toBe('dark');
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        expect(await bodyBackground(page)).toBe(DARK_BG);
    });
});

test.describe('when localStorage is unavailable', () => {
    for (const mode of ['methods throw', 'access throws']) {
        test(`the toggle still works and the page does not error (${mode})`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(m => {
                if (m === 'access throws') {
                    Object.defineProperty(window, 'localStorage', {
                        configurable: true,
                        get() { throw new DOMException('Blocked', 'SecurityError'); },
                    });
                } else {
                    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
                    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
                }
            }, mode);
            await page.emulateMedia({ colorScheme: 'light' });
            await page.goto('/');
            await expect(page.locator('#peaks-container .peak-card')).toHaveCount(12);
            await expect(html(page)).toHaveAttribute('data-theme', 'light');

            await themeToggle(page).click();
            await expect(html(page)).toHaveAttribute('data-theme', 'dark');
            await expect(themeToggle(page)).toHaveAccessibleName('Switch to light theme');
            await themeToggle(page).click();
            await expect(html(page)).toHaveAttribute('data-theme', 'light');

            // Marking a peak still works for this visit.
            await card(page, peaks[0].id).locator('.toggle-button').click();
            await expect(page.locator('#progress-text')).toContainText('1/100 peaks');
            expect(errors).toEqual([]);
        });
    }
});

for (const width of [360, 1280]) {
    test.describe(`dark mode layout at ${width}px`, () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width, height: width < 600 ? 740 : 900 });
            await openWithScheme(page, 'dark');
            await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        });

        test('toggle is in the header and nothing overflows', async ({ page }) => {
            const button = themeToggle(page);
            await expect(page.locator('header.hero #theme-toggle')).toBeVisible();
            const box = await button.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
            expect(box.width).toBeLessThan(width / 2);
            // It does not cover the hero text.
            const eyebrow = await page.locator('.hero-eyebrow').boundingBox();
            expect(box.y + box.height).toBeLessThanOrEqual(eyebrow.y);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        });

        test('every page area uses the dark colours with readable text', async ({ page }) => {
            // Some completed peaks, a few filters and the region list open.
            await card(page, peaks[0].id).locator('.toggle-button').click();
            if ((await page.locator('#region-progress-toggle').getAttribute('aria-expanded')) !== 'true') {
                await page.locator('#region-progress-toggle').click();
            }
            await expect(page.locator('#pagination .page-button').first()).toBeVisible();
            expect(await page.evaluate(auditColours, 'dark')).toEqual([]);
            for (const selector of ['.peak-card', '#filters', '#progress-summary .progress-container', '#region-filter', 'footer']) {
                const bg = await page.locator(selector).first().evaluate(el => {
                    let node = el;
                    while (node && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)') node = node.parentElement;
                    return getComputedStyle(node || document.body).backgroundColor;
                });
                expect(bg, selector).not.toBe('rgb(255, 255, 255)');
                expect(bg, selector).not.toBe(LIGHT_BG);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        });

        test('details dialog, photo credit, route section and backdrop are readable', async ({ page }) => {
            const peak = peaks.find(p => media[p.id] && media[p.id].image && media[p.id].image.credit && media[p.id].route) || peaks[0];
            await showPeak(page, peak);
            await page.getByRole('button', { name: `View details for ${peak.name}` }).click();
            const dialog = page.locator('#peak-details');
            await expect(dialog).toBeVisible();
            expect(await page.evaluate(auditColours, 'dark')).toEqual([]);

            const box = await dialog.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);

            // Photo credit: light text on its own dark caption band.
            const caption = dialog.locator('.peak-details-caption');
            if (await caption.count()) {
                const colours = await caption.evaluate(el => ({
                    text: getComputedStyle(el).color,
                    band: getComputedStyle(el.closest('.peak-details-photo')).backgroundColor,
                }));
                expect(colours.text).toBe('rgb(223, 231, 225)');
                expect(colours.band).toBe('rgb(11, 20, 15)');
            }

            // Backdrop dims the page strongly.
            const backdrop = await dialog.evaluate(el => getComputedStyle(el, '::backdrop').backgroundColor);
            const alpha = Number((backdrop.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1]);
            expect(alpha).toBeGreaterThanOrEqual(0.7);

            // Focus outline is visible inside the dialog.
            const close = dialog.locator('.details-close-button');
            await close.focus();
            await page.keyboard.press('Shift+Tab');
            await page.keyboard.press('Tab');
            const outline = await page.evaluate(() => {
                const s = getComputedStyle(document.activeElement);
                return { style: s.outlineStyle, color: s.outlineColor };
            });
            expect(outline.style).toBe('solid');
            expect(outline.color).toBe('rgb(242, 166, 90)');

            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();
        });
    });
}

test('light theme also passes the colour audit', async ({ page }) => {
    await openWithScheme(page, 'light');
    if ((await page.locator('#region-progress-toggle').getAttribute('aria-expanded')) !== 'true') {
        await page.locator('#region-progress-toggle').click();
    }
    await card(page, peaks[0].id).locator('.toggle-button').click();
    expect(await page.evaluate(auditColours, 'light')).toEqual([]);
});
