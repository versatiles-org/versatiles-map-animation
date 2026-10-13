import { afterEach, describe, it, expect, vi } from 'vitest';
import { osm, satellite } from '@versatiles/style';
import {
	buildBaseStyle,
	buildMapStyle,
	onlySunMoved,
	sunPatch,
	type MapStyleOptions
} from './map_style';
import {
	MAP_LAYER_GROUPS,
	MAP_THEME_LOOKALIKES_START,
	MAP_THEMES,
	mapThemeLabel,
	SATELLITE_OVERLAY_LAYER_GROUPS
} from './types';

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

describe('layer groups', () => {
	const layerIds = (options: MapStyleOptions) => buildBaseStyle(options).layers.map((l) => l.id);

	it('lists exactly the top-level groups @versatiles/style offers', () => {
		// `icons` is an alias for pois + markings + transit stops, not a group.
		const groups = Object.keys(osm.layerGroups).filter((g) => g !== 'icons');
		expect([...MAP_LAYER_GROUPS].sort()).toEqual(groups.sort());
		const overlay = Object.keys(satellite.layerGroups).filter((g) => g !== 'icons');
		expect([...SATELLITE_OVERLAY_LAYER_GROUPS].sort()).toEqual(overlay.sort());
	});

	it('draws everything when no group is hidden', () => {
		expect(buildBaseStyle({ ...base, hiddenLayers: [] })).toEqual(buildBaseStyle(base));
	});

	it('removes layers for every hidden group of the OSM map', () => {
		const full = layerIds(base);
		for (const group of MAP_LAYER_GROUPS) {
			const ids = layerIds({ ...base, hiddenLayers: [group] });
			expect(ids.length, group).toBeLessThan(full.length);
			// Hiding only removes layers, it never adds or reorders any.
			expect(
				full.filter((id) => ids.includes(id)),
				group
			).toEqual(ids);
		}
	});

	it('leaves only the background when all groups are hidden', () => {
		const ids = layerIds({ ...base, hiddenLayers: [...MAP_LAYER_GROUPS] });
		expect(ids.filter((id) => !id.startsWith('slot-'))).toEqual(['background']);
	});

	it('hides overlay groups on satellite and ignores the others', () => {
		const sat: MapStyleOptions = { ...base, style: 'satellite' };
		const full = layerIds(sat);
		for (const group of MAP_LAYER_GROUPS) {
			const ids = layerIds({ ...sat, hiddenLayers: [group] });
			if (SATELLITE_OVERLAY_LAYER_GROUPS.includes(group)) {
				expect(ids.length, group).toBeLessThan(full.length);
			} else {
				expect(ids, group).toEqual(full);
			}
			expect(ids, group).toContain('satellite');
		}
	});

	it('keeps the labels switch working on top of hidden groups', () => {
		const noLabels = layerIds({ ...base, labels: false });
		const both = layerIds({ ...base, labels: false, hiddenLayers: ['roads'] });
		expect(both.length).toBeLessThan(noLabels.length);
		// A group the switch already hides makes no further difference.
		expect(layerIds({ ...base, labels: false, hiddenLayers: ['pois'] })).toEqual(noLabels);
	});
});

describe('3D buildings', () => {
	const buildingLayers = (options: MapStyleOptions) =>
		buildBaseStyle(options)
			.layers.filter((l) => l.id.startsWith('building'))
			.map((l) => `${l.id}:${l.type}`);

	it('draws flat footprints by default', () => {
		expect(buildingLayers(base)).toEqual(['building:outline:fill', 'building:fill']);
		expect(buildBaseStyle({ ...base, buildings3d: false })).toEqual(buildBaseStyle(base));
	});

	it('draws extrusions that read the height from the tiles when switched on', () => {
		const style = buildBaseStyle({ ...base, buildings3d: true });
		expect(buildingLayers({ ...base, buildings3d: true })).toEqual(['building-3d:fill-extrusion']);
		const layer = style.layers.find((l) => l.id === 'building-3d');
		expect(JSON.stringify(layer?.paint)).toContain('["get","height"]');
	});

	it('draws no buildings at all when the group is hidden', () => {
		expect(buildingLayers({ ...base, buildings3d: true, hiddenLayers: ['buildings'] })).toEqual([]);
	});

	it('is ignored on satellite', () => {
		const sat: MapStyleOptions = { ...base, style: 'satellite' };
		expect(buildBaseStyle({ ...sat, buildings3d: true })).toEqual(buildBaseStyle(sat));
	});
});

describe('sun', () => {
	const sun = { direction: 135, altitude: 20 };
	const relief: MapStyleOptions = { ...base, terrain: true, buildings3d: true };

	it('leaves the style without a light when unset', () => {
		expect(buildBaseStyle(relief).light).toBeUndefined();
	});

	it('writes a map-anchored light: azimuth as given, polar angle measured from overhead', () => {
		const light = buildBaseStyle({ ...relief, sun }).light;
		expect(light?.anchor).toBe('map');
		expect(light?.position).toEqual([1.15, 135, 70]);
	});

	it('turns the hillshade of the terrain to the same sun', () => {
		const paint = sunPatch({ ...relief, sun }).hillshade.map((h) => h.paint);
		expect(paint).toHaveLength(1);
		expect(paint[0]['hillshade-illumination-direction']).toBe(135);
		expect(paint[0]['hillshade-illumination-altitude']).toBe(20);
		expect(sunPatch({ ...base, sun }).hillshade).toEqual([]);
	});

	it('is ignored on satellite', () => {
		const sat: MapStyleOptions = { ...relief, style: 'satellite' };
		expect(buildBaseStyle({ ...sat, sun })).toEqual(buildBaseStyle(sat));
	});

	it('patching the light and the hillshade is all a moved sun changes', () => {
		const from = buildBaseStyle({ ...relief, sun: { direction: 300, altitude: 80 } });
		const to = buildBaseStyle({ ...relief, sun });
		const patch = sunPatch({ ...relief, sun });
		from.light = patch.light;
		for (const { id, paint } of patch.hillshade) {
			const layer = from.layers.find((l) => l.id === id);
			if (layer?.type === 'hillshade') layer.paint = paint;
		}
		expect(from).toEqual(to);
	});

	it('onlySunMoved is true only for a moved sun and nothing else', () => {
		const lit = { ...relief, sun };
		expect(onlySunMoved(lit, { ...lit, sun: { direction: 10, altitude: 5 } })).toBe(true);
		expect(onlySunMoved(relief, lit)).toBe(false);
		expect(onlySunMoved(lit, relief)).toBe(false);
		expect(onlySunMoved(lit, { ...lit, sun: { direction: 10, altitude: 5 }, terrain: false })).toBe(
			false
		);
		expect(
			onlySunMoved(lit, { ...lit, sun: { direction: 10, altitude: 5 }, hiddenLayers: ['pois'] })
		).toBe(false);
	});
});

describe('projection', () => {
	it('is Mercator unless the globe is asked for, on both maps', () => {
		for (const style of ['colorful', 'satellite'] as const) {
			expect(buildBaseStyle({ ...base, style }).projection).toEqual({ type: 'mercator' });
			expect(buildBaseStyle({ ...base, style, projection: 'mercator' })).toEqual(
				buildBaseStyle({ ...base, style })
			);
			expect(buildBaseStyle({ ...base, style, projection: 'globe' }).projection).toEqual({
				type: 'globe'
			});
		}
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
