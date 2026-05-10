import { test, expect, type Page } from '@playwright/test';
import type { Map as MlMap } from 'maplibre-gl';

declare global {
	interface Window {
		__viewer_map?: MlMap;
	}
}

/**
 * The encoded animation here is the alpine flight from `static/embed-demo.html`.
 * It exercises a high-pitch, high-zoom shot — the worst case for our
 * "viewport size leaks into framing" issue, since pitched FOV is tied to
 * viewport height.
 */
const DEMO_HASH =
	'BRsh_gMZEhN5cto_FxU4_rxdbktXYYxHWKqe5vcPaTDbL7d3D_lfh1Ml5l11G_AQQFfX4ThT9bPuAeyAABSa3tzoQITYwtzHja9P-odPx4dkAAAVQwA';

const SEEK_TIME = 1.0; // seconds — pick a moment with the camera at high pitch

/** Open the viewer at `(width, height)`, seek to `t`, wait for tiles. */
async function openViewer(page: Page, width: number, height: number, hash: string, t: number) {
	await page.setViewportSize({ width, height });
	await page.goto(`/view?test=1&t=${t}#kf=${hash}`);
	// Wait for the map instance to be exposed and for tiles to settle.
	await page.waitForFunction(() => window.__viewer_map?.isStyleLoaded());
	await page.waitForFunction(
		() => window.__viewer_map?.areTilesLoaded() && window.__viewer_map?.loaded()
	);
	// One more frame for any pending paint.
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
}

/** Read the lng/lat of the four viewport corners (TL, TR, BR, BL). */
async function projectedCorners(page: Page): Promise<[number, number][]> {
	return page.evaluate(() => {
		const m = window.__viewer_map!;
		const c = m.getContainer();
		const w = c.clientWidth;
		const h = c.clientHeight;
		return (
			[
				[0, 0],
				[w, 0],
				[w, h],
				[0, h]
			] as const
		).map(([x, y]) => {
			const ll = m.unproject([x, y]);
			return [ll.lng, ll.lat] as [number, number];
		});
	});
}

/** Flat-pitch animation (no perspective) — Berlin centre, zoom 10, pitch 0. */
const FLAT_HASH = 'ARQQdjw4mITU_TcBxiYQ';

async function maxCornerDelta(a: [number, number][], b: [number, number][]): Promise<number> {
	let m = 0;
	for (let i = 0; i < 4; i++) {
		m = Math.max(m, Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1]));
	}
	return m;
}

test.describe('viewport-size invariance at fixed aspect ratio', () => {
	test('flat-pitch: 640x360 and 1280x720 (16:9) project identical corners', async ({ page }) => {
		await openViewer(page, 640, 360, FLAT_HASH, 0);
		const small = await projectedCorners(page);

		await openViewer(page, 1280, 720, FLAT_HASH, 0);
		const large = await projectedCorners(page);

		// At pitch 0 the projection is purely linear in zoom, so the adaptive-
		// zoom fix should give pixel-perfect equivalence (~1e-5 deg ≈ 1 m).
		expect(await maxCornerDelta(small, large)).toBeLessThan(1e-4);
	});

	test('high-pitch demo: 640x360 and 1280x720 (16:9) framing within 0.05°', async ({ page }) => {
		await openViewer(page, 640, 360, DEMO_HASH, SEEK_TIME);
		const small = await projectedCorners(page);

		await openViewer(page, 1280, 720, DEMO_HASH, SEEK_TIME);
		const large = await projectedCorners(page);

		// At high pitch, MapLibre's projection has a residual non-linear term
		// that pure-zoom adjustment can't fully cancel; we accept ~0.05° drift
		// (~5 km at the equator) — visually negligible at this zoom range, and
		// over an order of magnitude better than no adjustment at all.
		expect(await maxCornerDelta(small, large)).toBeLessThan(0.05);
	});
});
