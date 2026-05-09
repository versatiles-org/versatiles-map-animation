import { colorful, satellite } from '@versatiles/style';
import type { StyleSpecification } from 'maplibre-gl';
import type { MapStyleId } from './types';

const TILES_BASE_URL = 'https://tiles.versatiles.org';

export async function buildMapStyle(id: MapStyleId, terrain: boolean): Promise<StyleSpecification> {
	switch (id) {
		case 'colorful': {
			const style = colorful({ baseUrl: TILES_BASE_URL, terrain, hillshade: terrain });
			return style;
		}
		case 'satellite':
			return satellite({ baseUrl: TILES_BASE_URL, overlay: false, terrain });
		case 'satellite-overlay':
			return satellite({ baseUrl: TILES_BASE_URL, overlay: true, terrain });
	}
}
