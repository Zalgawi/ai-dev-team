// End-to-end tests for the peak details dialog in a real headless browser
// (Microsoft Edge or Google Chrome), driven over the Chrome DevTools Protocol
// using Node's built-in WebSocket - no extra dependencies.
//
// Covers behaviour that cannot be verified with pure functions: real keyboard
// focus (Tab / Shift+Tab trap, Escape, focus return), the modal page being
// inert, live updates of cards and progress, and layout at 360px and desktop.
//
// Set BROWSER_PATH to point at a Chromium-based browser if it is not found
// automatically. If no browser is available the suite is reported as skipped.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { createServer } from '../src/server.js';

const CANDIDATE_BROWSERS = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

export function findBrowser() {
    return CANDIDATE_BROWSERS.find(p => {
        try { return fs.statSync(p).isFile(); } catch { return false; }
    }) || null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 15000, interval = 50, message = 'condition' } = {}) {
    const start = Date.now();
    let lastError;
    while (Date.now() - start < timeout) {
        try {
            const value = await fn();
            if (value) return value;
        } catch (e) {
            lastError = e;
        }
        await sleep(interval);
    }
    throw new Error(`Timed out waiting for ${message}${lastError ? `: ${lastError.message}` : ''}`);
}

export async function launchBrowser(executable) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail100-browser-'));
    const proc = spawn(executable, [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-sync',
        'about:blank',
    ], { stdio: 'ignore' });

    let exited = false;
    proc.on('exit', () => { exited = true; });

    // The browser writes its debugging port and browser target path here.
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    const contents = await waitFor(() => {
        if (exited) throw new Error('browser process exited during startup');
        const text = fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf-8') : '';
        return text.split('\n').length >= 2 && text.trim() ? text : null;
    }, { timeout: 30000, message: 'DevToolsActivePort' });
    const [port, wsPath] = contents.trim().split('\n').map(s => s.trim());

    const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error('Could not connect to browser')), { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const eventListeners = [];
    ws.addEventListener('message', ({ data }) => {
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`.trim()));
            else resolve(msg.result);
        } else if (msg.method) {
            eventListeners.forEach(fn => fn(msg));
        }
    });

    function send(method, params = {}, sessionId) {
        const id = nextId++;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }

    async function close() {
        try { await Promise.race([send('Browser.close'), sleep(3000)]); } catch { /* already closing */ }
        try { ws.close(); } catch { /* ignore */ }
        if (!exited) {
            try { proc.kill(); } catch { /* ignore */ }
        }
        await waitFor(() => exited, { timeout: 5000, message: 'browser exit' }).catch(() => {});
        try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ }
    }

    async function newPage() {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const call = (method, params) => send(method, params, sessionId);
        await call('Page.enable');
        await call('Runtime.enable');
        await call('Emulation.setFocusEmulationEnabled', { enabled: true });
        await call('Page.bringToFront');

        const page = {
            call,
            async evaluate(expression) {
                const res = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
                if (res.exceptionDetails) {
                    const detail = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
                    throw new Error(`Page error: ${detail}`);
                }
                return res.result.value;
            },
            async setViewport(width, height, mobile) {
                await call('Emulation.setDeviceMetricsOverride', {
                    width, height, mobile, deviceScaleFactor: mobile ? 2 : 1,
                });
            },
            async goto(url) {
                await call('Page.navigate', { url });
                await waitFor(() => page.evaluate("document.querySelectorAll('#peaks-container .details-button').length === 100"),
                    { message: 'peak cards to render' });
            },
            async press(key, { shift = false } = {}) {
                const codes = { Tab: 9, Enter: 13, Escape: 27 };
                const base = { key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 };
                await call('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' ? { text: '\r' } : {}) });
                await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
            },
            async clickAt(x, y) {
                await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
                await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
                await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
            },
            // Scroll an element into view and click its centre with the mouse.
            async click(selector) {
                const rect = await page.evaluate(`(() => {
                    const el = document.querySelector(${JSON.stringify(selector)});
                    if (!el) return null;
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                    const r = el.getBoundingClientRect();
                    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                })()`);
                if (!rect) throw new Error(`No element for ${selector}`);
                await page.clickAt(rect.x, rect.y);
            },
        };
        return page;
    }

    return { newPage, close };
}

// Common in-page expressions.
const DIALOG_OPEN = "document.getElementById('peak-details').open";
const ACTIVE_INFO = `(() => {
    const ae = document.activeElement;
    const dlg = document.getElementById('peak-details');
    return {
        inDialog: dlg.contains(ae),
        isBody: ae === document.body || ae === document.documentElement || ae === null,
        className: ae ? ae.className : null,
        peakId: ae && ae.dataset ? ae.dataset.peakId || null : null,
        connected: ae ? ae.isConnected : false,
    };
})()`;
const sel = (selector, peakId) => `#peaks-container ${selector}[data-peak-id="${peakId}"]`;

export function registerBrowserTests({ describe, it, beforeAll, afterAll, assertEqual, assertTrue, assertFalse, loadPeaksData }) {
    const executable = findBrowser();

    describe('Peak details view in a real browser (headless Edge/Chrome)', () => {
        if (!executable) {
            it('SKIPPED: no Chromium-based browser found (set BROWSER_PATH to run these tests)', () => {
                console.log('    (browser tests skipped - no browser found)');
            });
            return;
        }

        let server;
        let baseUrl;
        let browser;
        let page;
        let peaks;
        let peakA;
        let peakB;

        beforeAll(async () => {
            peaks = loadPeaksData();
            peakA = peaks[0];
            peakB = peaks[10];
            server = createServer();
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            browser = await launchBrowser(executable);
            page = await browser.newPage();
            await page.setViewport(1280, 900, false);
            await page.goto(`${baseUrl}/`);
            await page.evaluate('localStorage.clear()');
            await page.goto(`${baseUrl}/`);
        });

        afterAll(async () => {
            if (browser) await browser.close();
            if (server) {
                server.closeAllConnections();
                await new Promise(resolve => server.close(resolve));
            }
        });

        it('opens from the card "View details" button with the keyboard and moves focus into the dialog', async () => {
            await page.evaluate(`document.querySelector('${sel('.details-button', peakA.id)}').focus()`);
            await page.press('Enter');
            await waitFor(() => page.evaluate(DIALOG_OPEN), { message: 'dialog to open' });
            assertTrue(await page.evaluate("document.getElementById('peak-details').matches(':modal')"), 'Dialog should be modal');
            const active = await page.evaluate(ACTIVE_INFO);
            assertTrue(active.inDialog, 'Focus should be inside the dialog');
            assertEqual(active.className, 'details-close-button');
        });

        it('shows the peak number, name, region, height and status, and no grid reference when the data has none', async () => {
            const text = await page.evaluate("document.getElementById('peak-details').innerText");
            assertTrue(text.includes(`#${peakA.number}`), 'number');
            assertTrue(text.includes(peakA.name), 'name');
            assertTrue(text.includes(peakA.region), 'region');
            assertTrue(text.includes(`${peakA.heightM}m`), 'height');
            assertTrue(text.includes('Not climbed'), 'status');
            assertFalse(/grid ref/i.test(text), 'No grid reference shown for a peak without one');
            assertTrue(await page.evaluate("document.getElementById('peak-details').getAttribute('aria-labelledby') === 'peak-details-title' && !!document.getElementById('peak-details-title')"),
                'Dialog is labelled by the peak name');
        });

        it('keeps Tab and Shift+Tab focus inside the dialog (page behind cannot be reached)', async () => {
            const seen = new Set();
            for (const shift of [false, true]) {
                for (let i = 0; i < 8; i++) {
                    await page.press('Tab', { shift });
                    const active = await page.evaluate(ACTIVE_INFO);
                    // Leaving the document for browser UI is allowed; focusing page content is not.
                    assertTrue(active.inDialog || active.isBody, `Focus escaped to page content: ${active.className}`);
                    if (active.inDialog) seen.add(active.className.split(' ').includes('details-toggle-button') ? 'toggle' : active.className);
                }
            }
            assertTrue(seen.has('details-close-button') && seen.has('toggle'), 'Both dialog controls are reachable by keyboard');
            assertTrue(await page.evaluate("document.querySelector('main').matches(':modal') === false && document.getElementById('peak-details').open"));
        });

        it('makes the page behind inert to the mouse while open', async () => {
            const before = await page.evaluate("document.getElementById('progress-text').textContent");
            // Click a card toggle that lies outside the dialog box.
            const point = await page.evaluate(`(() => {
                const d = document.getElementById('peak-details').getBoundingClientRect();
                for (const b of document.querySelectorAll('#peaks-container .toggle-button')) {
                    const r = b.getBoundingClientRect();
                    const x = r.left + r.width / 2, y = r.top + r.height / 2;
                    const inViewport = y > 0 && y < innerHeight && x > 0 && x < innerWidth;
                    const inDialog = x >= d.left && x <= d.right && y >= d.top && y <= d.bottom;
                    if (inViewport && !inDialog) return { x, y };
                }
                return null;
            })()`);
            assertTrue(point, 'A card toggle should be visible behind the dialog');
            await page.clickAt(point.x, point.y);
            await sleep(100);
            assertEqual(await page.evaluate("document.getElementById('progress-text').textContent"), before, 'Card behind must not toggle');
            assertTrue(await page.evaluate(DIALOG_OPEN), 'Dialog still open');
        });

        it('marks complete and unmarks from the details view, updating the card, overall and region progress', async () => {
            const regionTotal = peaks.filter(p => p.region === peakA.region).length;
            const regionCount = `(() => {
                const item = [...document.querySelectorAll('#region-progress-list li')]
                    .find(li => li.querySelector('.region-name').textContent === ${JSON.stringify(peakA.region)});
                return item.querySelector('.region-count').textContent;
            })()`;

            await page.click('#peak-details .details-toggle-button');
            await waitFor(() => page.evaluate("document.querySelector('#peak-details .peak-status').textContent.includes('Completed')"), { message: 'dialog status to update' });
            assertTrue(await page.evaluate(`document.querySelector('${sel('.toggle-button', peakA.id)}').closest('.peak-card').classList.contains('completed')`), 'Card marked completed');
            assertTrue((await page.evaluate("document.getElementById('progress-text').textContent")).startsWith('1% complete (1/100 peaks, 99 remaining)'), 'Overall progress');
            assertTrue((await page.evaluate(regionCount)).startsWith(`1 / ${regionTotal} peaks`), 'Region progress');
            assertTrue(await page.evaluate("document.querySelector('#peak-details .details-toggle-button').getAttribute('aria-pressed') === 'true'"));
            assertTrue((await page.evaluate("localStorage.getItem('trail100_completed')")).includes(peakA.id), 'Saved');
            assertTrue((await page.evaluate(ACTIVE_INFO)).inDialog, 'Focus stays in dialog after toggling');

            await page.click('#peak-details .details-toggle-button');
            await waitFor(() => page.evaluate("document.querySelector('#peak-details .peak-status').textContent.includes('Not climbed')"), { message: 'dialog status to revert' });
            assertFalse(await page.evaluate(`document.querySelector('${sel('.toggle-button', peakA.id)}').closest('.peak-card').classList.contains('completed')`), 'Card unmarked');
            assertTrue((await page.evaluate("document.getElementById('progress-text').textContent")).startsWith('0% complete (0/100 peaks, 100 remaining)'));
            assertTrue((await page.evaluate(regionCount)).startsWith(`0 / ${regionTotal} peaks`));
        });

        it('closes with the Escape key and returns focus to the "View details" button that opened it', async () => {
            await page.press('Escape');
            await waitFor(async () => !(await page.evaluate(DIALOG_OPEN)), { message: 'dialog to close' });
            const active = await page.evaluate(ACTIVE_INFO);
            assertEqual(active.className, 'details-button');
            assertEqual(active.peakId, peakA.id);
            assertTrue(active.connected);
        });

        it('closes with the visible Close button and returns focus to the opener', async () => {
            await page.click(sel('.details-button', peakB.id));
            await waitFor(() => page.evaluate(DIALOG_OPEN), { message: 'dialog to open' });
            assertTrue((await page.evaluate("document.getElementById('peak-details').innerText")).includes(peakB.name));
            await page.click('#peak-details .details-close-button');
            await waitFor(async () => !(await page.evaluate(DIALOG_OPEN)), { message: 'dialog to close' });
            const active = await page.evaluate(ACTIVE_INFO);
            assertEqual(active.className, 'details-button');
            assertEqual(active.peakId, peakB.id);
        });

        it('returns focus to the opener even after unmarking a peak while filtered to "Completed"', async () => {
            await page.click(sel('.toggle-button', peakB.id));
            await page.evaluate(`(() => {
                const s = document.getElementById('status-filter');
                s.value = 'completed';
                s.dispatchEvent(new Event('change'));
            })()`);
            assertEqual(await page.evaluate("document.querySelectorAll('#peaks-container .peak-card').length"), 1);
            await page.evaluate(`document.querySelector('${sel('.details-button', peakB.id)}').focus()`);
            await page.press('Enter');
            await waitFor(() => page.evaluate(DIALOG_OPEN), { message: 'dialog to open' });
            await page.press('Tab');
            assertTrue((await page.evaluate(ACTIVE_INFO)).className.includes('details-toggle-button'), 'Tab reaches the toggle');
            await page.press('Enter');
            await waitFor(() => page.evaluate("document.querySelector('#peak-details .peak-status').textContent.includes('Not climbed')"), { message: 'unmark' });
            await page.press('Escape');
            await waitFor(async () => !(await page.evaluate(DIALOG_OPEN)), { message: 'dialog to close' });
            const active = await page.evaluate(ACTIVE_INFO);
            assertEqual(active.className, 'details-button');
            assertEqual(active.peakId, peakB.id);
            assertTrue(active.connected, 'Opener still in the page');
            // Changing the filters afterwards applies them normally again.
            await page.evaluate("document.getElementById('reset-filters').click(); document.getElementById('status-filter').value = 'completed'; document.getElementById('status-filter').dispatchEvent(new Event('change'))");
            assertTrue(await page.evaluate("!!document.querySelector('#peaks-container .empty-state')"), 'No completed peaks remain');
            await page.evaluate("document.getElementById('reset-filters').click()");
        });

        it('fits a desktop screen as a centred dialog of reasonable width', async () => {
            await page.click(sel('.details-button', peakA.id));
            await waitFor(() => page.evaluate(DIALOG_OPEN), { message: 'dialog to open' });
            const box = await page.evaluate("(() => { const r = document.getElementById('peak-details').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, vw: innerWidth, vh: innerHeight }; })()");
            assertTrue(box.width <= 520 && box.width >= 300, `Desktop width ${box.width}`);
            assertTrue(Math.abs(box.left - (box.vw - box.right)) <= 2, 'Horizontally centred');
            assertTrue(box.top >= 0 && box.bottom <= box.vh, 'Fits vertically');
            await page.press('Escape');
            await waitFor(async () => !(await page.evaluate(DIALOG_OPEN)), { message: 'dialog to close' });
        });

        it('is usable on a 360px-wide mobile screen', async () => {
            await page.setViewport(360, 740, true);
            await page.goto(`${baseUrl}/`);
            assertEqual(await page.evaluate('innerWidth'), 360);
            assertTrue(await page.evaluate('document.documentElement.scrollWidth <= 360'), 'Page has no horizontal overflow');

            const longest = peaks.reduce((a, b) => (b.name.length > a.name.length ? b : a));
            await page.click(sel('.details-button', longest.id));
            await waitFor(() => page.evaluate(DIALOG_OPEN), { message: 'dialog to open' });
            const layout = await page.evaluate(`(() => {
                const d = document.getElementById('peak-details');
                const r = d.getBoundingClientRect();
                const inside = el => { const b = el.getBoundingClientRect(); return b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.width > 0 && b.height >= 44; };
                return {
                    left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                    noOverflow: d.scrollWidth <= d.clientWidth,
                    closeOk: inside(d.querySelector('.details-close-button')),
                    toggleOk: inside(d.querySelector('.details-toggle-button')),
                    titleVisible: d.querySelector('.peak-details-title').getBoundingClientRect().right <= r.right + 0.5,
                    text: d.innerText,
                };
            })()`);
            assertTrue(layout.left >= 0 && layout.right <= 360, `Dialog within 360px (left ${layout.left}, right ${layout.right})`);
            assertTrue(layout.top >= 0 && layout.bottom <= 740, 'Dialog within viewport height');
            assertTrue(layout.noOverflow, 'No horizontal scrolling inside the dialog');
            assertTrue(layout.closeOk, 'Close button fully visible with a 44px touch target');
            assertTrue(layout.toggleOk, 'Toggle button fully visible with a 44px touch target');
            assertTrue(layout.titleVisible, 'Long peak name wraps within the dialog');
            assertTrue(layout.text.includes(longest.name) && layout.text.includes(`${longest.heightM}m`));

            await page.click('#peak-details .details-toggle-button');
            await waitFor(() => page.evaluate("document.getElementById('progress-text').textContent.startsWith('1% complete')"), { message: 'progress update on mobile' });
            await page.click('#peak-details .details-close-button');
            await waitFor(async () => !(await page.evaluate(DIALOG_OPEN)), { message: 'dialog to close' });
            const active = await page.evaluate(ACTIVE_INFO);
            assertEqual(active.peakId, longest.id);
            assertEqual(active.className, 'details-button');
        });
    });
}
