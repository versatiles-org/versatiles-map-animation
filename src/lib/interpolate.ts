import {
	cameraOf,
	DEFAULT_EASE,
	departureOf,
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

/**
 * The parameter, 0…1, at which the cubic Bézier curve from 0 to 1 with the
 * inner control values `c1` and `c2` reaches `x`. The curve has to rise all
 * the way, which it does for the control values used here.
 */
function bezierParameter(c1: number, c2: number, x: number): number {
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 40; i++) {
		const s = (lo + hi) / 2;
		const r = 1 - s;
		if (3 * r * r * s * c1 + 3 * r * s * s * c2 + s * s * s < x) lo = s;
		else hi = s;
	}
	return (lo + hi) / 2;
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

/**
 * How far along a move from stop to stop the camera is at `alpha` of its
 * time. `easeOut` is the easing of the stop it leaves, `easeIn` of the stop
 * it arrives at — see `Keyframe`. With neither set this is `easeInOut`.
 *
 * Otherwise the timing is the curve `cubic-bezier(easeOut, 0, 1 - easeIn, 1)`
 * known from CSS and from the "influence" of a keyframe in video editors:
 * the speed is zero at both ends, and the strength says for how much of the
 * move the camera keeps gathering or shedding speed. At 0 it starts (or
 * ends) at full speed.
 */
export function easeMove(alpha: number, easeOut?: number, easeIn?: number): number {
	if (easeOut === undefined && easeIn === undefined) return easeInOut(alpha);
	if (alpha <= 0) return 0;
	if (alpha >= 1) return 1;
	const s = bezierParameter(
		clamp01(easeOut ?? DEFAULT_EASE.direct),
		1 - clamp01(easeIn ?? DEFAULT_EASE.direct),
		alpha
	);
	return s * s * (3 - 2 * s);
}

/**
 * The same easing for the segment of a curve that starts at a stop: where
 * on the segment the camera is at `u` of its time. (For a segment that ends
 * on a stop, run it backwards: `1 - easeFromStop(1 - u, ease)`.)
 *
 * The curve comes to rest at a stop by itself, the way an easing of 1/3
 * does on a move from stop to stop, so that strength changes nothing here.
 * Any other one stretches or squeezes the time near the stop to match —
 * down to a start at full speed at 0 — and goes back to the pace of the
 * curve towards the waypoint, so the speed stays continuous there and the
 * waypoint is passed at its time.
 */
function easeFromStop(u: number, ease: number | undefined): number {
	if (ease === undefined) return u;
	return bezierParameter(clamp01(ease), 2 / 3, u);
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
	const g0 = toGlobeZoom(kfA.zoom, kfA.lat);
	const g1 = toGlobeZoom(kfB.zoom, kfB.lat);
	const f = evenSpeedFraction(g0, g1, alpha);
	const lat = lerp(kfA.lat, kfB.lat, f);
	return {
		lng: normalizeLng(kfA.lng + shortestLngDelta(kfA.lng, kfB.lng) * f),
		lat,
		zoom: fromGlobeZoom(lerp(g0, g1, alpha), lat)
	};
}

// ---------------------------------------------------------------------------
// Moves through waypoints
// ---------------------------------------------------------------------------
//
// A move from one stop straight to the next is eased on its own (`arc` or
// `linear` above), so the camera rests at both ends. A waypoint is a
// keyframe the camera flies through, so the segments on either side of it
// are pieces of one curve through time: cubic Hermite segments that share
// their velocity at the waypoint. Position *and* speed are then continuous
// there. At a stop the velocity is zero, which is the ease-in / ease-out
// (a stop can make it stronger or weaker, see `easeFromStop`). A
// waypoint with no neighbour beyond it — the first or last keyframe — keeps
// the velocity of its one segment, so the animation starts or ends in motion.
//
// The velocity at a waypoint starts out as the slope between its two
// neighbours (Catmull-Rom) and is then held back in two ways:
//
// - Zoom, tilt, bearing and roll do not swing past their keyframes: where a
//   value turns around at a waypoint it rests there for that instant, and it
//   never runs more than three times as fast as the slower of the two
//   segments (the Fritsch–Carlson condition for a curve without overshoot).
//   A value that is held back like this would brake at full strength right
//   up to the waypoint and be done with a jolt, so it gets a soft landing:
//   the less of the segment's pace it keeps at the waypoint, the more its
//   acceleration fades out there as well — all of it where it comes to
//   rest. The curve still does not swing past its keyframes.
//
// - The position is measured in what the viewer sees. A degree of ground is
//   twice as many pixels one zoom level further in, so the curve is built
//   from *on-screen* velocities — ground speed divided by the visible width
//   — and the ground is covered in proportion to that width. A curve that
//   comes down from the whole globe to a valley then crosses the continent
//   while it is still high and is nearly on target when it gets close.
//   Building it from ground speeds would carry the pace of the long haul
//   into the zoomed-in end: the camera would dive first and then race
//   across the map.

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

/** Cubic Hermite basis at `u`: weights of start, start tangent, end, end tangent. */
function hermite(u: number): [number, number, number, number] {
	const u2 = u * u;
	const u3 = u2 * u;
	return [2 * u3 - 3 * u2 + 1, u3 - 2 * u2 + u, -2 * u3 + 3 * u2, u3 - u2];
}

/**
 * The velocity at a waypoint, given the slopes of the segments into and out
 * of it and the Catmull-Rom slope across both: no swinging past the
 * keyframe, see the section comment.
 */
function limitedVelocity(slopeIn: number, slopeOut: number, across: number): number {
	if (slopeIn * slopeOut <= 0) return 0;
	const limit = 3 * Math.min(Math.abs(slopeIn), Math.abs(slopeOut));
	return Math.sign(across) * Math.min(Math.abs(across), limit);
}

/** Intervals of the Simpson sums over a segment's visible width; even. */
const WIDTH_STEPS = 32;

/** Simpson's rule for `f` over 0…`to`. */
function integrate(f: (u: number) => number, to: number): number {
	const step = to / WIDTH_STEPS;
	let sum = f(0) + f(to);
	for (let i = 1; i < WIDTH_STEPS; i++) sum += f(i * step) * (i % 2 === 1 ? 4 : 2);
	return (sum * step) / 3;
}

/** The keyframes a curve segment depends on, see `splineSample`. */
export interface CurveNeighbours {
	/** The keyframe before `kfA`, if `kfA` is a waypoint. */
	prev?: Keyframe | null;
	/** The keyframe before `prev`, if `prev` is a waypoint. */
	prev2?: Keyframe | null;
	/** The keyframe after `kfB`, if `kfB` is a waypoint. */
	next?: Keyframe | null;
	/** The keyframe after `next`, if `next` is a waypoint. */
	next2?: Keyframe | null;
}

/**
 * Camera at `alpha` between `kfA` and `kfB`. The neighbours are the
 * keyframes beyond them as far as the curve continues there, otherwise
 * `null`: the velocity at a waypoint depends on the segment on its other
 * side, and how fast that one crosses the screen on the zoom it has there.
 */
function splineSample(
	kfA: Keyframe,
	kfB: Keyframe,
	alpha: number,
	projection: MapProjection,
	{ prev = null, prev2 = null, next = null, next2 = null }: CurveNeighbours
): CameraState {
	if (alpha <= 0 || alpha >= 1) {
		const kf = alpha <= 0 ? kfA : kfB;
		return { ...cameraOf(kf), bearing: normalizeAngle(kf.bearing), roll: normalizeAngle(kf.roll) };
	}
	const onGlobe = projection === 'globe';
	// The easing of the stop this segment starts from or ends on.
	if (!kfA.waypoint) alpha = easeFromStop(alpha, kfA.easeOut);
	else if (!kfB.waypoint) alpha = 1 - easeFromStop(1 - alpha, kfB.easeIn);

	// The stretch of the curve that matters here, `kfA` at index 2 and `kfB`
	// at 3, each as its spline vector with the angles unwrapped along the way.
	const kfs = [prev && prev2, prev, kfA, kfB, next, next && next2];
	const vectors: (number[] | null)[] = kfs.map(() => null);
	vectors[2] = toSplineVector(kfA, onGlobe);
	for (let j = 3; j < kfs.length; j++) {
		const kf = kfs[j];
		const from = vectors[j - 1];
		vectors[j] = kf && from && unwrapFrom(from, toSplineVector(kf, onGlobe));
	}
	for (let j = 1; j >= 0; j--) {
		const kf = kfs[j];
		const from = vectors[j + 1];
		vectors[j] = kf && from && unwrapFrom(from, toSplineVector(kf, onGlobe));
	}

	/** Mean velocity of component `i` from keyframe `from` to keyframe `to`, if both exist. */
	const slope = (from: number, to: number, i: number): number | null => {
		const a = vectors[from];
		const b = vectors[to];
		if (!a || !b) return null;
		const dt = kfs[to]!.t - kfs[from]!.t;
		return dt > 0 ? (b[i] - a[i]) / dt : 0;
	};

	/** Velocity of zoom, pitch, bearing or roll (component `i`) at keyframe `j`. */
	const velocity = (j: number, i: number): number => {
		if (!kfs[j]?.waypoint) return 0;
		const into = slope(j - 1, j, i);
		const out = slope(j, j + 1, i);
		if (into === null || out === null) return into ?? out ?? 0;
		return limitedVelocity(into, out, slope(j - 1, j + 1, i) ?? 0);
	};

	/** Zoom, pitch, bearing or roll (component `i`) at `u` of the way from keyframe `j` to the one after it. */
	const along = (j: number, i: number): ((u: number) => number) => {
		const from = vectors[j]![i];
		const to = vectors[j + 1]![i];
		const h = kfs[j + 1]!.t - kfs[j]!.t;
		const tangentFrom = h * velocity(j, i);
		const tangentTo = h * velocity(j + 1, i);
		// The soft landing, see the section comment: how much of the cubic's
		// acceleration at each end to take out. All of it where the value
		// rests at a waypoint, none where it passes at the segment's own pace.
		const delta = to - from;
		const soft = (waypoint: boolean | undefined, tangent: number) =>
			waypoint && delta !== 0 ? Math.max(0, 1 - Math.abs(tangent / delta)) / 2 : 0;
		const softFrom =
			soft(kfs[j]!.waypoint, tangentFrom) * (4 * tangentFrom + 2 * tangentTo - 6 * delta);
		const softTo =
			soft(kfs[j + 1]!.waypoint, tangentTo) * (6 * delta - 2 * tangentFrom - 4 * tangentTo);
		return (u) => {
			const [h00, h10, h01, h11] = hermite(u);
			const r = 1 - u;
			return (
				h00 * from +
				h10 * tangentFrom +
				h01 * to +
				h11 * tangentTo +
				u * u * r * r * (softFrom * r + softTo * u)
			);
		};
	};
	const zoomOn = (j: number) => along(j, 2);
	/** Visible width, relative to zoom 0, averaged over the segment from keyframe `j`. */
	const meanWidth = (j: number): number => {
		const zoom = zoomOn(j);
		return integrate((u) => Math.pow(2, -zoom(u)), 1);
	};
	/** How fast the segment from keyframe `j` crosses the screen on average: [lng, y] per second and width. */
	const screenVelocity = (j: number): [number, number] | null => {
		const a = vectors[j];
		const b = vectors[j + 1];
		if (!a || !b) return null;
		const dt = kfs[j + 1]!.t - kfs[j]!.t;
		if (!(dt > 0)) return [0, 0];
		const scale = 1 / (dt * meanWidth(j));
		return [(b[0] - a[0]) * scale, (b[1] - a[1]) * scale];
	};
	/** On-screen velocity of the position at keyframe `j`. */
	const positionVelocity = (j: number): [number, number] => {
		if (!kfs[j]?.waypoint) return [0, 0];
		const into = screenVelocity(j - 1);
		const out = screenVelocity(j);
		if (!into || !out) return into ?? out ?? [0, 0];
		// Catmull-Rom on screen: the two segments weighted by how long they last …
		const dtIn = kfs[j]!.t - kfs[j - 1]!.t;
		const dtOut = kfs[j + 1]!.t - kfs[j]!.t;
		const total = dtIn + dtOut;
		if (!(total > 0)) return [0, 0];
		const across = [0, 1].map((i) => (into[i] * dtIn + out[i] * dtOut) / total);
		// … and held back so the curve of the slower segment does not have to
		// loop to fit the velocity in: up to three times its speed where the
		// two segments run the same way (as for the other components), down
		// to its own speed where the path turns a corner or doubles back.
		const speed = Math.hypot(across[0], across[1]);
		const speedIn = Math.hypot(into[0], into[1]);
		const speedOut = Math.hypot(out[0], out[1]);
		const aligned =
			speedIn > 0 && speedOut > 0
				? Math.max(0, (into[0] * out[0] + into[1] * out[1]) / (speedIn * speedOut))
				: 0;
		const limit = Math.min(speedIn, speedOut) * (1 + 2 * aligned);
		const factor = speed > limit ? limit / speed : 1;
		return [across[0] * factor, across[1] * factor];
	};

	const a = vectors[2]!;
	const b = vectors[3]!;
	const h = kfB.t - kfA.t;
	const v = a.map((_, i) => along(2, i)(alpha));

	// The position runs along its own Hermite curve, not by time but by the
	// share of the segment's ground covered so far — the visible width summed
	// up to here, over the sum for the whole segment.
	const zoom = zoomOn(2);
	const width = (u: number) => Math.pow(2, -zoom(u));
	const widthSum = integrate(width, 1);
	const covered = integrate(width, alpha) / widthSum;
	const [g00, g10, g01, g11] = hermite(covered);
	// On-screen velocity → tangent in terms of the ground covered.
	const tangentFrom = positionVelocity(2).map((velocity) => h * widthSum * velocity);
	const tangentTo = positionVelocity(3).map((velocity) => h * widthSum * velocity);
	// The same soft landing as for the other components (see `along`),
	// measured along the way: where the camera passes a waypoint slower than
	// it crosses this segment, it does not speed up or brake there at once.
	const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
	const soft = (waypoint: boolean | undefined, tangent: number[]) =>
		waypoint && distance > 0
			? Math.max(0, 1 - Math.hypot(tangent[0], tangent[1]) / distance) / 2
			: 0;
	const softFrom = soft(kfA.waypoint, tangentFrom);
	const softTo = soft(kfB.waypoint, tangentTo);
	const rest = 1 - covered;
	const bump = covered * covered * rest * rest;
	for (const i of [0, 1]) {
		const delta = b[i] - a[i];
		v[i] =
			g00 * a[i] +
			g10 * tangentFrom[i] +
			g01 * b[i] +
			g11 * tangentTo[i] +
			bump *
				(softFrom * (4 * tangentFrom[i] + 2 * tangentTo[i] - 6 * delta) * rest +
					softTo * (6 * delta - 2 * tangentFrom[i] - 4 * tangentTo[i]) * covered);
	}

	const lat = onGlobe ? clampLat(v[1]) : mercatorYToLat(v[1]);
	return {
		lng: normalizeLng(v[0]),
		lat,
		zoom: onGlobe ? fromGlobeZoom(v[2], lat) : v[2],
		// Out of caution: the limited velocities keep the tilt between its keyframes.
		pitch: Math.max(0, Math.min(90, v[3])),
		bearing: normalizeAngle(v[4]),
		roll: normalizeAngle(v[5])
	};
}

/**
 * `projection` picks the geometry the camera travels in — see the Globe
 * section above. The keyframes themselves mean the same in both.
 *
 * `neighbours` only matter next to a waypoint — see `CurveNeighbours`.
 */
export function interpolateKeyframes(
	kfA: Keyframe,
	kfB: Keyframe,
	alpha: number,
	projection: MapProjection = 'mercator',
	neighbours: CurveNeighbours = {}
): CameraState {
	if (kfA.waypoint || kfB.waypoint) {
		const clamped = Math.max(0, Math.min(1, alpha));
		return splineSample(kfA, kfB, clamped, projection, neighbours);
	}
	const path = kfA.path ?? 'arc';
	const eased = easeMove(alpha, kfA.easeOut, kfB.easeIn);
	// `path` lives on the *origin* keyframe and describes the shape of the
	// trajectory leaving it. `linear` goes straight from one view to the
	// other without rising — the right choice for short moves, where van
	// Wijk's out-and-back arc feels theatrical.
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

/**
 * How far along a straight move the camera is when its zoom is `alpha` of
 * the way from `zoom0` to `zoom1`.
 *
 * Moving the position in step with the zoom looks wrong as soon as the two
 * zooms differ: a degree of ground is twice as many pixels one zoom level
 * further in, so the map crawls while zoomed out and rushes past at the
 * zoomed-in end. To keep the speed *on screen* even, the ground speed has to
 * follow the visible width, which shrinks by half per zoom level: the
 * fraction travelled is the integral of 2^-zoom over the part of the move
 * done so far, divided by the integral over all of it.
 */
export function evenSpeedFraction(zoom0: number, zoom1: number, alpha: number): number {
	const dz = zoom1 - zoom0;
	// Same zoom at both ends (or as good as): position and zoom go in step.
	if (Math.abs(dz) < 1e-6) return alpha;
	return (Math.pow(2, -dz * alpha) - 1) / (Math.pow(2, -dz) - 1);
}

function linearLngLatZoom(kfA: ZoomedPosition, kfB: ZoomedPosition, alpha: number): ZoomedPosition {
	if (alpha <= 0) return { lng: kfA.lng, lat: kfA.lat, zoom: kfA.zoom };
	if (alpha >= 1) return { lng: kfB.lng, lat: kfB.lat, zoom: kfB.zoom };
	const f = evenSpeedFraction(kfA.zoom, kfB.zoom, alpha);
	return {
		lng: normalizeLng(kfA.lng + shortestLngDelta(kfA.lng, kfB.lng) * f),
		lat: lerp(kfA.lat, kfB.lat, f),
		zoom: lerp(kfA.zoom, kfB.zoom, alpha)
	};
}

/**
 * Sample camera state at time t (seconds) from a keyframe array sorted by t.
 * Returns null if the array is empty. Holds the first/last keyframe outside
 * the defined range (US-defined "hold last frame" behavior).
 * A stop with a `hold` keeps its view from `t` to `t + hold`.
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
	// On a stop with a hold the move starts when the hold is over. For the
	// maths that is simply a keyframe whose time is its departure.
	const leaving = (kf: Keyframe): Keyframe => ({ ...kf, t: departureOf(kf) });
	for (let i = 0; i < keyframes.length - 1; i++) {
		const a = keyframes[i];
		const b = keyframes[i + 1];
		if (t >= a.t && t <= b.t) {
			const from = departureOf(a);
			if (t <= from) return cameraOf(a);
			const span = b.t - from;
			const alpha = span > 0 ? (t - from) / span : 0;
			// The curve through a waypoint needs the keyframes beyond it, as far
			// as the curve goes on: up to the next stop, two keyframes at most.
			const prev = a.waypoint && i > 0 ? leaving(keyframes[i - 1]) : null;
			const prev2 = prev?.waypoint && i > 1 ? leaving(keyframes[i - 2]) : null;
			const next = b.waypoint && i + 2 < keyframes.length ? keyframes[i + 2] : null;
			const next2 = next?.waypoint && i + 3 < keyframes.length ? keyframes[i + 3] : null;
			return interpolateKeyframes(leaving(a), b, alpha, projection, {
				prev,
				prev2,
				next,
				next2
			});
		}
	}
	return cameraOf(last);
}
