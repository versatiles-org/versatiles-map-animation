/**
 * Helpers for render mode (`?render=1`): the page is not watched by a
 * person but driven frame by frame by the offline renderer, which jumps the
 * camera, waits for the map to settle and takes a picture.
 *
 * MapLibre is built for people. After a camera change it spreads work over
 * many frames so the picture never stutters — which is exactly wrong here:
 * every one of those frames is drawn in full and thrown away, and with
 * software WebGL each costs around a tenth of a second.
 */

/** What we touch of MapLibre's terrain renderer. None of it is public API. */
interface TerrainTextures {
	needsFollowUpFrame: boolean;
	painter: unknown;
	prepareForRender(...args: unknown[]): void;
	_renderableTiles?: { releaseRTT(painter: unknown): void }[];
	_textureDifference?(tile: unknown): string;
	__refreshesAtOnce?: true;
}

/**
 * With terrain, the map is drawn into one texture per terrain tile, and
 * those textures go stale whenever the zoom changes. MapLibre then renews
 * them **one tile per frame**, nearest first — a dozen frames until the
 * picture is final. This makes it renew all of them in the first frame.
 *
 * It reaches into MapLibre's internals (checked against 6.14), so it only
 * acts if they look as expected; if a future version changes them, it does
 * nothing and rendering is merely slow again, never wrong. The terrain
 * renderer is created with the terrain, so call this on every `render`
 * event — it patches each instance once.
 */
export function refreshTerrainTexturesAtOnce(map: { painter?: unknown }): boolean {
	const textures = (map.painter as { renderToTexture?: TerrainTextures } | undefined)
		?.renderToTexture;
	if (!textures || textures.__refreshesAtOnce) return false;
	if (
		typeof textures.prepareForRender !== 'function' ||
		typeof textures._textureDifference !== 'function'
	) {
		return false;
	}
	const original = textures.prepareForRender;
	textures.prepareForRender = function (this: TerrainTextures, ...args: unknown[]) {
		original.apply(this, args);
		// Set when stale textures were left for a later frame.
		if (!this.needsFollowUpFrame) return;
		for (const tile of this._renderableTiles ?? []) {
			if (this._textureDifference!(tile) !== 'none') tile.releaseRTT(this.painter);
		}
		this.needsFollowUpFrame = false;
	};
	textures.__refreshesAtOnce = true;
	return true;
}
