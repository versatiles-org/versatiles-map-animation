import { test, expect, type Page } from '@playwright/test';
import type { Map as MlMap } from 'maplibre-gl';

declare global {
	interface Window {
		__viewer_map?: MlMap;
	}
}

async function openEditor(page: Page) {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto('/?test=1');
	await page.waitForFunction(() => window.__viewer_map?.isStyleLoaded());
}

// Regression: changing an annotation's labelFont in the editor used to keep
// rendering the label in the old font because the satellite style (with
// labels off) shipped without a `glyphs` URL. We now inject one in
// `map_style.ts` so any new font's glyph stack can be fetched at runtime.
test('changing font on an example-animation annotation actually fetches the new font', async ({
	page
}) => {
	const glyphReqs: string[] = [];
	page.on('request', (req) => {
		if (/\/glyphs\//.test(req.url())) glyphReqs.push(req.url());
	});

	await openEditor(page);

	// Load example: satellite + 6 annotations all on noto_sans_bold.
	await page
		.locator('details.more')
		.evaluate((el) => (el as HTMLDetailsElement).setAttribute('open', ''));
	await page.locator('button[role="menuitem"]', { hasText: 'Load example' }).click();
	await page.waitForFunction(
		() => window.__viewer_map?.areTilesLoaded() && window.__viewer_map?.loaded()
	);

	// Pan to where the first annotation is visible.
	await page.evaluate(() => {
		const m = window.__viewer_map!;
		m.jumpTo({ center: [10.985278, 47.421111], zoom: 11, pitch: 0, bearing: 0 });
	});
	await page.waitForFunction(
		() => window.__viewer_map?.areTilesLoaded() && window.__viewer_map?.loaded()
	);

	// Select the first annotation (opens AnnotationEditor with FontSelect).
	await page.locator('.annotation-item').first().click();

	const canvas = page.locator('canvas.maplibregl-canvas').first();
	const before = await canvas.screenshot({ path: '/tmp/font-fix-before.png' });

	// Pick a distinctive font via FontSelect.
	await page.locator('.font-select .trigger').first().click();
	await page.locator('.font-select .search').fill('libre');
	await page
		.locator('.font-select .option', { hasText: /^Bold$/ })
		.first()
		.click();

	// Give MapLibre time to fetch the new glyph stack and re-tessellate.
	await page.waitForTimeout(2000);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

	const after = await canvas.screenshot({ path: '/tmp/font-fix-after.png' });

	const libreFetched = glyphReqs.some((u) => /libre_baskerville/i.test(u));
	expect(libreFetched, `expected libre_baskerville glyph fetch, got: ${glyphReqs.join('\n')}`).toBe(
		true
	);
	expect(before.equals(after), 'rendered label should differ before vs after font change').toBe(
		false
	);
});
