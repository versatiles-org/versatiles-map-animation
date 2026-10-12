import { afterEach, describe, it, expect, vi } from 'vitest';
import { osm } from '@versatiles/style';
import { buildBaseStyle, buildMapStyle, type MapStyleOptions } from './map_style';
import { MAP_THEME_LOOKALIKES_START, MAP_THEMES, mapThemeLabel } from './types';

const base: MapStyleOptions = { style: 'colorful', labels: true, terrain: false, sky: false };

describe('MAP_THEMES', () => {
	it('lists exactly the palettes @versatiles/style offers', () => {
		// A failure here means the library gained or lost a palette: append new
		// ones to MAP_THEMES (never reorder — the URL codec stores the index).
		expect([...MAP_THEMES].sort()).toEqual([...osm.palettes].sort());
	});

	it('keeps the VersaTiles themes in front of the lookalikes', () => {
		expect(MAP_THEMES.slice(0, MAP_THEME_LOOKALIKES_START)).toEqual([
			'colorful',
			'colorful-dark',
			'natural',
			'natural-dark',
			'muted',
			'muted-dark',
			'gray',
			'gray-dark',
			'toner',
			'toner-dark'
		]);
	});

	it('labels themes for the picker', () => {
		expect(mapThemeLabel('colorful')).toBe('Colorful');
		expect(mapThemeLabel('colorful-dark')).toBe('Colorful dark');
	});
});

describe('buildBaseStyle theme', () => {
	it('draws the OSM map in colorful when no theme is set', () => {
		expect(buildBaseStyle(base)).toEqual(buildBaseStyle({ ...base, theme: 'colorful' }));
	});

	it('draws the satellite overlay in gray when no theme is set', () => {
		const sat: MapStyleOptions = { ...base, style: 'satellite' };
		expect(buildBaseStyle(sat)).toEqual(buildBaseStyle({ ...sat, theme: 'gray' }));
	});

	it('builds a different style for every theme', () => {
		const seen = new Set<string>();
		for (const theme of MAP_THEMES) {
			seen.add(JSON.stringify(buildBaseStyle({ ...base, theme }).layers));
		}
		expect(seen.size).toBe(MAP_THEMES.length);
	});

	it('themes the satellite overlay, and ignores the theme without overlay', () => {
		const sat: MapStyleOptions = { ...base, style: 'satellite' };
		expect(buildBaseStyle({ ...sat, theme: 'toner' })).not.toEqual(buildBaseStyle(sat));
		const bare: MapStyleOptions = { ...sat, labels: false };
		expect(buildBaseStyle({ ...bare, theme: 'toner' })).toEqual(buildBaseStyle(bare));
	});
});

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
		await buildMapStyle({ ...base, terrain: true, theme: 'toner' });
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
