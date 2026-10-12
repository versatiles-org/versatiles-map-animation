import { expect, test } from '@playwright/test';

/**
 * The tile server's TileJSON lists its tiles as origin-relative paths. If the
 * style hands MapLibre the TileJSON reference as-is, the tiles are requested
 * from the page's own host, 404, and the map stays blank — without any of
 * the camera-only tests noticing. This loads the viewer and checks where the
 * tiles actually come from.
 */
const FLAT_HASH = 'ARQQdjw4mITU_TcBxiYQAAA';

test('map tiles are loaded from the tile server, not from the page origin', async ({ page }) => {
	const tiles: { host: string; status: number }[] = [];
	page.on('response', (res) => {
		const url = new URL(res.url());
		if (/^\/tiles\/\w+\/\d+\/\d+\/\d+/.test(url.pathname)) {
			tiles.push({ host: url.host, status: res.status() });
		}
	});

	await page.goto(`/view?test=1#kf=${FLAT_HASH}`);
	await expect.poll(() => tiles.length, { timeout: 30_000 }).toBeGreaterThan(0);

	const pageHost = new URL(page.url()).host;
	expect(tiles.filter((t) => t.host === pageHost)).toEqual([]);
	expect(tiles.filter((t) => t.status >= 400)).toEqual([]);
	expect(tiles.every((t) => t.host === 'tiles.versatiles.org')).toBe(true);
});
