import {
	cameraOf,
	MAX_CAMERA_LATITUDE,
	type CameraState,
	type Keyframe,
	type MapProjection
} from './types';

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

/**
 * The van Wijk trajectory itself, free of any projection: travelling a ground
 * distance `uDist` while the visible width goes from `w0` to `w1` (same
 * units), where are we at `alpha` — how far along (`du`) and how wide (`w`)?
 */
function vanWijk(uDist: number, w0: number, w1: number, alpha: number): { du: number; w: number } {
	// Pure zoom (no horizontal travel): geometric interpolation in width keeps
	// the apparent zoom rate constant, which is what users expect.
	if (uDist < 1e-9) return { du: 0, w: w0 * Math.pow(w1 / w0, alpha) };

	const rho = RHO;
	const rho2 = rho * rho;
	const rho4 = rho2 * rho2;

	const b0 = (w1 * w1 - w0 * w0 + rho4 * uDist * uDist) / (2 * w0 * rho2 * uDist);
	const b1 = (w1 * w1 - w0 * w0 - rho4 * uDist * uDist) / (2 * w1 * rho2 * uDist);
	const r0 = Math.log(-b0 + Math.sqrt(b0 * b0 + 1));
	const r1 = Math.log(-b1 + Math.sqrt(b1 * b1 + 1));
	const S = (r1 - r0) / rho;

	const s = alpha * S;
	const cosh_r0 = Math.cosh(r0);
	const sinh_r0 = Math.sinh(r0);
	const arg = rho * s + r0;

	return {
		du: (w0 / rho2) * (cosh_r0 * Math.tanh(arg) - sinh_r0),
		w: (w0 * cosh_r0) / Math.cosh(arg)
	};
}

function vanWijkSample(kfA: ZoomedPosition, kfB: ZoomedPosition, alpha: number): ZoomedPosition {
	if (alpha <= 0) return { lng: kfA.lng, lat: kfA.lat, zoom: kfA.zoom };
	if (alpha >= 1) return { lng: kfB.lng, lat: kfB.lat, zoom: kfB.zoom };

	const dlng = shortestLngDelta(kfA.lng, kfB.lng);
	const my0 = latToMercatorY(kfA.lat);
	const my1 = latToMercatorY(kfB.lat);
	const dmy = my1 - my0;
	const u_dist = Math.hypot(dlng, dmy);

	const { du, w } = vanWijk(u_dist, widthAtZoom(kfA.zoom), widthAtZoom(kfB.zoom), alpha);
	if (u_dist < 1e-9) return { lng: kfA.lng, lat: kfA.lat, zoom: zoomAtWidth(w) };

	const lng = normalizeLng(kfA.lng + (du * dlng) / u_dist);
	const lat = mercatorYToLat(my0 + (du * dmy) / u_dist);
	return { lng, lat, zoom: zoomAtWidth(w) };
}

// ---------------------------------------------------------------------------
// Globe
// ---------------------------------------------------------------------------
//
// MapLibre sizes the globe so that the map *at the centre* has the scale
// Mercator has there at the same zoom: radius ∝ 2^zoom / cos(lat). A camera
// that keeps its zoom while moving towards a pole therefore sees the globe
// grow. What stays put on screen is the "globe zoom" below — the zoom the
// same globe size has at the equator — so that is what gets interpolated,
// and the trajectory follows the great circle instead of the straight line
// of the Mercator plane.

const DEG = Math.PI / 180;

function clampLat(lat: number): number {
	return Math.max(-MAX_CAMERA_LATITUDE, Math.min(MAX_CAMERA_LATITUDE, lat));
}

/** log2 of the factor by which the globe is bigger at `lat` than at the equator, zoom being equal. */
function globeZoomShift(lat: number): number {
	return -Math.log2(Math.cos(clampLat(lat) * DEG));
}

/** MapLibre zoom → size of the globe, as the zoom that size has at the equator. */
export function toGlobeZoom(zoom: number, lat: number): number {
	return zoom + globeZoomShift(lat);
}

/** Inverse of `toGlobeZoom`. */
export function fromGlobeZoom(globeZoom: number, lat: number): number {
	return globeZoom - globeZoomShift(lat);
}

type Vec3 = [number, number, number];

function toVector(lng: number, lat: number): Vec3 {
	const cosLat = Math.cos(lat * DEG);
	return [cosLat * Math.cos(lng * DEG), cosLat * Math.sin(lng * DEG), Math.sin(lat * DEG)];
}

/** Point at fraction `f` of the great circle from A to B, spanning `angle` radians. */
function greatCirclePoint(
	a: Vec3,
	b: Vec3,
	angle: number,
	f: number
): { lng: number; lat: number } {
	const sin = Math.sin(angle);
	const ka = Math.sin((1 - f) * angle) / sin;
	const kb = Math.sin(f * angle) / sin;
	const x = ka * a[0] + kb * b[0];
	const y = ka * a[1] + kb * b[1];
	const z = ka * a[2] + kb * b[2];
	return { lng: Math.atan2(y, x) / DEG, lat: Math.atan2(z, Math.hypot(x, y)) / DEG };
}

function globeArcSample(kfA: ZoomedPosition, kfB: ZoomedPosition, alpha: number): ZoomedPosition {
	if (alpha <= 0) return { lng: kfA.lng, lat: kfA.lat, zoom: kfA.zoom };
	if (alpha >= 1) return { lng: kfB.lng, lat: kfB.lat, zoom: kfB.zoom };

	const a = toVector(kfA.lng, kfA.lat);
	const b = toVector(kfB.lng, kfB.lat);
	const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
	const angle = Math.acos(dot);
	const { du, w } = vanWijk(
		angle / DEG,
		widthAtZoom(toGlobeZoom(kfA.zoom, kfA.lat)),
		widthAtZoom(toGlobeZoom(kfB.zoom, kfB.lat)),
		alpha
	);

	let pos: { lng: number; lat: number };
	if (angle < 1e-9) {
		pos = { lng: kfA.lng, lat: kfA.lat };
	} else if (Math.PI - angle < 1e-6) {
		// Antipodes: every great circle connects them, so there is no "the"
		// route. Fall back to the plain lng/lat line.
		const f = du / (angle / DEG);
		pos = {
			lng: normalizeLng(kfA.lng + shortestLngDelta(kfA.lng, kfB.lng) * f),
			lat: lerp(kfA.lat, kfB.lat, f)
		};
	} else {
		pos = greatCirclePoint(a, b, angle, du / (angle / DEG));
	}
	// A route over a pole leaves the latitudes the camera can sit at.
	const lat = clampLat(pos.lat);
	return { lng: pos.lng, lat, zoom: fromGlobeZoom(zoomAtWidth(w), lat) };
}

function globeLinearSample(
	kfA: ZoomedPosition,
	kfB: ZoomedPosition,
	alpha: number
): ZoomedPosition {
	if (alpha <= 0) return { lng: kfA.lng, lat: kfA.lat, zoom: kfA.zoom };
	if (alpha >= 1) return { lng: kfB.lng, lat: kfB.lat, zoom: kfB.zoom };
	const lat = lerp(kfA.lat, kfB.lat, alpha);
	const globeZoom = lerp(toGlobeZoom(kfA.zoom, kfA.lat), toGlobeZoom(kfB.zoom, kfB.lat), alpha);
	return {
		lng: normalizeLng(kfA.lng + shortestLngDelta(kfA.lng, kfB.lng) * alpha),
		lat,
		zoom: fromGlobeZoom(globeZoom, lat)
	};
}

// ---------------------------------------------------------------------------
// Moves through waypoints
// ---------------------------------------------------------------------------
//
// A move from one stop straight to the next is eased on its own (`arc` or
// `linear` above), so the camera rests at both ends. A waypoint is a
// keyframe the camera flies through, so the segments on either side of it
// are pieces of one curve through time: cubic Hermite segments whose
// velocity at a waypoint is the slope between its two neighbours
// (Catmull-Rom). Position *and* speed are then continuous there. At a stop
// the velocity is zero, which is the ease-in / ease-out. A waypoint with no
// neighbour beyond it — the first or last keyframe — keeps the velocity of
// its one segment, so the animation starts or ends in motion.

/** Indices of the angles in a spline vector: they wrap, so they get unwrapped. */
const SPLINE_ANGLES = [0, 4, 5];

/** A keyframe as the vector the spline runs through: [lng, y, zoom, pitch, bearing, roll]. */
function toSplineVector(kf: Keyframe, onGlobe: boolean): number[] {
	return [
		kf.lng,
		// Same spaces as the other path types: Mercator plane, or lat and globe size.
		onGlobe ? kf.lat : latToMercatorY(kf.lat),
		onGlobe ? toGlobeZoom(kf.zoom, kf.lat) : kf.zoom,
		kf.pitch,
		kf.bearing,
		kf.roll
	];
}

/** Shift the angles of `v` by whole turns so each takes the short way from `from`. */
function unwrapFrom(from: number[], v: number[]): number[] {
	const out = [...v];
	for (const i of SPLINE_ANGLES) out[i] = from[i] + shortestLngDelta(from[i], v[i]);
	return out;
}

function normalizeAngle(deg: number): number {
	return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/**
 * Camera at `alpha` between `kfA` and `kfB`. `prev` / `next` are the
 * keyframes beyond them if the curve continues there, otherwise `null`.
 */
function splineSample(
	prev: Keyframe | null,
	kfA: Keyframe,
	kfB: Keyframe,
	next: Keyframe | null,
	alpha: number,
	projection: MapProjection
): CameraState {
	if (alpha <= 0 || alpha >= 1) {
		const kf = alpha <= 0 ? kfA : kfB;
		return { ...cameraOf(kf), bearing: normalizeAngle(kf.bearing), roll: normalizeAngle(kf.roll) };
	}
	const onGlobe = projection === 'globe';
	const a = toSplineVector(kfA, onGlobe);
	const b = unwrapFrom(a, toSplineVector(kfB, onGlobe));
	const p = prev && unwrapFrom(a, toSplineVector(prev, onGlobe));
	const n = next && unwrapFrom(b, toSplineVector(next, onGlobe));

	const h = kfB.t - kfA.t;
	const slope = (from: number, to: number, dt: number) => (dt > 0 ? (to - from) / dt : 0);
	// Velocity of component `i` at each end — see the section comment.
	const velocityA = (i: number) =>
		!kfA.waypoint ? 0 : p && prev ? slope(p[i], b[i], kfB.t - prev.t) : slope(a[i], b[i], h);
	const velocityB = (i: number) =>
		!kfB.waypoint ? 0 : n && next ? slope(a[i], n[i], next.t - kfA.t) : slope(a[i], b[i], h);

	const u = alpha;
	const u2 = u * u;
	const u3 = u2 * u;
	const h00 = 2 * u3 - 3 * u2 + 1;
	const h10 = u3 - 2 * u2 + u;
	const h01 = -2 * u3 + 3 * u2;
	const h11 = u3 - u2;

	const v = a.map(
		(_, i) => h00 * a[i] + h10 * h * velocityA(i) + h01 * b[i] + h11 * h * velocityB(i)
	);

	const lat = onGlobe ? clampLat(v[1]) : mercatorYToLat(v[1]);
	return {
		lng: normalizeLng(v[0]),
		lat,
		zoom: onGlobe ? fromGlobeZoom(v[2], lat) : v[2],
		// A curve can swing past its keyframes; the camera cannot tilt past these.
		pitch: Math.max(0, Math.min(90, v[3])),
		bearing: normalizeAngle(v[4]),
		roll: normalizeAngle(v[5])
	};
}

/**
 * `projection` picks the geometry the camera travels in — see the Globe
 * section above. The keyframes themselves mean the same in both.
 *
 * `neighbours` only matter next to a waypoint: the keyframe before `kfA`
 * if `kfA` is one, the keyframe after `kfB` if `kfB` is one.
 */
export function interpolateKeyframes(
	kfA: Keyframe,
	kfB: Keyframe,
	alpha: number,
	projection: MapProjection = 'mercator',
	neighbours: { prev?: Keyframe | null; next?: Keyframe | null } = {}
): CameraState {
	if (kfA.waypoint || kfB.waypoint) {
		const clamped = Math.max(0, Math.min(1, alpha));
		return splineSample(
			neighbours.prev ?? null,
			kfA,
			kfB,
			neighbours.next ?? null,
			clamped,
			projection
		);
	}
	const path = kfA.path ?? 'arc';
	const eased = easeInOut(alpha);
	// `path` lives on the *origin* keyframe and describes the shape of the
	// trajectory leaving it. `linear` is a direct lerp through
	// (lng, lat, zoom) — the right choice for tiny moves where van Wijk's
	// out-and-back arc feels theatrical.
	const useArc = path !== 'linear';
	const onGlobe = projection === 'globe';
	const sample = useArc
		? onGlobe
			? globeArcSample
			: vanWijkSample
		: onGlobe
			? globeLinearSample
			: linearLngLatZoom;
	const { lng, lat, zoom } = sample(kfA, kfB, eased);
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
export function sampleAt(
	keyframes: Keyframe[],
	t: number,
	projection: MapProjection = 'mercator'
): CameraState | null {
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
			// The curve through a waypoint needs the keyframe beyond it.
			const prev = a.waypoint && i > 0 ? keyframes[i - 1] : null;
			const next = b.waypoint && i + 2 < keyframes.length ? keyframes[i + 2] : null;
			return interpolateKeyframes(a, b, alpha, projection, { prev, next });
		}
	}
	return cameraOf(last);
}
