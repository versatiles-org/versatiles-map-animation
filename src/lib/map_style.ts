import { osm, satellite } from '@versatiles/style';
import type { SpriteSpecification, StyleSpecification } from 'maplibre-gl';
import type { Animation } from './types';

/**
 * The animation-level fields that decide what the base map style looks like.
 * `AnimationStore.mapStyleOptions` bundles them, so a new style setting is
 * added here and there, and MapStage rebuilds the style without changes.
 */
export type MapStyleOptions = Pick<Animation, 'style' | 'labels' | 'terrain' | 'sky'>;

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

export async function buildMapStyle(options: MapStyleOptions): Promise<StyleSpecification> {
	const { style: id, labels, terrain, sky } = options;
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
						theme: 'colorful',
						layers: labels ? true : { labels: false, icons: false, pois: false },
						features: { terrain, hillshade: terrain }
					})
				),
				sky
			);
		case 'satellite':
			// Satellite imagery is always rendered. The `osmOverlay` flag adds
			// the OSM basemap (roads, labels, etc.) on top — that's the
			// satellite equivalent of "show labels".
			return withSky(
				withAnnotationSprites(satellite({ ...common, osmOverlay: labels, features: { terrain } })),
				sky
			);
	}
}
