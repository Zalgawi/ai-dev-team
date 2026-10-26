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
    escapeHtml,
} from '../src/peak-utils.js';
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
            assertTrue(html.includes(`${r.completed} / ${r.total} peaks`), `${r.region} count`);
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
        assertTrue(toggle && toggle[1].includes('updateProgressSummary()'), 'Toggling should update progress');
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
        for (const asset of ['/src/style.css', '/src/app.js', '/src/peak-utils.js']) {
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

    it('app.js should load the dataset from data/peaks.json', () => {
        assertTrue(readSource('src/app.js').includes("'/data/peaks.json'"));
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
