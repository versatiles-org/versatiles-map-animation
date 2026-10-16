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
	_renderableLayerIds?: string[];
	_textureDifference?(tile: unknown): string;
	__refreshesAtOnce?: true;
	/** Whether the zoom shows in the textures, for the layers last seen. */
	__zoomShows?: { layers: string; shows: boolean };
}

/** What we read of MapLibre's style: its layers, as they would be written out. */
interface StyleLayers {
	_layers?: Record<string, { serialize?(): unknown } | undefined>;
}

/** Layer types MapLibre draws into the terrain's textures (`LAYERS_TO_TEXTURES`). */
const TERRAIN_TEXTURE_LAYERS = new Set([
	'background',
	'fill',
	'line',
	'raster',
	'hillshade',
	'color-relief'
]);

/**
 * Whether drawing `layers` into the terrain's textures gives another picture
 * at another zoom: when one of them has a paint or layout property that
 * depends on the zoom — a line that widens as the map zooms in, say. Raster
 * imagery and a hillshade with fixed settings do not; most vector layers do.
 * When unsure (a custom layer, a layer it cannot read), it says yes.
 */
export function zoomShowsInTerrainTextures(layers: unknown[]): boolean {
	return layers.some((layer) => {
		if (!layer || typeof layer !== 'object') return true;
		const { type, paint, layout } = layer as { type?: unknown; paint?: unknown; layout?: unknown };
		if (type === 'custom') return true;
		if (typeof type !== 'string' || !TERRAIN_TEXTURE_LAYERS.has(type)) return false;
		const json = JSON.stringify([paint ?? null, layout ?? null]);
		// An expression reading `["zoom"]`, or an old-style function with `stops`.
		return json.includes('"zoom"') || json.includes('"stops"');
	});
}

/**
 * With terrain, the map is drawn into one texture per terrain tile, and
 * those textures go stale whenever the zoom changes. MapLibre then renews
 * them **one tile per frame**, nearest first — a dozen frames until the
 * picture is final. This makes it renew all of them in the first frame.
 *
 * A texture is stale, too, when nothing in it changed but the zoom — and
 * while the camera moves, the zoom changes in every frame. Where the zoom
 * does not show in them (satellite imagery and its hillshade, say), such
 * textures are kept as they are: drawing them again would give the same
 * picture, and with a hillshade it costs about a second a frame in software.
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
		const zoomShows = zoomShowsIn(this, args[0] as StyleLayers | undefined);
		for (const tile of this._renderableTiles ?? []) {
			const difference = this._textureDifference!(tile);
			if (difference === 'none' || (difference === 'zoom' && !zoomShows)) continue;
			tile.releaseRTT(this.painter);
		}
		this.needsFollowUpFrame = false;
	};
	textures.__refreshesAtOnce = true;
	return true;
}

/**
 * Whether the zoom shows in the textures of the layers MapLibre is about to
 * draw into them; worked out again only when those layers change. Without
 * the layers to look at, it says yes, and every stale texture is renewed.
 */
function zoomShowsIn(textures: TerrainTextures, style: StyleLayers | undefined): boolean {
	const ids = textures._renderableLayerIds;
	const all = style?._layers;
	if (!ids || !all) return true;
	const key = ids.join();
	if (textures.__zoomShows?.layers !== key) {
		const layers = ids.map((id) => all[id]?.serialize?.());
		textures.__zoomShows = { layers: key, shows: zoomShowsInTerrainTextures(layers) };
	}
	return textures.__zoomShows.shows;
}
