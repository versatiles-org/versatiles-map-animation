import { cameraOf, type CameraState, type Keyframe } from './types';

/** Standard cubic ease-in-out on [0, 1]. */
export function easeInOut(t: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerp(a: number, b: number, alpha: number): number {
	return a + (b - a) * alpha;
}

/** Interpolate an angle in degrees taking the shortest path. Result normalized to (-180, 180]. */
export function lerpAngle(a: number, b: number, alpha: number): number {
	const delta = ((((b - a + 180) % 360) + 360) % 360) - 180;
	const raw = a + delta * alpha;
	return ((((raw + 180) % 360) + 360) % 360) - 180;
}

/**
 * Smooth zoom-and-pan interpolation between two camera positions, after
 * van Wijk & Nuij (2003), "Smooth and efficient zooming and panning".
 *
 * Naive linear interpolation of (lng, lat, zoom) makes the camera appear to
 * sweep across the ground much faster at high zoom than at low zoom (because
 * a degree of longitude covers many more pixels when zoomed in). The van
 * Wijk algorithm parametrizes the trajectory so the apparent angular velocity
 * of features stays roughly constant — typically arcing through a lower zoom
 * (higher altitude) between distant points.
 *
 * `rho` is the curvature parameter: √2 is the value the paper recommends as
 * the perceptual sweet spot, and what MapLibre's `flyTo` uses by default.
 */
const RHO = Math.SQRT2;

interface ZoomedPosition {
	lng: number;
	lat: number;
	zoom: number;
}

function shortestLngDelta(lngA: number, lngB: number): number {
	let d = lngB - lngA;
	while (d > 180) d -= 360;
	while (d < -180) d += 360;
	return d;
}

/** Equirectangular-y → Mercator-y, in degrees-of-latitude units (so x and y are comparable). */
function latToMercatorY(lat: number): number {
	const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
	return (Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)) * 180) / Math.PI;
}

function mercatorYToLat(my: number): number {
	return ((Math.atan(Math.exp((my * Math.PI) / 180)) - Math.PI / 4) * 360) / Math.PI;
}

function normalizeLng(lng: number): number {
	let v = ((lng + 180) % 360) - 180;
	if (v < -180) v += 360;
	return v;
}

/** Visible-area "width" at a given zoom, in degrees. Constant cancels out. */
function widthAtZoom(zoom: number): number {
	return 360 / Math.pow(2, zoom);
}

function zoomAtWidth(w: number): number {
	return Math.log2(360 / w);
}

function vanWijkSample(kfA: ZoomedPosition, kfB: ZoomedPosition, alpha: number): ZoomedPosition {
	if (alpha <= 0) return { lng: kfA.lng, lat: kfA.lat, zoom: kfA.zoom };
	if (alpha >= 1) return { lng: kfB.lng, lat: kfB.lat, zoom: kfB.zoom };

	const dlng = shortestLngDelta(kfA.lng, kfB.lng);
	const my0 = latToMercatorY(kfA.lat);
	const my1 = latToMercatorY(kfB.lat);
	const dmy = my1 - my0;

	const w0 = widthAtZoom(kfA.zoom);
	const w1 = widthAtZoom(kfB.zoom);
	const u_dist = Math.hypot(dlng, dmy);

	// Pure zoom (no horizontal travel): geometric interpolation in width keeps
	// the apparent zoom rate constant, which is what users expect.
	if (u_dist < 1e-9) {
		const w = w0 * Math.pow(w1 / w0, alpha);
		return { lng: kfA.lng, lat: kfA.lat, zoom: zoomAtWidth(w) };
	}

	const rho = RHO;
	const rho2 = rho * rho;
	const rho4 = rho2 * rho2;

	const b0 = (w1 * w1 - w0 * w0 + rho4 * u_dist * u_dist) / (2 * w0 * rho2 * u_dist);
	const b1 = (w1 * w1 - w0 * w0 - rho4 * u_dist * u_dist) / (2 * w1 * rho2 * u_dist);
	const r0 = Math.log(-b0 + Math.sqrt(b0 * b0 + 1));
	const r1 = Math.log(-b1 + Math.sqrt(b1 * b1 + 1));
	const S = (r1 - r0) / rho;

	const s = alpha * S;
	const cosh_r0 = Math.cosh(r0);
	const sinh_r0 = Math.sinh(r0);
	const arg = rho * s + r0;

	const du = (w0 / rho2) * (cosh_r0 * Math.tanh(arg) - sinh_r0);
	const w = (w0 * cosh_r0) / Math.cosh(arg);

	const dirLng = dlng / u_dist;
	const dirMy = dmy / u_dist;

	const lng = normalizeLng(kfA.lng + du * dirLng);
	const lat = mercatorYToLat(my0 + du * dirMy);
	return { lng, lat, zoom: zoomAtWidth(w) };
}

export function interpolateKeyframes(kfA: Keyframe, kfB: Keyframe, alpha: number): CameraState {
	const eased = easeInOut(alpha);
	// `path` lives on the *origin* keyframe and describes the shape of the
	// trajectory leaving it. `linear` is a direct lerp through
	// (lng, lat, zoom) — the right choice for tiny moves where van Wijk's
	// out-and-back arc feels theatrical.
	const useArc = (kfA.path ?? 'arc') !== 'linear';
	const { lng, lat, zoom } = useArc
		? vanWijkSample(kfA, kfB, eased)
		: linearLngLatZoom(kfA, kfB, eased);
	return {
		lng,
		lat,
		zoom,
		pitch: lerp(kfA.pitch, kfB.pitch, eased),
		bearing: lerpAngle(kfA.bearing, kfB.bearing, eased),
		roll: lerpAngle(kfA.roll, kfB.roll, eased)
	};
}

function linearLngLatZoom(kfA: ZoomedPosition, kfB: ZoomedPosition, alpha: number): ZoomedPosition {
	if (alpha <= 0) return { lng: kfA.lng, lat: kfA.lat, zoom: kfA.zoom };
	if (alpha >= 1) return { lng: kfB.lng, lat: kfB.lat, zoom: kfB.zoom };
	const dlng = shortestLngDelta(kfA.lng, kfB.lng);
	return {
		lng: normalizeLng(kfA.lng + dlng * alpha),
		lat: lerp(kfA.lat, kfB.lat, alpha),
		zoom: lerp(kfA.zoom, kfB.zoom, alpha)
	};
}

/**
 * Sample camera state at time t (seconds) from a keyframe array sorted by t.
 * Returns null if the array is empty. Holds the first/last keyframe outside
 * the defined range (US-defined "hold last frame" behavior).
 */
export function sampleAt(keyframes: Keyframe[], t: number): CameraState | null {
	if (keyframes.length === 0) return null;
	if (keyframes.length === 1 || t <= keyframes[0].t) return cameraOf(keyframes[0]);
	const last = keyframes[keyframes.length - 1];
	if (t >= last.t) return cameraOf(last);
	for (let i = 0; i < keyframes.length - 1; i++) {
		const a = keyframes[i];
		const b = keyframes[i + 1];
		if (t >= a.t && t <= b.t) {
			const span = b.t - a.t;
			const alpha = span > 0 ? (t - a.t) / span : 0;
			return interpolateKeyframes(a, b, alpha);
		}
	}
	return cameraOf(last);
}
