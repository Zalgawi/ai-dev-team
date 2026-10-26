import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    calculateProgress,
    calculateRegionProgress,
    toggleCompleted,
    filterPeaks,
    getRegions,
    parseStoredCompleted,
    serializeCompleted,
    createPeakCard,
    createRegionProgressItem,
    createPeakDetails,
    hasGridRef,
    hasPhoto,
    hasRoute,
    hasGpxFile,
    GENERIC_GPX_NOTE,
    pluralize,
    formatCount,
    formatProgressText,
    formatGalleryStatus,
    escapeHtml,
    PAGE_SIZE,
    getPageCount,
    clampPage,
    paginate,
    pageForIndex,
    createPagination,
    createCardPhoto,
    createDetailsPhoto,
    createRouteSection,
} from '../src/peak-utils.js';
import { createPeakDetailsController } from '../src/peak-details-controller.js';
import { createServer } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Minimal test framework
// ---------------------------------------------------------------------------
// describe() runs its callback immediately to register hooks and tests into a
// suite; suites are executed sequentially (supporting async tests) at the end.
const suites = [];
let currentSuite = null;

function describe(name, fn) {
    const suite = { name, tests: [], beforeAll: [], afterAll: [] };
    const previous = currentSuite;
    currentSuite = suite;
    try {
        fn();
    } finally {
        currentSuite = previous;
    }
    suites.push(suite);
}

function it(name, fn) {
    if (!currentSuite) throw new Error(`it("${name}") must be called inside describe()`);
    currentSuite.tests.push({ name, fn });
}

function beforeAll(fn) {
    if (!currentSuite) throw new Error('beforeAll() must be called inside describe()');
    currentSuite.beforeAll.push(fn);
}

function afterAll(fn) {
    if (!currentSuite) throw new Error('afterAll() must be called inside describe()');
    currentSuite.afterAll.push(fn);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertNotNull(value, message) {
    if (value === null || value === undefined) {
        throw new Error(`${message || 'Assertion failed'}: value is null or undefined`);
    }
}

function assertTrue(value, message) {
    if (!value) throw new Error(`${message || 'Assertion failed'}: expected truthy value`);
}

function assertFalse(value, message) {
    if (value) throw new Error(`${message || 'Assertion failed'}: expected falsy value`);
}

function loadPeaksData() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'peaks.json'), 'utf-8'));
}

function readSource(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

// Typical signatures of UTF-8 text that was mis-decoded as Windows-1252
// (e.g. "â€™" instead of "’", "Ã²" instead of "ò"), plus the replacement char.
const MOJIBAKE_PATTERN = /[ÂÃâ][\u0080-¿Œ-Ÿˆ˜–-›€™]|�/;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Peak Dataset', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('should contain all 100 peaks', () => {
        assertTrue(Array.isArray(peaks), 'peaks.json should be an array');
        assertEqual(peaks.length, 100, 'Should have 100 peaks');
    });

    it('should have each peak with required fields', () => {
        peaks.forEach((peak, index) => {
            assertNotNull(peak.id, `Peak at index ${index} should have an id`);
            assertNotNull(peak.name, `Peak at index ${index} should have a name`);
            assertNotNull(peak.region, `Peak at index ${index} should have a region`);
            assertNotNull(peak.heightM, `Peak at index ${index} should have a heightM`);
            assertNotNull(peak.number, `Peak at index ${index} should have a number`);
        });
    });

    it('should have unique peak IDs', () => {
        assertEqual(new Set(peaks.map(p => p.id)).size, 100, 'All peak IDs should be unique');
    });

    it('should have peak numbers from 1 to 100', () => {
        const numbers = peaks.map(p => p.number).sort((a, b) => a - b);
        for (let i = 1; i <= 100; i++) {
            assertEqual(numbers[i - 1], i, `Peak number ${i} should exist`);
        }
    });

    it('all peak names and regions should be non-empty strings', () => {
        peaks.forEach((peak, index) => {
            assertTrue(typeof peak.name === 'string' && peak.name.trim().length > 0, `Peak at index ${index} has an invalid name`);
            assertTrue(typeof peak.region === 'string' && peak.region.trim().length > 0, `Peak at index ${index} has an invalid region`);
        });
    });

    it('peak names and regions should not contain garbled (mis-encoded) characters', () => {
        peaks.forEach((peak, index) => {
            assertFalse(MOJIBAKE_PATTERN.test(peak.name), `Peak at index ${index} has a garbled name: ${peak.name}`);
            assertFalse(MOJIBAKE_PATTERN.test(peak.region), `Peak at index ${index} has a garbled region: ${peak.region}`);
        });
    });

    it('should keep apostrophes and accented characters intact in peak names', () => {
        const byId = Object.fromEntries(peaks.map(p => [p.id, p.name]));
        assertEqual(byId['a-mhaighdean'], 'A’ Mhaighdean');
        assertEqual(byId['beinn-dearg-mor'], 'Beinn Dearg Mòr');
        assertEqual(byId['sgurr-a-mhaim'], 'Sgurr a’ Mhaim');
        assertEqual(byId['the-devils-point'], 'The Devil’s Point');
    });

    it('all heights should be positive numbers', () => {
        peaks.forEach((peak, index) => {
            assertTrue(typeof peak.heightM === 'number' && peak.heightM > 0, `Peak at index ${index} has invalid height: ${peak.heightM}`);
        });
    });

    it('should not contain user completion status (kept separate from canonical data)', () => {
        peaks.forEach((peak, index) => {
            assertFalse('completed' in peak, `Peak at index ${index} should not store completion status`);
        });
    });
});

describe('Progress calculation', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('should report 0% with 100 remaining when nothing is completed', () => {
        const p = calculateProgress(new Set(), peaks);
        assertEqual(p.percentage, 0);
        assertEqual(p.completed, 0);
        assertEqual(p.remaining, 100);
        assertEqual(p.total, 100);
    });

    it('should report 25% when 25 peaks are completed', () => {
        const ids = new Set(peaks.slice(0, 25).map(p => p.id));
        const p = calculateProgress(ids, peaks);
        assertEqual(p.percentage, 25);
        assertEqual(p.completed, 25);
        assertEqual(p.remaining, 75);
    });

    it('should report 100% when all peaks are completed', () => {
        const p = calculateProgress(new Set(peaks.map(p => p.id)), peaks);
        assertEqual(p.percentage, 100);
        assertEqual(p.remaining, 0);
    });

    it('should ignore stored ids that are not in the dataset', () => {
        const p = calculateProgress(new Set(['not-a-real-peak', peaks[0].id]), peaks);
        assertEqual(p.completed, 1);
    });

    it('should handle an empty dataset', () => {
        assertEqual(calculateProgress(new Set(), []).percentage, 0);
    });
});

describe('Completion tracking', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('should mark a peak as completed', () => {
        const next = toggleCompleted(new Set(), peaks[0].id);
        assertTrue(next.has(peaks[0].id));
    });

    it('should unmark a completed peak', () => {
        const marked = toggleCompleted(new Set(), peaks[0].id);
        const unmarked = toggleCompleted(marked, peaks[0].id);
        assertFalse(unmarked.has(peaks[0].id));
    });

    it('should not mutate the original set', () => {
        const original = new Set();
        toggleCompleted(original, peaks[0].id);
        assertEqual(original.size, 0);
    });

    it('should round-trip completion status through storage serialization', () => {
        const ids = new Set([peaks[0].id, peaks[5].id]);
        const restored = parseStoredCompleted(serializeCompleted(ids));
        assertEqual(restored.size, 2);
        assertTrue(restored.has(peaks[5].id));
    });

    it('should recover from missing or corrupt stored data', () => {
        assertEqual(parseStoredCompleted(null).size, 0);
        assertEqual(parseStoredCompleted('{not json').size, 0);
        assertEqual(parseStoredCompleted('{"a":1}').size, 0);
    });
});

describe('Filtering', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('should return all 100 peaks with no filters', () => {
        assertEqual(filterPeaks(peaks, new Set()).length, 100);
    });

    it('should filter by region', () => {
        const region = peaks[0].region;
        const result = filterPeaks(peaks, new Set(), region, 'all');
        assertTrue(result.length > 0);
        assertTrue(result.every(p => p.region === region));
    });

    it('should filter by completed / remaining status', () => {
        const done = new Set([peaks[0].id, peaks[1].id]);
        assertEqual(filterPeaks(peaks, done, 'all', 'completed').length, 2);
        assertEqual(filterPeaks(peaks, done, 'all', 'remaining').length, 98);
    });

    it('should list unique sorted regions', () => {
        const regions = getRegions(peaks);
        assertEqual(new Set(regions).size, regions.length);
        assertEqual(JSON.stringify(regions), JSON.stringify([...regions].sort()));
    });
});

describe('Peak card rendering', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('should display name, region and height for every peak', () => {
        peaks.forEach(peak => {
            const html = createPeakCard(peak, false);
            assertTrue(html.includes(escapeHtml(peak.name)), `Card should include name of ${peak.id}`);
            assertTrue(html.includes(escapeHtml(peak.region)), `Card should include region of ${peak.id}`);
            assertTrue(html.includes(`${peak.heightM}m`), `Card should include height of ${peak.id}`);
        });
    });

    it('should render names with special characters correctly', () => {
        const peak = peaks.find(p => p.id === 'beinn-dearg-mor');
        const html = createPeakCard(peak, false);
        assertTrue(html.includes('Beinn Dearg Mòr'), 'Card should show the accented name');
        assertFalse(MOJIBAKE_PATTERN.test(html), 'Card should not contain garbled characters');
    });

    it('should visually distinguish completed peaks', () => {
        const done = createPeakCard(peaks[0], true);
        const notDone = createPeakCard(peaks[0], false);
        assertTrue(done.includes('class="peak-card completed"'), 'Completed card should have completed class');
        assertFalse(notDone.includes('peak-card completed'), 'Uncompleted card should not have completed class');
        assertTrue(done.includes('Completed'));
        assertTrue(notDone.includes('Not climbed'));
        assertTrue(/\.peak-card\.completed\s*\{/.test(readSource('src/style.css')), 'CSS should style completed cards');
    });

    it('should render an accessible toggle button', () => {
        const html = createPeakCard(peaks[0], false);
        assertTrue(html.includes('<button type="button"'), 'Should be a real button');
        assertTrue(html.includes('aria-pressed="false"'));
        assertTrue(html.includes(`aria-label="Mark as climbed: ${escapeHtml(peaks[0].name)}"`));
        assertTrue(createPeakCard(peaks[0], true).includes('aria-pressed="true"'));
    });

    it('should show a grid reference only when the data provides one', () => {
        const withRef = createPeakCard({ ...peaks[0], gridRef: 'NH 000 000' }, false);
        assertTrue(withRef.includes('Grid ref: NH 000 000'));
        const withoutRef = createPeakCard({ ...peaks[0], gridRef: undefined }, false);
        assertFalse(withoutRef.includes('Grid ref'));
    });

    it('should escape HTML in peak data', () => {
        const html = createPeakCard({ id: 'x', number: 1, name: '<script>', region: 'R', heightM: 1 }, false);
        assertFalse(html.includes('<script>'));
        assertTrue(html.includes('&lt;script&gt;'));
    });
});

describe('Responsive layout & accessibility markup', () => {
    it('index.html should set a responsive viewport', () => {
        assertTrue(/<meta name="viewport" content="width=device-width, initial-scale=1.0">/.test(readSource('src/index.html')));
    });

    it('style.css should include a mobile breakpoint with a single-column grid', () => {
        const css = readSource('src/style.css');
        const match = css.match(/@media \(max-width: 600px\)\s*\{([\s\S]*)\}\s*$/);
        assertTrue(match, 'Should have a max-width: 600px media query');
        assertTrue(/\.peaks-grid\s*\{\s*grid-template-columns:\s*1fr;/.test(match[1]), 'Mobile grid should be single column');
    });

    it('style.css should use a fluid auto-fill grid on desktop', () => {
        assertTrue(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/.test(readSource('src/style.css')));
    });

    it('filter controls should have associated labels', () => {
        const html = readSource('src/index.html');
        assertTrue(html.includes('<label for="region-filter">'));
        assertTrue(html.includes('<label for="status-filter">'));
    });

    it('progress bar should expose progressbar semantics', () => {
        assertTrue(readSource('src/index.html').includes('role="progressbar"'));
    });
});

describe('Region progress calculation', () => {
    let peaks;
    let regionCounts;
    beforeAll(() => {
        peaks = loadPeaksData();
        regionCounts = {};
        peaks.forEach(p => { regionCounts[p.region] = (regionCounts[p.region] || 0) + 1; });
    });

    const peaksIn = region => peaks.filter(p => p.region === region);
    const byRegion = result => Object.fromEntries(result.map(r => [r.region, r]));

    it('should return one entry per region in data/peaks.json, sorted alphabetically', () => {
        const result = calculateRegionProgress(new Set(), peaks);
        const names = result.map(r => r.region);
        const expected = Object.keys(regionCounts).sort();
        assertEqual(JSON.stringify(names), JSON.stringify(expected), 'Regions should match the dataset, sorted');
        assertEqual(new Set(names).size, names.length, 'Each region should appear once');
        assertEqual(JSON.stringify(names), JSON.stringify(getRegions(peaks)), 'Should match getRegions ordering');
    });

    it('should report the correct total peaks for each region (summing to 100)', () => {
        const result = calculateRegionProgress(new Set(), peaks);
        result.forEach(r => assertEqual(r.total, regionCounts[r.region], `Total for ${r.region}`));
        assertEqual(result.reduce((sum, r) => sum + r.total, 0), 100, 'Region totals should sum to 100');
    });

    it('should report 0 completed and 0% for a region with zero completed peaks', () => {
        const lake = peaksIn('Lake District');
        const done = new Set(lake.map(p => p.id));
        const snowdonia = byRegion(calculateRegionProgress(done, peaks))['Eryri (Snowdonia)'];
        assertEqual(snowdonia.completed, 0);
        assertEqual(snowdonia.total, regionCounts['Eryri (Snowdonia)']);
        assertEqual(snowdonia.percentage, 0);
        calculateRegionProgress(new Set(), peaks).forEach(r => {
            assertEqual(r.completed, 0, `${r.region} completed with empty set`);
            assertEqual(r.percentage, 0, `${r.region} percentage with empty set`);
        });
    });

    it('should report 100% for a fully completed region without affecting other regions', () => {
        const lake = peaksIn('Lake District');
        const done = new Set(lake.map(p => p.id));
        const result = byRegion(calculateRegionProgress(done, peaks));
        assertEqual(result['Lake District'].completed, lake.length);
        assertEqual(result['Lake District'].total, lake.length);
        assertEqual(result['Lake District'].percentage, 100);
        Object.values(result)
            .filter(r => r.region !== 'Lake District')
            .forEach(r => assertEqual(r.completed, 0, `${r.region} should be unaffected`));
    });

    it('should report 100% for every region when all peaks are completed', () => {
        calculateRegionProgress(new Set(peaks.map(p => p.id)), peaks).forEach(r => {
            assertEqual(r.completed, r.total, `${r.region} completed`);
            assertEqual(r.percentage, 100, `${r.region} percentage`);
        });
    });

    it('should calculate a rounded partial percentage', () => {
        const lake = peaksIn('Lake District');
        const done = new Set(lake.slice(0, 5).map(p => p.id));
        const r = byRegion(calculateRegionProgress(done, peaks))['Lake District'];
        assertEqual(r.completed, 5);
        assertEqual(r.percentage, Math.round((5 / lake.length) * 100));
    });

    it('should ignore stored ids that are not in the dataset', () => {
        const result = calculateRegionProgress(new Set(['not-a-real-peak']), peaks);
        assertEqual(result.reduce((sum, r) => sum + r.completed, 0), 0);
    });

    it('should return an empty list for an empty dataset', () => {
        assertEqual(calculateRegionProgress(new Set(), []).length, 0);
    });

    it('should be pure (not mutate its inputs)', () => {
        const done = new Set([peaks[0].id]);
        const copy = JSON.stringify(peaks);
        calculateRegionProgress(done, peaks);
        assertEqual(done.size, 1);
        assertEqual(JSON.stringify(peaks), copy);
    });

    it('should update when a peak is marked and then unmarked complete', () => {
        const peak = peaks[0];
        const before = byRegion(calculateRegionProgress(new Set(), peaks))[peak.region];
        const marked = toggleCompleted(new Set(), peak.id);
        const afterMark = byRegion(calculateRegionProgress(marked, peaks))[peak.region];
        assertEqual(afterMark.completed, before.completed + 1);
        const unmarked = toggleCompleted(marked, peak.id);
        const afterUnmark = byRegion(calculateRegionProgress(unmarked, peaks))[peak.region];
        assertEqual(afterUnmark.completed, before.completed);
    });
});

describe('Region progress rendering', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('should show the region name, completed / total and percentage', () => {
        const html = createRegionProgressItem({ region: 'Lake District', completed: 5, total: 25, percentage: 20 });
        assertTrue(html.includes('Lake District'));
        assertTrue(html.includes('5 / 25 peaks'));
        assertTrue(html.includes('20%'));
    });

    it('should render an accessible progressbar for every region', () => {
        const done = new Set(peaks.slice(0, 10).map(p => p.id));
        calculateRegionProgress(done, peaks).forEach(r => {
            const html = createRegionProgressItem(r);
            assertTrue(html.includes('role="progressbar"'), `${r.region} should have role=progressbar`);
            assertTrue(html.includes(`aria-valuenow="${r.percentage}"`), `${r.region} aria-valuenow`);
            assertTrue(html.includes('aria-valuemin="0"'), `${r.region} aria-valuemin`);
            assertTrue(html.includes('aria-valuemax="100"'), `${r.region} aria-valuemax`);
            assertTrue(html.includes(`aria-label="${escapeHtml(r.region)} completion"`), `${r.region} accessible name`);
            assertTrue(html.includes(`${r.completed} / ${r.total} ${r.total === 1 ? 'peak' : 'peaks'} ·`), `${r.region} count`);
        });
    });

    it('should mark fully completed regions with a complete class', () => {
        assertTrue(createRegionProgressItem({ region: 'Dartmoor', completed: 1, total: 1, percentage: 100 })
            .includes('class="region-progress-item complete"'));
        assertFalse(createRegionProgressItem({ region: 'Dartmoor', completed: 0, total: 1, percentage: 0 })
            .includes('region-progress-item complete'));
    });

    it('should escape HTML in region names', () => {
        const html = createRegionProgressItem({ region: '<b>X</b>', completed: 0, total: 1, percentage: 0 });
        assertFalse(html.includes('<b>'));
        assertTrue(html.includes('&lt;b&gt;X&lt;/b&gt;'));
    });

    it('index.html should contain a labelled region progress section', () => {
        const html = readSource('src/index.html');
        assertTrue(html.includes('id="region-progress-list"'));
        assertTrue(html.includes('aria-labelledby="region-progress-heading"'));
        assertTrue(html.includes('id="region-progress-heading"'));
    });

    it('app.js should re-render region progress whenever overall progress updates', () => {
        const js = readSource('src/app.js');
        const fn = js.match(/function updateProgressSummary\(\)\s*\{([\s\S]*?)\n\}/);
        assertTrue(fn, 'updateProgressSummary should exist');
        assertTrue(fn[1].includes('renderRegionProgress()'), 'updateProgressSummary should call renderRegionProgress');
        const toggle = js.match(/function handleToggleComplete\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assertTrue(toggle && toggle[1].includes('setPeakToggled(peakId)'), 'Card toggle should use the shared toggle path');
        const shared = js.match(/function setPeakToggled\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assertTrue(shared && shared[1].includes('updateProgressSummary()'), 'Toggling should update progress');
        assertTrue(js.includes('calculateRegionProgress(completedPeaks, peaks)'));
    });
});

describe('Region progress responsive layout', () => {
    let css;
    beforeAll(() => { css = readSource('src/style.css'); });

    it('should remove default list styling and use a fluid grid on desktop', () => {
        const rule = css.match(/\.region-progress-list\s*\{([^}]*)\}/);
        assertTrue(rule, 'Should have a .region-progress-list rule');
        assertTrue(/list-style:\s*none/.test(rule[1]), 'List bullets should be removed');
        assertTrue(/display:\s*grid/.test(rule[1]), 'Should be a grid');
        const min = rule[1].match(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\((\d+)px,\s*1fr\)\)/);
        assertTrue(min, 'Desktop should use an auto-fill grid');
        // 360px screen - 2 x 1rem main padding - 2 x 1.5rem card padding = 280px available.
        assertTrue(Number(min[1]) <= 280, 'Minimum column width should fit a 360px-wide screen');
    });

    it('should collapse to a single column in the mobile breakpoint', () => {
        const match = css.match(/@media \(max-width: 600px\)\s*\{([\s\S]*)\}\s*$/);
        assertTrue(match, 'Should have a max-width: 600px media query');
        assertTrue(/\.region-progress-list\s*\{\s*grid-template-columns:\s*1fr;/.test(match[1]), 'Region list should be single column on mobile');
    });

    it('should let region names and counts wrap rather than overflow on narrow screens', () => {
        const header = css.match(/\.region-progress-header\s*\{([^}]*)\}/);
        assertTrue(header, 'Should have a .region-progress-header rule');
        assertTrue(/display:\s*flex/.test(header[1]));
        assertTrue(/flex-wrap:\s*wrap/.test(header[1]), 'Header should wrap on narrow screens');
        const name = css.match(/\.region-name\s*\{([^}]*)\}/);
        assertTrue(name && /overflow-wrap:\s*anywhere/.test(name[1]), 'Long region names should wrap');
    });
});

describe('Local server', () => {
    let server;
    let baseUrl;

    beforeAll(() => new Promise(resolve => {
        server = createServer();
        server.listen(0, () => {
            baseUrl = `http://localhost:${server.address().port}`;
            resolve();
        });
    }));

    afterAll(() => new Promise(resolve => {
        // Drop any keep-alive sockets left open by fetch() so the server can
        // close fully and the process can exit naturally.
        server.closeAllConnections();
        server.close(() => resolve());
    }));

    it('should serve the app at /', async () => {
        const res = await fetch(`${baseUrl}/`);
        assertEqual(res.status, 200);
        assertTrue((await res.text()).includes('Trail 100 Tracker'));
    });

    it('should serve all assets referenced by index.html', async () => {
        for (const asset of ['/src/style.css', '/src/app.js', '/src/peak-utils.js', '/src/peak-details-controller.js']) {
            const res = await fetch(`${baseUrl}${asset}`);
            assertEqual(res.status, 200, `${asset} should be served`);
            await res.arrayBuffer();
        }
    });

    it('should serve the peak dataset from /data/peaks.json', async () => {
        const res = await fetch(`${baseUrl}/data/peaks.json?v=1`);
        assertEqual(res.status, 200);
        assertEqual((await res.json()).length, 100);
    });

    it('should not serve files outside src/ and data/', async () => {
        const res1 = await fetch(`${baseUrl}/package.json`);
        assertEqual(res1.status, 404);
        await res1.arrayBuffer();
        const res2 = await fetch(`${baseUrl}/src/..%2Fpackage.json`);
        assertEqual(res2.status, 404);
        await res2.arrayBuffer();
    });

    it('should serve peak media data and local peak photos with an image content type', async () => {
        const res = await fetch(`${baseUrl}/data/peak-media.json`);
        assertEqual(res.status, 200);
        const media = await res.json();
        const entry = Object.values(media).find(m => m && m.image && m.image.src);
        assertTrue(entry, 'At least one photo to check');
        const img = await fetch(`${baseUrl}${entry.image.src}`);
        assertEqual(img.status, 200);
        assertTrue(img.headers.get('content-type').startsWith('image/'), 'Photo served as an image');
        await img.arrayBuffer();
    });

    it('app.js should load the dataset from data/peaks.json', () => {
        assertTrue(readSource('src/app.js').includes("'/data/peaks.json'"));
    });
});

// ---------------------------------------------------------------------------
// TASK-003: peak details view
// ---------------------------------------------------------------------------
describe('Peak details rendering (createPeakDetails)', () => {
    let peaks;
    let peak;
    beforeAll(() => {
        peaks = loadPeaksData();
        peak = peaks.find(p => p.id === 'beinn-dearg-mor');
    });

    // Text content of the <dd> that follows the given <dt> label, or null.
    const detailValue = (html, label) => {
        const m = html.match(new RegExp(`<dt>${label}</dt>\\s*<dd[^>]*>([^<]*)</dd>`));
        return m ? m[1].trim() : null;
    };

    it('should show the peak number, name, region, height in metres and status', () => {
        const html = createPeakDetails(peak, false);
        assertTrue(html.includes('<h2 id="peak-details-title" class="peak-details-title">Beinn Dearg Mòr</h2>'), 'Name heading');
        assertEqual(detailValue(html, 'Peak number'), `#${peak.number}`);
        assertEqual(detailValue(html, 'Region'), escapeHtml(peak.region));
        assertEqual(detailValue(html, 'Height'), `${peak.heightM}m`);
        assertEqual(detailValue(html, 'Status'), 'Not climbed');
        assertFalse(MOJIBAKE_PATTERN.test(html), 'No garbled characters');
    });

    it('should render every peak in the dataset with its own data', () => {
        peaks.forEach(p => {
            const html = createPeakDetails(p, false);
            assertTrue(html.includes(`data-peak-id="${escapeHtml(p.id)}"`), `${p.id} id`);
            assertEqual(detailValue(html, 'Peak number'), `#${p.number}`, `${p.id} number`);
            assertEqual(detailValue(html, 'Region'), escapeHtml(p.region), `${p.id} region`);
            assertEqual(detailValue(html, 'Height'), `${p.heightM}m`, `${p.id} height`);
        });
    });

    it('should show the grid reference when the peak has one', () => {
        const withRef = { ...peak, gridRef: 'NH 019 718' };
        assertTrue(hasGridRef(withRef));
        const html = createPeakDetails(withRef, false);
        assertEqual(detailValue(html, 'Grid reference'), 'NH 019 718');
    });

    it('should omit the grid reference row entirely when the peak has none', () => {
        for (const variant of [peak, { ...peak, gridRef: undefined }, { ...peak, gridRef: '' }, { ...peak, gridRef: '   ' }, { ...peak, gridRef: null }]) {
            const html = createPeakDetails(variant, false);
            assertFalse(html.includes('Grid reference'), 'No grid reference label');
            assertFalse(/grid ref/i.test(html), 'No grid ref text at all');
            assertFalse(/undefined|null|N\/A|Unknown/.test(html), 'No placeholder or misleading value');
        }
    });

    it('should not show a grid reference for any dataset peak (none have one in data/peaks.json)', () => {
        peaks.filter(p => !hasGridRef(p)).forEach(p => {
            assertFalse(createPeakDetails(p, false).includes('Grid reference'), `${p.id} should not show a grid reference`);
        });
    });

    it('should reflect completion status and offer the matching toggle', () => {
        const done = createPeakDetails(peak, true);
        assertEqual(detailValue(done, 'Status'), '✓ Completed');
        assertTrue(done.includes('class="peak-details completed"'));
        assertTrue(done.includes('aria-pressed="true"'));
        assertTrue(done.includes(`aria-label="Mark as not climbed: Beinn Dearg Mòr"`));

        const notDone = createPeakDetails(peak, false);
        assertTrue(notDone.includes('class="peak-details remaining"'));
        assertTrue(notDone.includes('aria-pressed="false"'));
        assertTrue(notDone.includes(`aria-label="Mark as climbed: Beinn Dearg Mòr"`));
    });

    it('should include a visible, labelled close control and a real toggle button', () => {
        const html = createPeakDetails(peak, false);
        assertTrue(/<button type="button" class="details-close-button" aria-label="Close details for Beinn Dearg Mòr">[\s\S]*Close\s*<\/button>/.test(html), 'Visible Close button');
        assertTrue(/<button type="button" class="toggle-button details-toggle-button mark-complete"/.test(html), 'Toggle is a button');
    });

    it('should escape HTML in peak data', () => {
        const html = createPeakDetails({ id: 'x"y', number: 1, name: '<img src=x>', region: '<b>R</b>', heightM: 1, gridRef: '<i>G</i>' }, false);
        assertFalse(/<img|<b>|<i>/.test(html));
        assertTrue(html.includes('&lt;img src=x&gt;'));
        assertTrue(html.includes('data-peak-id="x&quot;y"'));
    });

    it('should be pure (same output for same input, input not mutated)', () => {
        const copy = JSON.stringify(peak);
        assertEqual(createPeakDetails(peak, true), createPeakDetails(peak, true));
        assertEqual(JSON.stringify(peak), copy);
    });

    it('should not invent fields that are not in the dataset', () => {
        const html = createPeakDetails(peak, false);
        const labels = [...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map(m => m[1]);
        assertEqual(JSON.stringify(labels), JSON.stringify(['Peak number', 'Region', 'Height', 'Status']));
    });
});

describe('Peak card "View details" control', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('every card should have a details button with a descriptive accessible name', () => {
        peaks.forEach(p => {
            const html = createPeakCard(p, false);
            const name = escapeHtml(p.name);
            assertTrue(html.includes(`<button type="button" class="details-button" data-peak-id="${escapeHtml(p.id)}" aria-haspopup="dialog" aria-label="View details for ${name}">`), `${p.id} details button`);
            assertTrue(/>\s*View details\s*<\/button>/.test(html), `${p.id} visible label`);
        });
    });

    it('index.html should contain a labelled native dialog for the details view', () => {
        const html = readSource('src/index.html');
        assertTrue(/<dialog id="peak-details"[^>]*aria-labelledby="peak-details-title"/.test(html));
    });

    it('filterPeaks should keep the pinned peak visible even if it no longer matches', () => {
        const done = new Set([peaks[0].id]);
        const completedOnly = filterPeaks(peaks, new Set(), 'all', 'completed', peaks[0].id);
        assertEqual(completedOnly.length, 1);
        assertEqual(completedOnly[0].id, peaks[0].id);
        assertEqual(filterPeaks(peaks, done, 'all', 'remaining', null).length, 99);
        // Pinned peak keeps its dataset position.
        const ids = filterPeaks(peaks, new Set([peaks[0].id, peaks[2].id]), 'all', 'completed', peaks[1].id).map(p => p.id);
        assertEqual(JSON.stringify(ids), JSON.stringify([peaks[0].id, peaks[1].id, peaks[2].id]));
    });
});

// Tiny fake of the DOM pieces the controller uses, so its behaviour can be
// tested in Node. Elements are created per class found in the dialog HTML.
function createFakeEnvironment(peaks) {
    const focus = { current: null };
    class FakeElement {
        constructor(className, label) { this.className = className; this.label = label; }
        focus() { focus.current = this; }
        closest(selector) { return selector === `.${this.className}` ? this : null; }
    }
    const listeners = {};
    let html = '';
    let elements = {};
    const calls = { showModal: 0, show: 0 };
    const dialog = {
        open: false,
        modal: false,
        get innerHTML() { return html; },
        set innerHTML(value) {
            html = value;
            elements = {};
            for (const cls of ['details-close-button', 'details-toggle-button']) {
                if (value.includes(cls)) elements[`.${cls}`] = new FakeElement(cls, 'dialog');
            }
        },
        querySelector(selector) { return elements[selector] || null; },
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        showModal() { calls.showModal++; this.open = true; this.modal = true; },
        show() { calls.show++; this.open = true; },
        close() {
            if (!this.open) return;
            this.open = false;
            this.modal = false;
            (listeners.close || []).forEach(fn => fn({ type: 'close' }));
        },
        dispatch(type, event) {
            const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event };
            (listeners[type] || []).forEach(fn => fn(ev));
            return ev;
        },
    };

    let completed = new Set();
    const visible = new Set(peaks.map(p => p.id));
    // Openers are re-created on each "render" like real re-rendered cards.
    let openers = {};
    const renderCards = () => {
        openers = {};
        visible.forEach(id => { openers[id] = new FakeElement('details-button', id); });
    };
    renderCards();
    const fallback = new FakeElement('peaks-heading', 'fallback');
    const toggles = [];

    const controller = createPeakDetailsController({
        dialog,
        renderDetails: id => {
            const peak = peaks.find(p => p.id === id);
            return peak ? createPeakDetails(peak, completed.has(id)) : null;
        },
        togglePeak: id => { toggles.push(id); completed = toggleCompleted(completed, id); renderCards(); },
        findOpener: id => openers[id] || null,
        fallbackFocus: () => fallback,
    });

    return {
        dialog, controller, focus, calls, fallback, toggles, visible,
        get completed() { return completed; },
        opener: id => openers[id],
        renderCards,
        clickIn: selector => dialog.dispatch('click', { target: dialog.querySelector(selector) }),
    };
}

describe('Peak details controller (open, close, focus, toggle)', () => {
    let peaks;
    beforeAll(() => { peaks = loadPeaksData(); });

    it('should open as a modal dialog showing the chosen peak and move focus inside', () => {
        const env = createFakeEnvironment(peaks);
        env.opener(peaks[3].id).focus();
        env.controller.open(peaks[3].id);
        assertTrue(env.dialog.open, 'Dialog should be open');
        assertTrue(env.dialog.modal, 'Dialog should be modal (showModal makes the page behind inert)');
        assertEqual(env.calls.showModal, 1);
        assertEqual(env.calls.show, 0, 'Non-modal show() must not be used');
        assertTrue(env.dialog.innerHTML.includes(`data-peak-id="${peaks[3].id}"`));
        assertEqual(env.focus.current, env.dialog.querySelector('.details-close-button'), 'Focus should move to the close button');
        assertEqual(env.controller.currentPeakId, peaks[3].id);
    });

    it('should do nothing for an unknown peak id', () => {
        const env = createFakeEnvironment(peaks);
        env.controller.open('not-a-real-peak');
        assertFalse(env.dialog.open);
        assertEqual(env.controller.currentPeakId, null);
    });

    it('should close with the visible close control and return focus to the opener', () => {
        const env = createFakeEnvironment(peaks);
        const id = peaks[0].id;
        env.opener(id).focus();
        env.controller.open(id);
        env.clickIn('.details-close-button');
        assertFalse(env.dialog.open, 'Dialog should be closed');
        assertEqual(env.dialog.innerHTML, '', 'Dialog content should be cleared');
        assertEqual(env.focus.current, env.opener(id), 'Focus should return to the View details button');
    });

    it('should close with the Escape key and return focus to the opener', () => {
        const env = createFakeEnvironment(peaks);
        const id = peaks[1].id;
        env.controller.open(id);
        const ev = env.dialog.dispatch('keydown', { key: 'Escape' });
        assertTrue(ev.defaultPrevented);
        assertFalse(env.dialog.open);
        assertEqual(env.focus.current, env.opener(id));
    });

    it('should ignore other keys', () => {
        const env = createFakeEnvironment(peaks);
        env.controller.open(peaks[1].id);
        env.dialog.dispatch('keydown', { key: 'Tab' });
        env.dialog.dispatch('keydown', { key: 'Enter' });
        assertTrue(env.dialog.open);
    });

    it('should toggle completion from the details view and re-render it', () => {
        const env = createFakeEnvironment(peaks);
        const id = peaks[2].id;
        env.controller.open(id);
        env.clickIn('.details-toggle-button');
        assertEqual(JSON.stringify(env.toggles), JSON.stringify([id]), 'Shared toggle path should be used once');
        assertTrue(env.completed.has(id));
        assertTrue(env.dialog.open, 'Dialog stays open after toggling');
        assertTrue(env.dialog.innerHTML.includes('✓ Completed'));
        assertTrue(env.dialog.innerHTML.includes('aria-pressed="true"'));
        assertEqual(env.focus.current, env.dialog.querySelector('.details-toggle-button'), 'Focus stays on the toggle');

        env.clickIn('.details-toggle-button');
        assertFalse(env.completed.has(id), 'Second click unmarks');
        assertTrue(env.dialog.innerHTML.includes('Not climbed'));
        assertTrue(env.dialog.innerHTML.includes('aria-pressed="false"'));
    });

    it('should return focus to the re-rendered opener after toggling', () => {
        const env = createFakeEnvironment(peaks);
        const id = peaks[4].id;
        const original = env.opener(id);
        env.controller.open(id);
        env.clickIn('.details-toggle-button');
        env.controller.close();
        assertFalse(env.focus.current === original, 'Old element was replaced by re-render');
        assertEqual(env.focus.current, env.opener(id), 'Focus goes to the current View details button of the same peak');
    });

    it('should fall back to a sensible target only when the opener no longer exists', () => {
        const env = createFakeEnvironment(peaks);
        const id = peaks[5].id;
        env.controller.open(id);
        env.visible.delete(id);
        env.renderCards();
        env.controller.close();
        assertEqual(env.focus.current, env.fallback);
    });

    it('app.js should wire the controller to the shared toggle path and card opener', () => {
        const js = readSource('src/app.js');
        assertTrue(js.includes("import { createPeakDetailsController } from './peak-details-controller.js';"));
        assertTrue(js.includes('togglePeak: setPeakToggled'), 'Details toggle uses the same path as cards (cards, overall and region progress)');
        assertTrue(js.includes("findOpener: peakId => findCardButton('.details-button', peakId)"));
        assertTrue(js.includes('filterPeaks(peaks, completedPeaks, regionFilter, statusFilter, pinnedPeakId)'), 'Opener card is kept visible');
    });
});

describe('Peak details responsive layout', () => {
    let css;
    let mobile;
    beforeAll(() => {
        css = readSource('src/style.css');
        mobile = css.match(/@media \(max-width: 600px\)\s*\{([\s\S]*)\}\s*$/)[1];
    });

    it('should never be wider than the viewport on desktop', () => {
        const rule = css.match(/\.peak-details-dialog\s*\{([^}]*)\}/);
        assertTrue(rule, 'Should have a .peak-details-dialog rule');
        assertTrue(/max-width:\s*calc\(100vw - 2rem\)/.test(rule[1]));
        assertTrue(/max-height:\s*calc\(100vh - 2rem\)/.test(rule[1]));
        assertTrue(/overflow-y:\s*auto/.test(rule[1]), 'Tall content should scroll');
    });

    it('should fill a 360px-wide screen in the mobile breakpoint', () => {
        const rule = mobile.match(/\.peak-details-dialog\s*\{([^}]*)\}/);
        assertTrue(rule, 'Mobile breakpoint should size the dialog');
        assertTrue(/width:\s*calc\(100vw - 1rem\)/.test(rule[1]));
        assertTrue(/max-width:\s*calc\(100vw - 1rem\)/.test(rule[1]));
    });

    it('should let long names and values wrap instead of overflowing', () => {
        assertTrue(/\.peak-details-title\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css));
        assertTrue(/\.details-row dd\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css));
        assertTrue(/\.details-row\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
        assertTrue(/\.peak-details-header\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
    });
});


// ---------------------------------------------------------------------------
// TASK-004: photo gallery, pagination, peak photos and routes
// ---------------------------------------------------------------------------
function loadMediaData() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'peak-media.json'), 'utf-8'));
}

const anchors = html => [...html.matchAll(/<a\b[^>]*>/g)].map(m => m[0]);

describe('Pagination helpers', () => {
    const items = Array.from({ length: 100 }, (_, i) => i + 1);

    it('PAGE_SIZE should be 12', () => {
        assertEqual(PAGE_SIZE, 12);
    });

    it('getPageCount should round up and always return at least 1', () => {
        assertEqual(getPageCount(100, 12), 9);
        assertEqual(getPageCount(96, 12), 8);
        assertEqual(getPageCount(97, 12), 9);
        assertEqual(getPageCount(12, 12), 1);
        assertEqual(getPageCount(13, 12), 2);
        assertEqual(getPageCount(1, 12), 1);
        assertEqual(getPageCount(0, 12), 1);
        assertEqual(getPageCount(100), 9, 'Defaults to PAGE_SIZE');
    });

    it('clampPage should keep pages within 1..pageCount', () => {
        assertEqual(clampPage(1, 9), 1);
        assertEqual(clampPage(5, 9), 5);
        assertEqual(clampPage(9, 9), 9);
        assertEqual(clampPage(10, 9), 9);
        assertEqual(clampPage(999, 9), 9);
        assertEqual(clampPage(0, 9), 1);
        assertEqual(clampPage(-3, 9), 1);
        assertEqual(clampPage(NaN, 9), 1);
        assertEqual(clampPage('abc', 9), 1);
        assertEqual(clampPage(undefined, 9), 1);
        assertEqual(clampPage('3', 9), 3);
        assertEqual(clampPage(3.7, 9), 3);
        assertEqual(clampPage(4, 0), 1, 'Zero pages behaves like one page');
    });

    it('paginate should slice the first, middle and last pages', () => {
        const first = paginate(items, 1, 12);
        assertEqual(JSON.stringify(first.items), JSON.stringify(items.slice(0, 12)));
        assertEqual(first.page, 1);
        assertEqual(first.pageCount, 9);
        assertEqual(first.start, 1);
        assertEqual(first.end, 12);
        assertEqual(first.totalItems, 100);

        const second = paginate(items, 2, 12);
        assertEqual(JSON.stringify(second.items), JSON.stringify(items.slice(12, 24)));
        assertEqual(second.start, 13);
        assertEqual(second.end, 24);

        const last = paginate(items, 9, 12);
        assertEqual(JSON.stringify(last.items), JSON.stringify([97, 98, 99, 100]));
        assertEqual(last.start, 97);
        assertEqual(last.end, 100);
    });

    it('paginate should clamp out-of-range pages', () => {
        assertEqual(paginate(items, 50, 12).page, 9);
        assertEqual(JSON.stringify(paginate(items, 50, 12).items), JSON.stringify([97, 98, 99, 100]));
        assertEqual(paginate(items, 0, 12).page, 1);
        assertEqual(paginate(items, -2, 12).items[0], 1);
        // Filtering down to fewer results moves a high page back into range.
        const filtered = items.slice(0, 5);
        const result = paginate(filtered, 4, 12);
        assertEqual(result.page, 1);
        assertEqual(result.pageCount, 1);
        assertEqual(result.items.length, 5);
    });

    it('paginate should handle an empty list', () => {
        const result = paginate([], 3, 12);
        assertEqual(result.items.length, 0);
        assertEqual(result.page, 1);
        assertEqual(result.pageCount, 1);
        assertEqual(result.start, 0);
        assertEqual(result.end, 0);
    });

    it('paginate should cover every item exactly once across pages and not mutate input', () => {
        const copy = JSON.stringify(items);
        const seen = [];
        const { pageCount } = paginate(items, 1, 12);
        for (let p = 1; p <= pageCount; p++) seen.push(...paginate(items, p, 12).items);
        assertEqual(JSON.stringify(seen), copy);
        assertEqual(JSON.stringify(items), copy);
    });

    it('pageForIndex should find the page containing an item', () => {
        assertEqual(pageForIndex(0), 1);
        assertEqual(pageForIndex(11), 1);
        assertEqual(pageForIndex(12), 2);
        assertEqual(pageForIndex(99), 9);
    });

    it('page count should reflect filtered peaks', () => {
        const peaks = loadPeaksData();
        const region = getRegions(peaks)[0];
        const filtered = filterPeaks(peaks, new Set(), region, 'all');
        assertEqual(paginate(filtered, 1).pageCount, Math.max(1, Math.ceil(filtered.length / 12)));
    });
});

describe('Pagination rendering (createPagination)', () => {
    const numbered = html => [...html.matchAll(/<button[^>]*class="page-button page-number[^"]*"[^>]*>/g)].map(m => m[0]);

    it('should render Previous, Next and one numbered button per page', () => {
        const html = createPagination(1, 9);
        assertTrue(html.includes('<nav class="pagination" aria-label="Peak gallery pages">'));
        assertEqual(numbered(html).length, 9);
        assertTrue(/<button type="button" class="page-button page-prev"[^>]*>[\s\S]*Previous/.test(html));
        assertTrue(/<button type="button" class="page-button page-next"[^>]*>[\s\S]*Next/.test(html));
    });

    it('should mark only the current page with aria-current="page"', () => {
        const html = createPagination(4, 9);
        assertEqual((html.match(/aria-current="page"/g) || []).length, 1);
        assertTrue(/data-page="4" aria-label="Page 4" aria-current="page">4</.test(html));
    });

    it('should disable Previous on the first page and Next on the last', () => {
        const first = createPagination(1, 9);
        assertTrue(/class="page-button page-prev"[^>]*disabled/.test(first), 'Previous disabled on page 1');
        assertFalse(/class="page-button page-next"[^>]*disabled/.test(first), 'Next enabled on page 1');
        const last = createPagination(9, 9);
        assertFalse(/class="page-button page-prev"[^>]*disabled/.test(last), 'Previous enabled on last page');
        assertTrue(/class="page-button page-next"[^>]*disabled/.test(last), 'Next disabled on last page');
        const middle = createPagination(5, 9);
        assertFalse(/disabled/.test(middle));
        assertTrue(/page-prev" data-page="4"/.test(middle));
        assertTrue(/page-next" data-page="6"/.test(middle));
    });

    it('should clamp an out-of-range current page', () => {
        const html = createPagination(20, 3);
        assertTrue(/data-page="3" aria-label="Page 3" aria-current="page"/.test(html));
        assertEqual(numbered(html).length, 3);
    });
});

describe('Peak media data (data/peak-media.json)', () => {
    let peaks;
    let media;
    beforeAll(() => { peaks = loadPeaksData(); media = loadMediaData(); });

    it('should only contain entries for peaks in data/peaks.json', () => {
        const ids = new Set(peaks.map(p => p.id));
        Object.keys(media).forEach(id => assertTrue(ids.has(id), `${id} is not a Trail 100 peak`));
    });

    it('every image src should point to an existing local file under src/assets/peaks/', () => {
        Object.entries(media).forEach(([id, entry]) => {
            if (!hasPhoto(entry)) return;
            assertTrue(entry.image.src.startsWith('/src/assets/peaks/'), `${id} image should be local`);
            assertTrue(fs.existsSync(path.join(ROOT, entry.image.src)), `${id} image file should exist`);
        });
    });

    it('routes should be null or have a url; gpxUrl is a URL or null (tests do not assume how many exist)', () => {
        Object.entries(media).forEach(([id, entry]) => {
            if (entry.route === null) return;
            assertTrue(hasRoute(entry), `${id} route should have a url`);
            const { gpxUrl, gpxNote } = entry.route;
            assertTrue(gpxUrl === null || /^https?:\/\//.test(gpxUrl), `${id} gpxUrl should be a URL or null`);
            if (gpxNote !== undefined) assertTrue(typeof gpxNote === 'string', `${id} gpxNote should be text`);
        });
    });
});

describe('Photo card rendering', () => {
    let peaks;
    let media;
    beforeAll(() => { peaks = loadPeaksData(); media = loadMediaData(); });

    it('should render a lazy-loaded photo with descriptive alt text from the media data', () => {
        peaks.forEach(peak => {
            const entry = media[peak.id];
            if (!hasPhoto(entry)) return;
            const html = createPeakCard(peak, false, entry);
            assertTrue(html.includes(`src="${escapeHtml(entry.image.src)}"`), `${peak.id} src`);
            assertTrue(html.includes(`alt="${escapeHtml(entry.image.alt)}"`), `${peak.id} alt`);
            assertTrue(html.includes('loading="lazy"'), `${peak.id} lazy`);
            assertTrue(html.includes('class="peak-photo"'), `${peak.id} fixed-ratio frame`);
        });
    });

    it('should still show number, name, region, height, status and both controls', () => {
        const peak = peaks[0];
        const html = createPeakCard(peak, true, media[peak.id]);
        assertTrue(html.includes(`#${peak.number}`));
        assertTrue(html.includes(escapeHtml(peak.name)));
        assertTrue(html.includes(escapeHtml(peak.region)));
        assertTrue(html.includes(`${peak.heightM}m`));
        assertTrue(html.includes('✓ Completed'));
        assertTrue(html.includes('class="toggle-button mark-remaining"'));
        assertTrue(html.includes('class="details-button"'));
    });

    it('should fall back to a peak-based alt text when none is provided', () => {
        const html = createCardPhoto(peaks[0], { image: { src: '/src/assets/peaks/x.jpg' } });
        assertTrue(html.includes(`alt="${escapeHtml(`${peaks[0].name}, ${peaks[0].region}`)}"`));
    });

    it('should keep the photo frame but render no image when there is no photo', () => {
        for (const entry of [null, undefined, {}, { image: null }, { image: { src: '' } }]) {
            const html = createPeakCard(peaks[0], false, entry);
            assertFalse(html.includes('<img'), 'No image element');
            assertTrue(html.includes('peak-photo no-photo'), 'Placeholder frame keeps the layout');
        }
    });

    it('should escape HTML in media data', () => {
        const html = createCardPhoto(peaks[0], { image: { src: '/a.jpg" onerror="x', alt: '<b>alt</b>' } });
        assertFalse(html.includes('onerror="x'));
        assertFalse(html.includes('<b>'));
    });

    it('style.css should give the card photo a fixed aspect ratio', () => {
        const css = readSource('src/style.css');
        assertTrue(/\.peak-photo\s*\{[^}]*aspect-ratio:\s*4 \/ 3/.test(css));
        assertTrue(/\.peak-photo img\s*\{[^}]*object-fit:\s*cover/.test(css));
    });
});

describe('Details photo rendering (createDetailsPhoto)', () => {
    let peaks;
    let media;
    beforeAll(() => { peaks = loadPeaksData(); media = loadMediaData(); });

    it('should show the large photo, credit, linked licence and source link', () => {
        const peak = peaks.find(p => media[p.id] && media[p.id].image.licenceUrl);
        const image = media[peak.id].image;
        const html = createDetailsPhoto(peak, media[peak.id]);
        assertTrue(html.includes(`src="${escapeHtml(image.src)}"`));
        assertTrue(html.includes(`alt="${escapeHtml(image.alt)}"`));
        assertTrue(html.includes(`Photo: ${escapeHtml(image.credit)}`));
        assertTrue(html.includes(`href="${escapeHtml(image.licenceUrl)}"`), 'Licence links to licenceUrl');
        assertTrue(html.includes(`>${escapeHtml(image.licence)}<`), 'Licence name is the link text');
        assertTrue(html.includes(`href="${escapeHtml(image.sourceUrl)}"`), 'Links to the photo source page');
        anchors(html).forEach(a => {
            assertTrue(a.includes('target="_blank"'), 'External link opens in new tab');
            assertTrue(a.includes('rel="noopener noreferrer"'), 'External link has rel=noopener noreferrer');
        });
    });

    it('should show the licence as plain text when there is no licence URL', () => {
        const peak = peaks[0];
        const entry = { image: { src: '/src/assets/peaks/x.jpg', alt: 'A', credit: 'C', licence: 'Public domain', licenceUrl: null, sourceUrl: 'https://example.org/file', source: 'Wikimedia Commons' } };
        const html = createDetailsPhoto(peak, entry);
        assertTrue(html.includes('Licence: Public domain'));
        assertEqual(anchors(html).length, 1, 'Only the source link');
        assertFalse(html.includes('href="null"'));
        assertFalse(/null|undefined/.test(html));
    });

    it('should render nothing when there is no photo', () => {
        assertEqual(createDetailsPhoto(peaks[0], null), '');
        assertEqual(createDetailsPhoto(peaks[0], { image: null, route: null }), '');
    });
});

describe('Route section rendering (createRouteSection)', () => {
    let peaks;
    let media;
    let withRoute;
    let withoutRoute;
    beforeAll(() => {
        peaks = loadPeaksData();
        media = loadMediaData();
        withRoute = peaks.find(p => hasGpxFile(media[p.id]));
        withoutRoute = peaks.find(p => media[p.id] && media[p.id].route === null);
    });

    const sampleRoute = { image: null, route: { title: 'Sample ridge walk', url: 'https://example.org/route', gpxUrl: 'https://example.org/route.gpx', source: 'Example Walks' } };

    it('should show title, source, route link, GPX download and Garmin instructions', () => {
        const html = createRouteSection(sampleRoute);
        assertTrue(html.includes('Sample ridge walk'));
        assertTrue(html.includes('Route source: Example Walks'));
        assertTrue(/<a class="route-link" href="https:\/\/example.org\/route"[^>]*>View route page/.test(html));
        assertTrue(/<a class="gpx-link" href="https:\/\/example.org\/route.gpx"[^>]*>Download GPX/.test(html));
        assertTrue(html.includes('Garmin Connect'));
        assertTrue(/Courses/.test(html) && /Import/.test(html), 'Explains importing the GPX as a course');
        assertFalse(html.includes('not available'));
    });

    it('should open every route link in a new tab with rel="noopener noreferrer"', () => {
        const links = anchors(createRouteSection(sampleRoute));
        assertEqual(links.length, 2);
        links.forEach(a => {
            assertTrue(a.includes('target="_blank"'));
            assertTrue(a.includes('rel="noopener noreferrer"'));
        });
    });

    it('should render a real dataset route (when one exists) from the media data', () => {
        if (!withRoute) return; // Route coverage may change; nothing to check.
        const route = media[withRoute.id].route;
        const html = createRouteSection(media[withRoute.id]);
        assertTrue(html.includes(escapeHtml(route.title)));
        assertTrue(html.includes(`href="${escapeHtml(route.url)}"`));
        assertTrue(html.includes(`href="${escapeHtml(route.gpxUrl)}"`));
    });

    it('should say a verified route is not available yet, with no links, when route is null', () => {
        const variants = [{ image: null, route: null }, null, undefined, { route: { title: 'x', url: '', gpxUrl: '' } }];
        if (withoutRoute) variants.push(media[withoutRoute.id]);
        variants.forEach(entry => {
            const html = createRouteSection(entry);
            assertTrue(html.includes('A verified walking route is not available for this peak yet.'));
            assertFalse(html.includes('<a'), 'No links');
            assertFalse(html.includes('href'), 'No placeholder hrefs');
            assertFalse(/Download GPX|undefined|null/.test(html));
        });
    });

    it('should escape HTML in route data', () => {
        const html = createRouteSection({ route: { title: '<script>', url: 'https://e.org/"x', gpxUrl: 'https://e.org/g.gpx', source: '<i>S</i>' } });
        assertFalse(/<script>|<i>/.test(html));
        assertTrue(html.includes('href="https://e.org/&quot;x"'));
    });

    it('createPeakDetails should include the photo and route section for a peak with a route', () => {
        const peak = peaks[0];
        const entry = { image: { src: '/src/assets/peaks/x.jpg', alt: 'Alt', credit: 'Cred', licence: 'CC BY 2.0', licenceUrl: 'https://creativecommons.org/licenses/by/2.0', sourceUrl: 'https://example.org/f', source: 'Wikimedia Commons' }, route: sampleRoute.route };
        const html = createPeakDetails(peak, false, entry);
        assertTrue(html.includes('class="peak-details-photo"'));
        assertTrue(html.includes('Photo: Cred'));
        assertTrue(html.includes('Download GPX'));
        const labels = [...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map(m => m[1]);
        assertEqual(JSON.stringify(labels), JSON.stringify(['Peak number', 'Region', 'Height', 'Status']));
        // The toggle comes straight after the Close button in tab order.
        const order = [...html.matchAll(/class="(details-close-button|toggle-button details-toggle-button|route-link)[" ]/g)].map(m => m[1]);
        assertEqual(JSON.stringify(order), JSON.stringify(['details-close-button', 'toggle-button details-toggle-button', 'route-link']));
    });

    it('createPeakDetails should show the no-route message for a peak without a route', () => {
        const html = createPeakDetails(peaks[0], false, { image: null, route: null });
        assertTrue(html.includes('not available for this peak yet'));
        assertFalse(html.includes('Download GPX'));
        assertFalse(html.includes('<a'));
    });

    it('createPeakDetails should render every dataset peak with its media without errors', () => {
        peaks.forEach(p => {
            const html = createPeakDetails(p, false, media[p.id]);
            assertTrue(html.includes(`data-peak-id="${escapeHtml(p.id)}"`));
            assertEqual(html.includes('Download GPX'), hasGpxFile(media[p.id]), `${p.id} GPX link state`);
            assertEqual(html.includes('View route page'), hasRoute(media[p.id]), `${p.id} route link state`);
            assertFalse(/href="#"/.test(html), `${p.id} has no placeholder links`);
            assertFalse(/href="(null|undefined|)"/.test(html), `${p.id} has no broken links`);
        });
    });
});

describe('Gallery wiring and design constraints', () => {
    it('app.js should load media from data/peak-media.json and paginate the filtered peaks', () => {
        const js = readSource('src/app.js');
        assertTrue(js.includes("'/data/peak-media.json'"));
        assertTrue(js.includes('paginate(filteredPeaks, currentPage, PAGE_SIZE)'));
        const apply = js.match(/function applyFilters\(\)\s*\{([\s\S]*?)\n\}/);
        assertTrue(apply && apply[1].includes('currentPage = 1'), 'Changing a filter returns to page 1');
        const goTo = js.match(/function goToPage\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assertTrue(goTo && goTo[1].includes("getElementById('peaks-heading')") && goTo[1].includes('.focus('), 'Changing page moves focus to the gallery');
    });

    it('UI code should not hard-code image or route URLs', () => {
        for (const file of ['src/app.js', 'src/peak-utils.js', 'src/index.html']) {
            const src = readSource(file);
            assertFalse(/assets\/peaks\/[\w-]+\.(jpg|png)/.test(src), `${file} should not reference peak images`);
            assertFalse(/\.gpx\b/.test(src.replace(/GPX/g, '')), `${file} should not reference GPX files`);
            assertFalse(/walkingenglishman|wikimedia\.org/i.test(src), `${file} should not hard-code media URLs`);
        }
    });

    it('should not add external CSS/JS frameworks or web fonts', () => {
        const html = readSource('src/index.html');
        const css = readSource('src/style.css');
        assertFalse(/<link[^>]+href="https?:/.test(html), 'No external stylesheets');
        assertFalse(/<script[^>]+src="https?:/.test(html), 'No external scripts');
        assertFalse(/@import|@font-face|url\(\s*['"]?https?:/.test(css), 'No imported CSS or web fonts');
        assertEqual(JSON.stringify(JSON.parse(readSource('package.json')).dependencies || {}), '{}', 'No runtime dependencies');
    });

    it('index.html should have a hero header, gallery status and pagination container', () => {
        const html = readSource('src/index.html');
        assertTrue(html.includes('<header class="hero">'));
        assertTrue(html.includes('id="gallery-status"'));
        assertTrue(html.includes('<div id="pagination"></div>'));
    });
});


// ---------------------------------------------------------------------------
// TASK-005: routes without a direct GPX file, dashboard layout, counts
// ---------------------------------------------------------------------------
describe('Routes without a direct GPX file', () => {
    let peaks;
    let media;
    beforeAll(() => { peaks = loadPeaksData(); media = loadMediaData(); });

    const withGpx = { route: { title: 'Ridge walk', url: 'https://example.org/route', gpxUrl: 'https://example.org/route.gpx', source: 'Example Walks' } };
    const withNote = { route: { title: 'Glen circuit', url: 'https://example.org/glen', gpxUrl: null, gpxNote: 'GPX download on the route page (free account)', source: 'Example Hills' } };
    const withoutNote = { route: { title: 'Corrie round', url: 'https://example.org/corrie', gpxUrl: null, source: 'Example Hills' } };
    const garminSteps = html => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);

    it('hasRoute needs only a url; hasGpxFile also needs a gpxUrl', () => {
        assertTrue(hasRoute(withGpx) && hasGpxFile(withGpx));
        assertTrue(hasRoute(withNote));
        assertFalse(hasGpxFile(withNote));
        assertTrue(hasRoute(withoutNote));
        assertFalse(hasGpxFile(withoutNote));
        for (const entry of [null, undefined, {}, { route: null }, { route: { title: 'x', url: '', gpxUrl: 'https://e.org/g.gpx' } }, { route: { title: 'x', gpxUrl: null } }]) {
            assertFalse(hasRoute(entry), 'No url means no usable route');
            assertFalse(hasGpxFile(entry), 'No url means no GPX link either');
        }
    });

    it('a route with gpxUrl keeps the Download GPX link and the direct-download first step', () => {
        const html = createRouteSection(withGpx);
        assertTrue(/<a class="gpx-link" href="https:\/\/example.org\/route.gpx"[^>]*>Download GPX/.test(html));
        assertTrue(/<a class="route-link" href="https:\/\/example.org\/route"[^>]*>View route page/.test(html));
        assertFalse(html.includes('route-gpx-note'), 'No note for a direct GPX file');
        assertEqual(garminSteps(html)[0], 'Download the GPX file to your computer.');
        assertFalse(html.includes('not available'));
    });

    it('a route with gpxUrl null and a gpxNote shows title, source, route link and the note, with no GPX link', () => {
        const html = createRouteSection(withNote);
        assertTrue(html.includes('Glen circuit'));
        assertTrue(html.includes('Route source: Example Hills'));
        assertTrue(/<a class="route-link" href="https:\/\/example.org\/glen"[^>]*>View route page/.test(html));
        assertTrue(html.includes('<p class="route-gpx-note">GPX download on the route page (free account)</p>'));
        assertFalse(html.includes('Download GPX'), 'No Download GPX link');
        assertFalse(html.includes('gpx-link'), 'No GPX link element');
        assertEqual(anchors(html).length, 1, 'Only the route page link');
        assertFalse(/href="(#|null|undefined|)"/.test(html), 'No empty, # or null hrefs');
        assertFalse(/\bnull\b|undefined/.test(html));
        assertFalse(html.includes('not available'), 'It is a route, not a missing route');
    });

    it('a route with gpxUrl null and no gpxNote shows a generic note', () => {
        const html = createRouteSection(withoutNote);
        assertTrue(html.includes('Corrie round'));
        assertTrue(html.includes(`<p class="route-gpx-note">${escapeHtml(GENERIC_GPX_NOTE)}</p>`));
        assertTrue(/route page/i.test(GENERIC_GPX_NOTE), 'Generic note points to the route page');
        assertTrue(/<a class="route-link" href="https:\/\/example.org\/corrie"/.test(html));
        assertFalse(html.includes('Download GPX'));
        assertEqual(anchors(html).length, 1);
        assertFalse(/href="(#|null|undefined|)"/.test(html));
        assertFalse(/\bnull\b|undefined/.test(html));
        // Empty / blank notes also fall back to the generic note.
        assertTrue(createRouteSection({ route: { ...withoutNote.route, gpxNote: '  ' } }).includes(escapeHtml(GENERIC_GPX_NOTE)));
    });

    it('Garmin steps tell the user to download the GPX from the route page when there is no direct file', () => {
        for (const entry of [withNote, withoutNote]) {
            const steps = garminSteps(createRouteSection(entry));
            assertEqual(steps.length, 4);
            assertTrue(/route page/i.test(steps[0]) && /download the GPX/i.test(steps[0]), `First step: ${steps[0]}`);
            assertTrue(/Courses/.test(steps[1]) && /Import/.test(steps[1]));
        }
    });

    it('no route (or a route without a url) shows the not-available message with no links', () => {
        for (const entry of [null, { route: null }, { route: { title: 'x', url: null, gpxUrl: null, gpxNote: 'n' } }]) {
            const html = createRouteSection(entry);
            assertTrue(html.includes('A verified walking route is not available for this peak yet.'));
            assertFalse(html.includes('<a'));
            assertFalse(html.includes('route-gpx-note'));
            assertFalse(html.includes('Garmin'));
        }
    });

    it('escapes HTML in the gpxNote', () => {
        const html = createRouteSection({ route: { ...withNote.route, gpxNote: '<img src=x onerror=alert(1)>' } });
        assertFalse(html.includes('<img'));
        assertTrue(html.includes('&lt;img'));
    });

    it('renders every dataset route without a direct GPX file with its own note and route link', () => {
        const noGpx = peaks.filter(p => hasRoute(media[p.id]) && !hasGpxFile(media[p.id]));
        noGpx.forEach(p => {
            const route = media[p.id].route;
            const html = createPeakDetails(p, false, media[p.id]);
            assertTrue(html.includes(`href="${escapeHtml(route.url)}"`), `${p.id} route link`);
            const note = typeof route.gpxNote === 'string' && route.gpxNote.trim() ? route.gpxNote : GENERIC_GPX_NOTE;
            assertTrue(html.includes(escapeHtml(note)), `${p.id} note`);
            assertFalse(html.includes('Download GPX'), `${p.id} no GPX link`);
            assertFalse(html.includes('not available for this peak yet'), `${p.id} is a route`);
        });
    });
});

describe('Singular / plural counts', () => {
    it('pluralize should use the singular only for exactly 1', () => {
        assertEqual(pluralize(1, 'peak'), 'peak');
        assertEqual(pluralize(0, 'peak'), 'peaks');
        assertEqual(pluralize(2, 'peak'), 'peaks');
        assertEqual(pluralize(25, 'peak'), 'peaks');
        assertEqual(pluralize(100, 'peak'), 'peaks');
        assertEqual(pluralize('1', 'peak'), 'peak', 'Numeric strings work too');
        assertEqual(pluralize(2, 'person', 'people'), 'people', 'Custom plural');
        assertEqual(pluralize(1, 'person', 'people'), 'person');
    });

    it('formatCount should prefix the count', () => {
        assertEqual(formatCount(1, 'peak'), '1 peak');
        assertEqual(formatCount(0, 'peak'), '0 peaks');
        assertEqual(formatCount(21, 'peak'), '21 peaks');
    });

    it('region progress should say "1 / 1 peak" and "x / n peaks" otherwise', () => {
        const one = createRegionProgressItem({ region: 'Dartmoor', completed: 1, total: 1, percentage: 100 });
        assertTrue(one.includes('1 / 1 peak ·'), 'Singular for a one-peak region');
        assertFalse(one.includes('1 / 1 peaks'));
        assertTrue(one.includes('(1 of 1 peak)'), 'Accessible value text is grammatical too');
        const zero = createRegionProgressItem({ region: 'Dartmoor', completed: 0, total: 1, percentage: 0 });
        assertTrue(zero.includes('0 / 1 peak ·'));
        const many = createRegionProgressItem({ region: 'Lake District', completed: 1, total: 25, percentage: 4 });
        assertTrue(many.includes('1 / 25 peaks ·'));
        assertTrue(many.includes('(1 of 25 peaks)'));
    });

    it('every dataset region uses the right word', () => {
        const peaks = loadPeaksData();
        calculateRegionProgress(new Set(), peaks).forEach(r => {
            const html = createRegionProgressItem(r);
            assertTrue(html.includes(`0 / ${r.total} ${r.total === 1 ? 'peak' : 'peaks'} ·`), `${r.region} count`);
            if (r.total === 1) assertFalse(html.includes('/ 1 peaks'), `${r.region} should be singular`);
        });
    });

    it('overall progress and gallery status text use the helper', () => {
        assertEqual(formatProgressText({ completed: 1, remaining: 99, total: 100, percentage: 1 }), '1% complete (1/100 peaks, 99 remaining)');
        assertEqual(formatProgressText({ completed: 0, remaining: 1, total: 1, percentage: 0 }), '0% complete (0/1 peak, 1 remaining)');
        assertEqual(formatGalleryStatus({ start: 1, end: 12, totalItems: 100, page: 1, pageCount: 9 }), 'Showing 1–12 of 100 peaks (page 1 of 9)');
        assertEqual(formatGalleryStatus({ start: 1, end: 1, totalItems: 1, page: 1, pageCount: 1 }), 'Showing 1–1 of 1 peak');
        const js = readSource('src/app.js');
        assertTrue(js.includes('formatProgressText(progress)'));
        assertTrue(js.includes('formatGalleryStatus(result)'));
        assertFalse(/\} peaks/.test(js), 'app.js should not hard-code "peaks" after a count');
    });
});

describe('Dashboard layout and region disclosure', () => {
    let css;
    let html;
    beforeAll(() => { css = readSource('src/style.css'); html = readSource('src/index.html'); });

    it('region list is behind a disclosure button that is closed in the initial HTML', () => {
        assertTrue(/<button type="button" id="region-progress-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="region-progress-list"/.test(html));
        assertTrue(/<h2 id="region-progress-heading"[^>]*>\s*<button[^>]*id="region-progress-toggle"/.test(html), 'Button sits inside the labelled heading');
        assertTrue(/<ul id="region-progress-list"[^>]*hidden/.test(html), 'List starts hidden');
        assertTrue(/\.region-progress-list\[hidden\]\s*\{[^}]*display:\s*none/.test(css), 'hidden wins over display: grid');
    });

    it('app.js opens the list by default only on screens wider than 600px and keeps aria-expanded in sync', () => {
        const js = readSource('src/app.js');
        assertTrue(js.includes("'(max-width: 600px)'"));
        const fn = js.match(/function setupRegionDisclosure\(\)\s*\{([\s\S]*?)\n\}/);
        assertTrue(fn, 'setupRegionDisclosure should exist');
        assertTrue(fn[1].includes("setAttribute('aria-expanded'"));
        assertTrue(fn[1].includes('list.hidden = !expanded'));
        assertTrue(fn[1].includes('setExpanded(!narrow.matches)'));
    });

    it('dashboard cards are not stretched to a shared row height', () => {
        const dash = css.match(/\.dashboard\s*\{([^}]*)\}/);
        assertTrue(dash && /align-items:\s*start/.test(dash[1]));
        const container = css.match(/\.progress-container\s*\{([^}]*)\}/);
        assertFalse(/height:\s*100%/.test(container[1]), 'Progress cards use their natural height');
    });
});


// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function runTests() {
    let passed = 0;
    let failed = 0;
    const errors = [];

    console.log('\n=== Trail 100 Tracker Tests ===');

    for (const suite of suites) {
        console.log(`\n${suite.name}`);
        let setupError = null;
        for (const hook of suite.beforeAll) {
            try {
                await hook();
            } catch (e) {
                setupError = e;
                break;
            }
        }

        for (const test of suite.tests) {
            try {
                if (setupError) throw new Error(`beforeAll failed: ${setupError.message}`);
                await test.fn();
                passed++;
                console.log(`  ✓ ${test.name}`);
            } catch (error) {
                failed++;
                errors.push(`${suite.name} > ${test.name}: ${error.message}`);
                console.log(`  ✗ ${test.name}`);
                console.log(`    Error: ${error.message}`);
            }
        }

        for (const hook of suite.afterAll) {
            try {
                await hook();
            } catch (e) {
                failed++;
                errors.push(`${suite.name} > afterAll: ${e.message}`);
            }
        }
    }

    console.log('\n=== Results ===');
    console.log(`Total: ${passed + failed}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (errors.length > 0) {
        console.log('\nErrors:');
        errors.forEach(err => console.log(`  - ${err}`));
    }
    console.log('');

    if (passed + failed === 0) {
        console.log('No tests were executed - treating as failure.');
        process.exitCode = 1;
        return;
    }

    // Set the exit code instead of calling process.exit(): forcing an exit while
    // network handles are still closing crashes Node on Windows with a libuv
    // assertion (UV_HANDLE_CLOSING), which made `npm test` fail even when all
    // tests passed. With all servers/sockets closed the process exits on its own.
    process.exitCode = failed > 0 ? 1 : 0;
}

runTests().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
