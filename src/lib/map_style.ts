import { colorful, satellite } from '@versatiles/style';
import type { StyleSpecification } from 'maplibre-gl';
import type { MapStyleId } from './types';

const TILES_BASE_URL = 'https://tiles.versatiles.org';

export async function buildMapStyle(id: MapStyleId, terrain: boolean): Promise<StyleSpecification> {
	switch (id) {
		case 'colorful': {
			const style = colorful({ baseUrl: TILES_BASE_URL });
			if (terrain) await mergeTerrainFromSatellite(style);
			return style;
		}
		case 'satellite':
			return satellite({ baseUrl: TILES_BASE_URL, overlay: false, terrain });
		case 'satellite-overlay':
			return satellite({ baseUrl: TILES_BASE_URL, overlay: true, terrain });
	}
}

// The `colorful` builder doesn't support terrain directly. The `satellite` builder
// does, and produces a ready-to-use raster-dem source by fetching the elevation
// tilejson. We piggyback on it to attach the same source + terrain config to a
// colorful style.
async function mergeTerrainFromSatellite(style: StyleSpecification): Promise<void> {
	const sat = await satellite({ baseUrl: TILES_BASE_URL, overlay: false, terrain: true });
	if (sat.sources?.elevation) style.sources.elevation = sat.sources.elevation;
	if (sat.terrain) style.terrain = sat.terrain;
}
