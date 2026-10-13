import { sampleAt } from './interpolate';
import {
	MAP_REFERENCE_WIDTH,
	MAX_CAMERA_LATITUDE,
	type CameraState,
	type Keyframe,
	type MapProjection
} from './types';

/**
 * How fast the picture moves, in frame widths per second — the measure of
 * whether a viewer can still follow. 1 means: what is at one edge of the
 * frame now is at the other edge a second later.
 *
 * From these on a move is marked on the timeline. They are judgement calls,
 * not physics: above `SPEED_FAST` the map is hard to read while it moves,
 * above `SPEED_VERY_FAST` it is a blur.
 */
export const SPEED_FAST = 1.5;
export const SPEED_VERY_FAST = 3;

const DEG = Math.PI / 180;
/** MapLibre's world is 512 px wide at zoom 0. */
const WORLD_SIZE = 512;

function angleDelta(a: number, b: number): number {
	return ((((b - a + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance in degrees of arc. */
function arcDegrees(a: CameraState, b: CameraState): number {
	const dLat = (b.lat - a.lat) * DEG;
	const dLng = angleDelta(a.lng, b.lng) * DEG;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
	return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG;
}

/**
 * Speed of the picture between two cameras `dt` seconds apart, in frame
 * widths per second. Three things move it:
 *
 *  - panning: the ground passing under the camera, at the map scale there;
 *  - zooming: the picture grows from its centre, fastest at the edges —
 *    half a frame width out, a point moves at ln 2 × that per zoom level;
 *  - turning (bearing and roll): the edges swing around the centre.
 *
 * They point in different directions across the frame, so they are combined
 * like the sides of a right triangle rather than added up. Tilting is left
 * out: it mostly moves the far distance.
 */
export function screenSpeed(a: CameraState, b: CameraState, dt: number): number {
	if (!(dt > 0)) return 0;
	const zoom = (a.zoom + b.zoom) / 2;
	const lat = Math.min(MAX_CAMERA_LATITUDE, Math.abs((a.lat + b.lat) / 2));
	// Both projections share this scale at the centre of the view.
	const pxPerDegree = (WORLD_SIZE * Math.pow(2, zoom)) / (360 * Math.cos(lat * DEG));
	const half = MAP_REFERENCE_WIDTH / 2;
	const pan = arcDegrees(a, b) * pxPerDegree;
	const zooming = Math.abs(b.zoom - a.zoom) * Math.LN2 * half;
	const turning =
		Math.hypot(angleDelta(a.bearing, b.bearing), angleDelta(a.roll, b.roll)) * DEG * half;
	return Math.hypot(pan, zooming, turning) / dt / MAP_REFERENCE_WIDTH;
}

/**
 * The speed of the picture at `samples` evenly spaced moments between the
 * times `from` and `to` of an animation.
 */
export function speedProfile(
	keyframes: Keyframe[],
	projection: MapProjection,
	from: number,
	to: number,
	samples = 32
): number[] {
	const step = (to - from) / samples;
	if (!(step > 0)) return [];
	const out: number[] = [];
	let prev = sampleAt(keyframes, from, projection);
	for (let i = 1; i <= samples; i++) {
		const next = sampleAt(keyframes, from + i * step, projection);
		out.push(prev && next ? screenSpeed(prev, next, step) : 0);
		prev = next;
	}
	return out;
}
