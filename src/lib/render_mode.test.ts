import { describe, expect, it } from 'vitest';
import { refreshTerrainTexturesAtOnce, zoomShowsInTerrainTextures } from './render_mode';

/** A stand-in for MapLibre's terrain renderer that renews one stale tile per frame. */
function fakeTerrainTextures(staleTiles: number) {
	const tiles = Array.from({ length: staleTiles }, () => ({
		stale: true,
		releaseRTT() {
			this.stale = false;
		}
	}));
	const textures = {
		painter: {},
		needsFollowUpFrame: false,
		_renderableTiles: tiles,
		_textureDifference: (tile: { stale: boolean }) => (tile.stale ? 'zoom' : 'none'),
		// MapLibre's takes the style, the zoom and whether the map moves.
		prepareForRender(..._args: unknown[]) {
			this.needsFollowUpFrame = false;
			let released = false;
			for (const tile of tiles) {
				if (!tile.stale) continue;
				if (released) this.needsFollowUpFrame = true;
				else tile.releaseRTT();
				released = true;
			}
		}
	};
	return { textures, tiles, map: { painter: { renderToTexture: textures } } };
}
const framesUntilFresh = (textures: { needsFollowUpFrame: boolean; prepareForRender(): void }) => {
	let frames = 0;
	do {
		textures.prepareForRender();
		frames++;
	} while (textures.needsFollowUpFrame && frames < 100);
	return frames;
};

describe('refreshTerrainTexturesAtOnce', () => {
	it('the stand-in behaves like MapLibre: one tile per frame', () => {
		const { textures } = fakeTerrainTextures(12);
		expect(framesUntilFresh(textures)).toBe(12);
	});

	it('renews every stale texture in the first frame', () => {
		const { textures, tiles, map } = fakeTerrainTextures(12);
		expect(refreshTerrainTexturesAtOnce(map)).toBe(true);
		expect(framesUntilFresh(textures)).toBe(1);
		expect(tiles.every((t) => !t.stale)).toBe(true);
	});

	it('leaves fresh textures alone', () => {
		const { textures, tiles, map } = fakeTerrainTextures(3);
		refreshTerrainTexturesAtOnce(map);
		framesUntilFresh(textures);
		let released = 0;
		for (const tile of tiles) tile.releaseRTT = () => void released++;
		expect(framesUntilFresh(textures)).toBe(1);
		expect(released).toBe(0);
	});

	it('patches an instance only once', () => {
		const { map, textures } = fakeTerrainTextures(2);
		expect(refreshTerrainTexturesAtOnce(map)).toBe(true);
		const patched = textures.prepareForRender;
		expect(refreshTerrainTexturesAtOnce(map)).toBe(false);
		expect(textures.prepareForRender).toBe(patched);
	});

	it('does nothing without terrain, or when the internals look different', () => {
		expect(refreshTerrainTexturesAtOnce({})).toBe(false);
		expect(refreshTerrainTexturesAtOnce({ painter: {} })).toBe(false);
		const { map, textures } = fakeTerrainTextures(4);
		const original = textures.prepareForRender;
		delete (textures as { _textureDifference?: unknown })._textureDifference;
		expect(refreshTerrainTexturesAtOnce(map)).toBe(false);
		expect(textures.prepareForRender).toBe(original);
		expect(framesUntilFresh(textures as never)).toBe(4);
	});

	/** The stand-in, drawing `layers` into textures that are stale by `difference`. */
	function withLayers(layers: object[], difference: string) {
		const fake = fakeTerrainTextures(6);
		const style = {
			_layers: Object.fromEntries(layers.map((l, i) => [`l${i}`, { serialize: () => l }]))
		};
		const textures = Object.assign(fake.textures, {
			_renderableLayerIds: Object.keys(style._layers),
			_textureDifference: (tile: { stale: boolean }) => (tile.stale ? difference : 'none')
		});
		refreshTerrainTexturesAtOnce(fake.map);
		textures.prepareForRender(style);
		return fake.tiles.filter((t) => t.stale).length;
	}
	const imagery = [
		{ type: 'background', paint: { 'background-color': '#000' } },
		{ type: 'raster', paint: { 'raster-opacity': 1 } },
		{ type: 'hillshade', paint: { 'hillshade-exaggeration': 0.1 } },
		{ type: 'symbol', layout: { 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10] } }
	];
	const roads = [
		...imagery,
		{ type: 'line', paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 8] } }
	];

	it('keeps textures that differ only by zoom, where the zoom does not show in them', () => {
		// The first frame renews one, as MapLibre does; the other five are kept.
		expect(withLayers(imagery, 'zoom')).toBe(5);
	});

	it('renews them where it does, or when other tiles are under them', () => {
		expect(withLayers(roads, 'zoom')).toBe(0);
		expect(withLayers(imagery, 'sourceTiles')).toBe(0);
		expect(withLayers(imagery, 'revision')).toBe(0);
	});
});

describe('zoomShowsInTerrainTextures', () => {
	it('is no for imagery and a fixed hillshade, and ignores what is not drawn into the terrain', () => {
		expect(
			zoomShowsInTerrainTextures([
				{ type: 'raster', paint: {} },
				{ type: 'hillshade' },
				{ type: 'symbol', layout: { 'text-size': ['zoom'] } },
				{ type: 'fill-extrusion', paint: { 'fill-extrusion-height': ['zoom'] } }
			])
		).toBe(false);
	});

	it('is yes for zoom expressions, old-style stops, custom layers and what it cannot read', () => {
		expect(zoomShowsInTerrainTextures([{ type: 'line', paint: { 'line-width': ['zoom'] } }])).toBe(
			true
		);
		expect(
			zoomShowsInTerrainTextures([
				{
					type: 'fill',
					paint: {
						'fill-opacity': {
							stops: [
								[5, 0],
								[6, 1]
							]
						}
					}
				}
			])
		).toBe(true);
		expect(zoomShowsInTerrainTextures([{ type: 'custom' }])).toBe(true);
		expect(zoomShowsInTerrainTextures([undefined])).toBe(true);
	});
});
