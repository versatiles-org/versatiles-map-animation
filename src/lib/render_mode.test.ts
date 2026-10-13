import { describe, expect, it } from 'vitest';
import { refreshTerrainTexturesAtOnce } from './render_mode';

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
		prepareForRender() {
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
});
