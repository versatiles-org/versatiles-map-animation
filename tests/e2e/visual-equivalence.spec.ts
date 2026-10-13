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
	'ARsh_gMZEhN5cto_FxU4_nxc8ElyItRDWKrf5vcNbkjCoYZkG3dzf8vMXZkjkdJxFvP-CAr6_CcKfrZ9wD2QAAKTW9udCBCbGFuY8bXp_1Dp-PDsgAACgAA';

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

/**
 * Flat-pitch animation (no perspective) — Berlin centre, zoom 10, pitch 0.
 * Two-keyframe loop so the playhead position doesn't matter.
 */
const FLAT_HASH = 'ARQQdjw4mITU_TcBxiYQAAA'; // 16:9 (default)
const FLAT_HASH_4_3 = 'ARQQdjw4mITU_TcBxiYQASA'; // same shot, 4:3 composition

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

	test('4:3 composition: 800x600 and 1600x1200 project identical corners', async ({ page }) => {
		// Different display sizes, both at 4:3 — the letterbox CSS gives both
		// containers a 4:3 inner map area, so the adaptive-zoom math should
		// give pixel-perfect equivalence at pitch 0.
		await openViewer(page, 800, 600, FLAT_HASH_4_3, 0);
		const small = await projectedCorners(page);

		await openViewer(page, 1600, 1200, FLAT_HASH_4_3, 0);
		const large = await projectedCorners(page);

		expect(await maxCornerDelta(small, large)).toBeLessThan(1e-4);
	});
});

/**
 * Globe: Reykjavík (zoom 1.5) → Nairobi (zoom 2.68) on a linear path, 4 s.
 * Both ends show the globe at the same size, so it must keep that size on
 * the way — which only holds if the camera is interpolated for the globe.
 */
const GLOBE_HASH = 'AhQUdZLg2iDofDT-QD7eRQ7wYACAQA';

/** Screen positions of a few places, as fractions of the map's width. */
async function projectedPlaces(page: Page): Promise<[number, number][]> {
	return page.evaluate(() => {
		const m = window.__viewer_map!;
		const w = m.getContainer().clientWidth;
		const c = m.getCenter();
		return (
			[
				[0, 0],
				[10, 0],
				[0, 10],
				[-10, -10]
			] as const
		).map(([dLng, dLat]) => {
			const p = m.project([c.lng + dLng, c.lat + dLat]);
			return [p.x / w, p.y / w] as [number, number];
		});
	});
}

/** Radius of the globe in px, as MapLibre sizes it: ∝ 2^zoom / cos(centre latitude). */
async function globeSize(page: Page): Promise<number> {
	return page.evaluate(() => {
		const m = window.__viewer_map!;
		return Math.pow(2, m.getZoom()) / Math.cos((m.getCenter().lat * Math.PI) / 180);
	});
}

test.describe('globe projection', () => {
	test('`?t=` seeks: the camera is where the animation is at that time', async ({ page }) => {
		await openViewer(page, 1280, 720, GLOBE_HASH, 0);
		const start = await page.evaluate(() => window.__viewer_map!.getCenter().lat);
		await openViewer(page, 1280, 720, GLOBE_HASH, 2);
		const middle = await page.evaluate(() => window.__viewer_map!.getCenter().lat);
		expect(start).toBeCloseTo(64.1, 1);
		// Not quite the 31.4° halfway between the two: the globe is a touch
		// smaller at the end, and a Stay-low move covers more ground while zoomed out.
		expect(middle).toBeCloseTo(31.5, 1);
	});

	test('the globe keeps its size while the camera travels between equally sized views', async ({
		page
	}) => {
		const sizes: number[] = [];
		for (const t of [0, 1, 2, 3, 4]) {
			await openViewer(page, 1280, 720, GLOBE_HASH, t);
			expect(await page.evaluate(() => window.__viewer_map!.getProjection()?.type)).toBe('globe');
			sizes.push(await globeSize(page));
		}
		// Zoom is stored with two decimals, so the two ends differ by up to ~1 %.
		expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.02);
	});

	test('640x360 and 1280x720 show the same framing', async ({ page }) => {
		await openViewer(page, 640, 360, GLOBE_HASH, 2);
		const small = await projectedPlaces(page);
		await openViewer(page, 1280, 720, GLOBE_HASH, 2);
		const large = await projectedPlaces(page);
		for (let i = 0; i < small.length; i++) {
			expect(small[i][0]).toBeCloseTo(large[i][0], 4);
			expect(small[i][1]).toBeCloseTo(large[i][1], 4);
		}
	});
});

/**
 * Berlin, zoom 5 flat → zoom 12 pitched and turned, with the screen anchor
 * at 25 % from the left and 70 % from the top.
 */
const ANCHOR_HASH = 'AhQQdT4YmDKfsP4afDZJC-WqQAACAGYw';

test.describe('screen anchor', () => {
	test('the keyframe position stays on the anchor at any time and size', async ({ page }) => {
		for (const [width, height] of [
			[1280, 720],
			[640, 360]
		]) {
			for (const t of [0, 2, 4]) {
				await openViewer(page, width, height, ANCHOR_HASH, t);
				const [fx, fy] = await page.evaluate(() => {
					const m = window.__viewer_map!;
					const c = m.getContainer();
					const p = m.project([13.3777, 52.5163]);
					return [p.x / c.clientWidth, p.y / c.clientHeight];
				});
				// 3 decimals: the URL stores the position on a grid that is coarse at zoom 5.
				expect(fx).toBeCloseTo(0.25, 3);
				expect(fy).toBeCloseTo(0.7, 3);
			}
		}
	});
});

test.describe('annotation layer setup', () => {
	test('loading the annotated demo does not raise a maplibre style error', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});
		await openViewer(page, 1280, 720, DEMO_HASH, SEEK_TIME);
		// Filter to maplibre-relevant noise — tile fetches and the like can
		// flutter on slow CI but the text-font / layout error we care about
		// will surface here.
		const styleErrors = errors.filter(
			(e) => /text-font|annotations-layer|layout|paint/i.test(e) && !/AbortError|fetch/i.test(e)
		);
		expect(styleErrors).toEqual([]);
	});
});
