import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);

export default defineConfig({
    testDir: './tests/e2e',
    // Every test uses its own browser context (fresh localStorage), so tests
    // can run in parallel. This keeps the full run short enough not to be cut
    // off by command time limits.
    fullyParallel: true,
    workers: process.env.CI ? 2 : 4,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'desktop',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
        },
        {
            name: 'mobile',
            use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
        },
    ],
    webServer: {
        command: 'node src/server.js',
        url: `http://127.0.0.1:${PORT}`,
        env: { PORT: String(PORT) },
        // Always start (and own) a fresh server. Reusing a leftover server from
        // an interrupted run led to it disappearing mid-run and to
        // ERR_CONNECTION_REFUSED failures. If the port is taken, Playwright
        // now fails fast with a clear "port already used" error instead.
        reuseExistingServer: false,
        stdout: 'ignore',
        stderr: 'pipe',
        timeout: 30_000,
    },
});
