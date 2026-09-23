const fs = require('fs');
const path = require('path');

// Test configuration
const TESTS = [];
let passed = 0;
let failed = 0;
let errors = [];

function describe(name, fn) {
    TESTS.push({ name, fn });
}

function it(name, fn) {
    TESTS.push({ name, fn, type: 'test' });
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
    }
}

function assertNotNull(value, message) {
    if (value === null || value === undefined) {
        throw new Error(`${message || 'Assertion failed'}: value is null or undefined`);
    }
}

function assertTrue(value, message) {
    if (!value) {
        throw new Error(`${message || 'Assertion failed'}: expected truthy value`);
    }
}

function assertFalse(value, message) {
    if (value) {
        throw new Error(`${message || 'Assertion failed'}: expected falsy value`);
    }
}

// Load peaks data
function loadPeaksData() {
    const data = fs.readFileSync(path.join(__dirname, '../data/peaks.json'), 'utf-8');
    return JSON.parse(data);
}

// Test: Peak dataset
describe('Peak Dataset', () => {
    it('should contain all 100 peaks', () => {
        const peaks = loadPeaksData();
        assertEqual(peaks.length, 100, 'Should have 100 peaks');
    });

    it('should have each peak with required fields', () => {
        const peaks = loadPeaksData();
        peaks.forEach((peak, index) => {
            assertNotNull(peak.id, `Peak at index ${index} should have an id`);
            assertNotNull(peak.name, `Peak at index ${index} should have a name`);
            assertNotNull(peak.region, `Peak at index ${index} should have a region`);
            assertNotNull(peak.heightM, `Peak at index ${index} should have a heightM`);
            assertNotNull(peak.number, `Peak at index ${index} should have a number`);
        });
    });

    it('should have unique peak IDs', () => {
        const peaks = loadPeaksData();
        const ids = peaks.map(p => p.id);
        const uniqueIds = new Set(ids);
        assertEqual(uniqueIds.size, 100, 'All peak IDs should be unique');
    });

    it('should have peak numbers from 1 to 100', () => {
        const peaks = loadPeaksData();
        const numbers = peaks.map(p => p.number).sort((a, b) => a - b);
        for (let i = 1; i <= 100; i++) {
            assertEqual(numbers[i - 1], i, `Peak number ${i} should exist`);
        }
    });
});

// Test: Application logic
describe('Application Logic', () => {
    let testPeaks;

    beforeAll(() => {
        testPeaks = loadPeaksData();
    });

    it('should calculate completion percentage correctly', () => {
        const total = testPeaks.length;
        const completed = 25;
        const percentage = Math.round((completed / total) * 100);
        assertEqual(percentage, 25, '25 out of 100 should be 25%');
    });

    it('should calculate 0% when no peaks are completed', () => {
        const percentage = Math.round((0 / 100) * 100);
        assertEqual(percentage, 0, '0 completed should be 0%');
    });

    it('should calculate 100% when all peaks are completed', () => {
        const percentage = Math.round((100 / 100) * 100);
        assertEqual(percentage, 100, '100 completed should be 100%');
    });
});

// Test: Data integrity
describe('Data Integrity', () => {
    it('all peak names should be non-empty strings', () => {
        const peaks = loadPeaksData();
        peaks.forEach((peak, index) => {
            assertTrue(peak.name.length > 0, `Peak at index ${index} has an empty name`);
        });
    });

    it('all regions should be non-empty strings', () => {
        const peaks = loadPeaksData();
        peaks.forEach((peak, index) => {
            assertTrue(peak.region.length > 0, `Peak at index ${index} has an empty region`);
        });
    });

    it('all heights should be positive numbers', () => {
        const peaks = loadPeaksData();
        peaks.forEach((peak, index) => {
            assertTrue(peak.heightM > 0, `Peak at index ${index} has invalid height: ${peak.heightM}`);
        });
    });
});

// Test: Server configuration
describe('Server', () => {
    it('server.js should exist', () => {
        const exists = fs.existsSync(path.join(__dirname, '../src/server.js'));
        assertTrue(exists, 'server.js should exist');
    });

    it('index.html should exist', () => {
        const exists = fs.existsSync(path.join(__dirname, '../src/index.html'));
        assertTrue(exists, 'index.html should exist');
    });

    it('app.js should exist', () => {
        const exists = fs.existsSync(path.join(__dirname, '../src/app.js'));
        assertTrue(exists, 'app.js should exist');
    });

    it('style.css should exist', () => {
        const exists = fs.existsSync(path.join(__dirname, '../src/style.css'));
        assertTrue(exists, 'style.css should exist');
    });
});

// Helper for beforeAll (simple implementation)
function beforeAll(fn) {
    try {
        fn();
    } catch (e) {
        errors.push(e.message);
    }
}

// Run tests
function runTests() {
    console.log('\n=== Trail 100 Tracker Tests ===\n');

    // Group tests by describe blocks
    const groups = {};
    TESTS.forEach(test => {
        if (!test.type) {
            groups[test.name] = test;
        }
    });

    const groupedTests = [];
    const flatTests = [];

    TESTS.forEach(test => {
        if (test.type === 'test') {
            flatTests.push(test);
        }
    });

    // Run all tests
    TESTS.forEach(test => {
        if (test.type === 'test') {
            try {
                test.fn();
                passed++;
                console.log(`✓ ${test.name}`);
            } catch (error) {
                failed++;
                errors.push(error.message);
                console.log(`✗ ${test.name}`);
                console.log(`  Error: ${error.message}`);
            }
        }
    });

    // Summary
    console.log(`\n=== Results ===`);
    console.log(`Total: ${passed + failed}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (errors.length > 0) {
        console.log('\nErrors:');
        errors.forEach(err => console.log(`  - ${err}`));
    }

    console.log('');

    process.exit(failed > 0 ? 1 : 0);
}

runTests();