import { inlineSources, osm, satellite } from '@versatiles/style';
import type { SpriteSpecification, StyleSpecification } from 'maplibre-gl';
import { DEFAULT_MAP_THEMES, type Animation } from './types';

/**
 * The animation-level fields that decide what the base map style looks like.
 * `AnimationStore.mapStyleOptions` bundles them, so a new style setting is
 * added here and there, and MapStage rebuilds the style without changes.
 */
export type MapStyleOptions = Pick<
	Animation,
	'style' | 'theme' | 'labels' | 'hiddenLayers' | 'buildings3d' | 'terrain' | 'sky'
>;

const TILES_BASE_URL = 'https://tiles.versatiles.org';

/**
 * Sprite sheets that back annotation icons, loaded alongside the base style's
 * own `base` sheet. Annotation icons reference them by namespace (e.g.
 * `extras:pin-teardrop`, `icons:house`) — see `ANNOTATION_ICON_SPRITES`.
 */
const ANNOTATION_SPRITE_SHEETS = ['extras', 'icons'].map((id) => ({
	id,
	url: `${TILES_BASE_URL}/assets/sprites/${id}`
}));

function withAnnotationSprites(style: StyleSpecification): StyleSpecification {
	const existing: SpriteSpecification | undefined = style.sprite;
	if (Array.isArray(existing)) {
		style.sprite = [...existing, ...ANNOTATION_SPRITE_SHEETS];
	} else if (typeof existing === 'string') {
		// Older string form — promote to the array form so we can append.
		style.sprite = [{ id: 'default', url: existing }, ...ANNOTATION_SPRITE_SHEETS];
	} else {
		style.sprite = [...ANNOTATION_SPRITE_SHEETS];
	}
	return style;
}

/**
 * MapLibre `sky` block — atmospheric scattering visible behind the horizon
 * when the camera is pitched. We ask the upstream builders for `sky: false`
 * and attach our own here when the user opts in.
 *
 * `atmosphere-blend` is interpolated from full at flat to off past zoom 12,
 * so the sky doesn't bleed into close-up tiles. Cast through `unknown` because
 * @maplibre's expression type is too narrow for `interpolate` literals when
 * spelled out as an inline array.
 */
function makeSkySpec(): StyleSpecification['sky'] {
	return {
		'sky-color': '#88c6ff',
		'horizon-color': '#dbe4f0',
		'fog-color': '#dbe4f0',
		'sky-horizon-blend': 0.5,
		'horizon-fog-blend': 0.5,
		'fog-ground-blend': 0.5,
		'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 0] as unknown as number
	};
}

function withSky(style: StyleSpecification, sky: boolean): StyleSpecification {
	if (sky) style.sky = makeSkySpec();
	return style;
}

/**
 * TileJSON responses, kept for the lifetime of the page: every style rebuild
 * (a theme switch, a toggled checkbox) resolves the same two or three
 * documents again. A failed request is dropped so the next rebuild retries.
 */
const tileJsonCache = new Map<string, Promise<Response>>();

const cachedFetch: typeof fetch = async (input, init) => {
	const key = String(input instanceof Request ? input.url : input);
	let pending = tileJsonCache.get(key);
	if (!pending) {
		pending = fetch(input, init);
		tileJsonCache.set(key, pending);
		pending.then(
			(res) => {
				if (!res.ok) tileJsonCache.delete(key);
			},
			() => tileJsonCache.delete(key)
		);
	}
	return (await pending).clone();
};

/**
 * Build the style for MapLibre. The tile server's TileJSON lists its tiles
 * as origin-relative paths (`/tiles/osm/{z}/{x}/{y}`), which MapLibre
 * resolves against the *page*, not against the TileJSON it came from — on
 * any other host than the tile server every tile request 404s and the map
 * stays blank. `inlineSources` fetches each TileJSON and writes absolute
 * tile URLs into the style instead.
 */
export async function buildMapStyle(options: MapStyleOptions): Promise<StyleSpecification> {
	const style = buildBaseStyle(options);
	try {
		return await inlineSources(style, { fetch: cachedFetch });
	} catch (err) {
		// Without the TileJSON there are no tiles either way; hand MapLibre the
		// unresolved style so it at least reports the failing source itself.
		console.warn('Could not resolve the tile sources of the map style:', err);
		return style;
	}
}

/** The style as the builders write it, with no I/O: sources are TileJSON references. */
export function buildBaseStyle(options: MapStyleOptions): StyleSpecification {
	const { style: id, labels, terrain, sky } = options;
	const theme = options.theme ?? DEFAULT_MAP_THEMES[id];
	// `layers` option of the builders: every hidden group set to `false`.
	const hidden = Object.fromEntries((options.hiddenLayers ?? []).map((group) => [group, false]));
	// The builders default to the `globe` projection; our camera maths, URL
	// state and renderer all assume Web Mercator, so pin it explicitly.
	const common = { urls: { base: TILES_BASE_URL }, sky: false, projection: 'mercator' } as const;
	switch (id) {
		case 'colorful':
			// "Labels off" strips every symbol layer (place names, POIs,
			// shields, one-way markings) — `labels` alone only covers text.
			return withSky(
				withAnnotationSprites(
					osm({
						...common,
						theme,
						layers: labels ? hidden : { ...hidden, labels: false, icons: false, pois: false },
						features: {
							terrain,
							hillshade: terrain,
							buildings: options.buildings3d ? 'extruded' : 'flat'
						}
					})
				),
				sky
			);
		case 'satellite':
			// Satellite imagery is always rendered. The `osmOverlay` flag adds
			// the OSM basemap (roads, labels, etc.) on top — that's the
			// satellite equivalent of "show labels".
			return withSky(
				withAnnotationSprites(
					satellite({
						...common,
						osmOverlay: labels ? { theme, layers: hidden } : false,
						features: { terrain }
					})
				),
				sky
			);
	}
}
