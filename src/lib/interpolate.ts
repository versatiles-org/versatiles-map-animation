import { movesOf, type Move } from './moves';
import { screenSpeed } from './screen_speed';
import {
	cameraOf,
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

// ---------------------------------------------------------------------------
// Even speed
// ---------------------------------------------------------------------------
//
// The times of waypoints decide how fast the camera is between them, and
// getting them right by hand is fiddly: too little time for a long stretch
// and the picture races. A move with `evenSpeed` takes that job over. Only
// the times of its two ends count. In between:
//
//  1. The route is the same kind of curve through the waypoints, but laid
//     out by distance instead of by time (each keyframe sits at the summed
//     on-screen distance from the start), so its shape does not depend on
//     any timing.
//  2. The length of that route on screen is measured — panning, zooming and
//     turning, see `screenSpeed`.
//  3. The camera travels it at a constant speed, ramping up after a stop
//     and down before one.
//
// The moment it passes each waypoint falls out of that, which is what
// `withEvenSpeedTimes` writes back into the keyframes.

/** Seconds the camera takes to reach or leave its even speed at a stop. */
const EVEN_SPEED_RAMP = 1;
/** Samples of the route measured per stretch between two keyframes. */
const EVEN_SPEED_SAMPLES = 48;

interface EvenRoute {
	/** The move's keyframes with `t` replaced by distance along the route. */
	layout: Keyframe[];
	/** Position along `layout` (its `t`) of each sample… */
	at: number[];
	/** …and the on-screen length of the route up to there. */
	length: number[];
}

/** On-screen distance between two keyframes, going straight from one to the other. */
function chordLength(a: Keyframe, b: Keyframe): number {
	const steps = 8;
	const at = (f: number): CameraState => ({
		lng: a.lng + shortestLngDelta(a.lng, b.lng) * f,
		lat: lerp(a.lat, b.lat, f),
		zoom: lerp(a.zoom, b.zoom, f),
		pitch: lerp(a.pitch, b.pitch, f),
		bearing: a.bearing + shortestLngDelta(a.bearing, b.bearing) * f,
		roll: a.roll + shortestLngDelta(a.roll, b.roll) * f
	});
	let sum = 0;
	for (let i = 0; i < steps; i++) sum += screenSpeed(at(i / steps), at((i + 1) / steps), 1);
	return sum;
}

function buildEvenRoute(keyframes: Keyframe[], move: Move, projection: MapProjection): EvenRoute {
	const layout: Keyframe[] = [];
	let distance = 0;
	for (let i = move.start; i <= move.end; i++) {
		// Two keyframes on the same view still need to be apart on the layout.
		if (i > move.start) distance += Math.max(1e-6, chordLength(keyframes[i - 1], keyframes[i]));
		const { hold: _hold, evenSpeed: _evenSpeed, ...kf } = keyframes[i];
		layout.push({ ...kf, t: distance });
	}
	const at = [0];
	const length = [0];
	let prev = sampleSegments(layout, 0, projection)!;
	for (let i = 0; i < layout.length - 1; i++) {
		for (let s = 1; s <= EVEN_SPEED_SAMPLES; s++) {
			const d = lerp(layout[i].t, layout[i + 1].t, s / EVEN_SPEED_SAMPLES);
			const cam = sampleSegments(layout, d, projection)!;
			at.push(d);
			length.push(length[length.length - 1] + screenSpeed(prev, cam, 1));
			prev = cam;
		}
	}
	return { layout, at, length };
}

// Measuring a route takes a few hundred camera samples, and playback asks
// for the same move every frame. Keyed by the keyframe array itself: the
// store replaces it on every edit, which is exactly when a route is stale.
const evenRouteCache = new WeakMap<Keyframe[], Map<string, EvenRoute>>();

function evenRoute(keyframes: Keyframe[], move: Move, projection: MapProjection): EvenRoute {
	let perArray = evenRouteCache.get(keyframes);
	if (!perArray) evenRouteCache.set(keyframes, (perArray = new Map()));
	const key = `${move.start}:${projection}`;
	let route = perArray.get(key);
	if (!route) perArray.set(key, (route = buildEvenRoute(keyframes, move, projection)));
	return route;
}

/**
 * Share of the route covered after `time` seconds of a move that takes
 * `duration`: speed ramps up over `rampIn`, stays constant, ramps down over
 * `rampOut`. With no ramps this is just `time / duration`.
 */
function evenProgress(time: number, duration: number, rampIn: number, rampOut: number): number {
	if (time <= 0) return 0;
	if (time >= duration) return 1;
	// Constant speed such that the area under the speed curve is 1.
	const speed = 1 / (duration - rampIn / 2 - rampOut / 2);
	if (time < rampIn) return (speed * time * time) / (2 * rampIn);
	if (time > duration - rampOut) {
		const left = duration - time;
		return 1 - (speed * left * left) / (2 * rampOut);
	}
	return speed * (time - rampIn / 2);
}

/** The ramps of an even-speed move: one at each end that is a stop. */
function evenRamps(keyframes: Keyframe[], move: Move, duration: number): [number, number] {
	const ramp = Math.min(EVEN_SPEED_RAMP, duration / 3);
	return [keyframes[move.start].waypoint ? 0 : ramp, keyframes[move.end].waypoint ? 0 : ramp];
}

function sampleEvenMove(
	keyframes: Keyframe[],
	move: Move,
	t: number,
	projection: MapProjection
): CameraState {
	const from = departureOf(keyframes[move.start]);
	const duration = keyframes[move.end].t - from;
	const { layout, at, length } = evenRoute(keyframes, move, projection);
	const total = length[length.length - 1];
	const target = total * evenProgress(t - from, duration, ...evenRamps(keyframes, move, duration));
	// Find the two samples the target length lies between.
	let lo = 0;
	let hi = length.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (length[mid] <= target) lo = mid;
		else hi = mid;
	}
	const span = length[hi] - length[lo];
	const f = span > 0 ? (target - length[lo]) / span : 0;
	return sampleSegments(layout, lerp(at[lo], at[hi], f), projection)!;
}

/** Does this move run at even speed? Only a move through waypoints can. */
function isEvenSpeedMove(keyframes: Keyframe[], move: Move): boolean {
	return move.kind === 'curve' && keyframes[move.start].evenSpeed === true;
}

/**
 * The indices of the waypoints that time themselves: those inside a move
 * with `evenSpeed`.
 */
export function selfTimedWaypoints(keyframes: Keyframe[]): Set<number> {
	const out = new Set<number>();
	for (const move of movesOf(keyframes)) {
		if (!isEvenSpeedMove(keyframes, move)) continue;
		for (let i = move.start + 1; i < move.end; i++) out.add(i);
	}
	return out;
}

/**
 * The keyframes with every self-timed waypoint moved to the moment the
 * camera passes it, to the millisecond. Returns the same array when nothing
 * had to change.
 */
export function withEvenSpeedTimes(keyframes: Keyframe[], projection: MapProjection): Keyframe[] {
	let out = keyframes;
	for (const move of movesOf(keyframes)) {
		if (!isEvenSpeedMove(keyframes, move)) continue;
		const from = departureOf(keyframes[move.start]);
		const duration = keyframes[move.end].t - from;
		if (!(duration > 0)) continue;
		const { length } = buildEvenRoute(keyframes, move, projection);
		const total = length[length.length - 1];
		const ramps = evenRamps(keyframes, move, duration);
		for (let i = move.start + 1; i < move.end; i++) {
			// Length of the route up to this waypoint: it sits on a sample.
			const k = i - move.start;
			const share =
				total > 0 ? length[k * EVEN_SPEED_SAMPLES] / total : k / (move.end - move.start);
			// When is that share covered? `evenProgress` only ever rises.
			let lo = 0;
			let hi = duration;
			for (let n = 0; n < 40; n++) {
				const mid = (lo + hi) / 2;
				if (evenProgress(mid, duration, ...ramps) < share) lo = mid;
				else hi = mid;
			}
			const t = Math.round((from + (lo + hi) / 2) * 1000) / 1000;
			if (t === keyframes[i].t) continue;
			if (out === keyframes) out = [...keyframes];
			out[i] = { ...keyframes[i], t };
		}
	}
	return out;
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
	if (keyframes.length > 1 && t > keyframes[0].t && t < keyframes[keyframes.length - 1].t) {
		for (const move of movesOf(keyframes)) {
			if (!isEvenSpeedMove(keyframes, move)) continue;
			// Only the times of the two ends count — see the section above.
			if (t > departureOf(keyframes[move.start]) && t < keyframes[move.end].t) {
				return sampleEvenMove(keyframes, move, t, projection);
			}
		}
	}
	return sampleSegments(keyframes, t, projection);
}

/** `sampleAt` for keyframes that are each passed at their own time `t`. */
function sampleSegments(
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
			// The curve through a waypoint needs the keyframe beyond it.
			const prev = a.waypoint && i > 0 ? leaving(keyframes[i - 1]) : null;
			const next = b.waypoint && i + 2 < keyframes.length ? keyframes[i + 2] : null;
			return interpolateKeyframes(leaving(a), b, alpha, projection, { prev, next });
		}
	}
	return cameraOf(last);
}
