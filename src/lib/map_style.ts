import { colorful, satellite } from '@versatiles/style';
import type { SpriteSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapStyleId } from './types';

const TILES_BASE_URL = 'https://tiles.versatiles.org';

/**
 * Sprite sheet that backs annotation icons. Referenced from the symbol layer
 * via the `markers:` namespace (e.g. `markers:symbol-marker`). Loaded as an
 * additional sprite alongside the base style's own sprite.
 */
export const ANNOTATION_SPRITE_ID = 'markers';
const ANNOTATION_SPRITE_URL = `${TILES_BASE_URL}/assets/sprites/markers/sprites`;

function withMarkersSprite(style: StyleSpecification): StyleSpecification {
	const existing: SpriteSpecification | undefined = style.sprite;
	const markers = { id: ANNOTATION_SPRITE_ID, url: ANNOTATION_SPRITE_URL };
	if (Array.isArray(existing)) {
		style.sprite = [...existing, markers];
	} else if (typeof existing === 'string') {
		// Older string form — promote to the array form so we can append.
		style.sprite = [{ id: 'default', url: existing }, markers];
	} else {
		style.sprite = [markers];
	}
	return style;
}

/**
 * MapLibre `sky` block — atmospheric scattering visible behind the horizon
 * when the camera is pitched. The upstream style builders don't include one,
 * so we attach it here when the user opts in.
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

export async function buildMapStyle(
	id: MapStyleId,
	labels: boolean,
	terrain: boolean,
	sky: boolean
): Promise<StyleSpecification> {
	switch (id) {
		case 'colorful':
			// `hideLabels: true` strips every symbol layer (place names, POIs,
			// shields). For colorful that's the only "show labels" knob the
			// upstream builder offers.
			return withSky(
				withMarkersSprite(
					await colorful({
						baseUrl: TILES_BASE_URL,
						hideLabels: !labels,
						terrain,
						hillshade: terrain
					})
				),
				sky
			);
		case 'satellite':
			// Satellite imagery is always rendered. The `overlay` flag adds the
			// colorful basemap (roads, labels, etc.) on top — that's the
			// satellite equivalent of "show labels".
			return withSky(
				withMarkersSprite(await satellite({ baseUrl: TILES_BASE_URL, overlay: labels, terrain })),
				sky
			);
	}
}
