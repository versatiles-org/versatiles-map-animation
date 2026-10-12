import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildBaseStyle, buildMapStyle, type MapStyleOptions } from './map_style';

const base: MapStyleOptions = { style: 'colorful', labels: true, terrain: false, sky: false };

describe('buildMapStyle', () => {
	const tileJson = (path: string) => ({
		tilejson: '3.0.0',
		tiles: [`/tiles/${path}/{z}/{x}/{y}`],
		minzoom: 0,
		maxzoom: 14,
		// Only vector tilesets carry `vector_layers`; the builder checks it.
		...(path === 'osm' && { vector_layers: [] })
	});

	afterEach(() => vi.unstubAllGlobals());

	it('replaces TileJSON references with absolute tile URLs', async () => {
		const requested: string[] = [];
		vi.stubGlobal('fetch', async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			requested.push(url);
			const path = /\/tiles\/(\w+)\/tiles\.json$/.exec(url)?.[1] ?? 'unknown';
			return new Response(JSON.stringify(tileJson(path)));
		});

		const style = await buildMapStyle({ ...base, terrain: true });
		for (const source of Object.values(style.sources)) {
			expect(source).not.toHaveProperty('url');
		}
		expect(style.sources['versatiles-shortbread']).toMatchObject({
			tiles: ['https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}']
		});
		expect(style.sources['elevation']).toMatchObject({
			tiles: ['https://tiles.versatiles.org/tiles/elevation/{z}/{x}/{y}']
		});

		// A rebuild reuses the TileJSON it already has.
		const before = requested.length;
		await buildMapStyle({ ...base, terrain: true, labels: false });
		expect(requested.length).toBe(before);
	});

	it('falls back to the unresolved style when a TileJSON cannot be fetched', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new Error('offline');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// Satellite: its TileJSON is not in the cache from the test above.
		const options: MapStyleOptions = { ...base, style: 'satellite' };
		expect(await buildMapStyle(options)).toEqual(buildBaseStyle(options));
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
