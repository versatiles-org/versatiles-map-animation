import { defineConfig, devices } from '@playwright/test';

const PORT = 4173; // vite preview default

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false, // tile rendering competes for the network
	retries: process.env.CI ? 1 : 0,
	reporter: [['list']],

	// Build once and serve the static output. The viewer's `?test=1` query param
	// exposes the MapLibre instance on `window.__viewer_map` for the tests to
	// inspect projected viewport corners.
	webServer: {
		command: 'npm run preview -- --port ' + PORT,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	},

	use: {
		baseURL: `http://localhost:${PORT}`,
		// Tests resize the viewport themselves; this is just the default.
		viewport: { width: 1280, height: 720 },
		ignoreHTTPSErrors: true
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
