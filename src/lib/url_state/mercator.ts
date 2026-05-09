/**
 * Web-Mercator helpers shared by the keyframe and annotation codecs.
 * `mx`/`my` are normalized to [0, 1] (the standard WM unit square).
 */

const MAX_LAT = 85.05112878; // standard Web Mercator pole-clamp

export function lngLatToMercator(lng: number, lat: number): { mx: number; my: number } {
	const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
	const mx = (wrappedLng + 180) / 360;
	const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
	const sinLat = Math.sin((clampedLat * Math.PI) / 180);
	const my = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
	return { mx, my };
}

export function mercatorToLngLat(mx: number, my: number): { lng: number; lat: number } {
	const lng = mx * 360 - 180;
	const n = Math.PI - 2 * Math.PI * my;
	const lat = (180 / Math.PI) * Math.atan((Math.exp(n) - Math.exp(-n)) / 2);
	return { lng, lat };
}

/**
 * How many bits to use for each Mercator-x / -y axis at a given zoom.
 * One world pixel at zoom z spans 1/(256·2^z) ≈ 2^-(z+8) of WM space, so
 * (z + 12) bits buys ~16× sub-pixel accuracy. Floor at 12 (sub-pixel even
 * at zoom 0) and cap at 30 — that bound keeps signed deltas in safe-integer
 * range for the zigzag varint and is still sub-pixel up to zoom 18.
 */
export function zoomBits(zoom: number): number {
	return Math.max(12, Math.min(30, Math.ceil(zoom) + 12));
}
