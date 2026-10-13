import { MAP_REFERENCE_WIDTH, MAX_CAMERA_LATITUDE, type CameraState } from './types';

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

// The frame the speed is measured in: the reference width at 16:9, seen
// through MapLibre's camera (vertical field of view 36.87°), which puts the
// camera this many pixels away from the point it looks at.
const FRAME_HEIGHT = (MAP_REFERENCE_WIDTH * 9) / 16;
const CAMERA_DISTANCE = FRAME_HEIGHT / 2 / Math.tan((36.87 / 2) * DEG);
/** Past this the ground at the centre of the frame is nearly edge-on. */
const MAX_PITCH = 85;

/**
 * Where on the frame the motion is measured, as offsets from its centre
 * (x right, y up): a grid over the lower half. That half always shows
 * ground — above the centre a tilted camera soon looks at the sky.
 */
const PROBES: [number, number][] = [-1, -0.5, 0, 0.5, 1].flatMap((fx) =>
	[0, -1 / 3, -2 / 3, -1].map((fy): [number, number] => [
		(fx * MAP_REFERENCE_WIDTH) / 2,
		(fy * FRAME_HEIGHT) / 2
	])
);

function angleDelta(a: number, b: number): number {
	return ((((b - a + 180) % 360) + 360) % 360) - 180;
}

/** Pixels per degree of arc on the ground at the centre of a camera's view. */
function groundScale(cam: CameraState): number {
	const lat = Math.min(MAX_CAMERA_LATITUDE, Math.abs(cam.lat));
	return (WORLD_SIZE * Math.pow(2, cam.zoom)) / (360 * Math.cos(lat * DEG));
}

function pitchOf(cam: CameraState): number {
	return Math.max(0, Math.min(MAX_PITCH, cam.pitch)) * DEG;
}

/**
 * The spot on the ground a camera shows at a frame position, as degrees of
 * arc east and north of the point the camera looks at. The ground is taken
 * as a flat plane — terrain and the curve of the globe are ignored.
 */
function frameToGround(cam: CameraState, x: number, y: number): [number, number] {
	const pitch = pitchOf(cam);
	const roll = cam.roll * DEG;
	const bearing = cam.bearing * DEG;
	// Undo the roll, then the perspective: `ahead` and `right` are pixels on
	// the ground plane, at the scale it has at the centre of the view.
	const fx = x * Math.cos(roll) + y * Math.sin(roll);
	const fy = -x * Math.sin(roll) + y * Math.cos(roll);
	const ahead = (fy * CAMERA_DISTANCE) / (CAMERA_DISTANCE * Math.cos(pitch) - fy * Math.sin(pitch));
	const right = (fx * (CAMERA_DISTANCE + ahead * Math.sin(pitch))) / CAMERA_DISTANCE;
	const scale = groundScale(cam);
	return [
		(right * Math.cos(bearing) + ahead * Math.sin(bearing)) / scale,
		(-right * Math.sin(bearing) + ahead * Math.cos(bearing)) / scale
	];
}

/** Inverse of `frameToGround`. */
function groundToFrame(cam: CameraState, east: number, north: number): [number, number] {
	const pitch = pitchOf(cam);
	const roll = cam.roll * DEG;
	const bearing = cam.bearing * DEG;
	const scale = groundScale(cam);
	const right = (east * Math.cos(bearing) - north * Math.sin(bearing)) * scale;
	const ahead = (east * Math.sin(bearing) + north * Math.cos(bearing)) * scale;
	// Never closer than a sliver in front of the camera.
	const depth = Math.max(CAMERA_DISTANCE * 0.05, CAMERA_DISTANCE + ahead * Math.sin(pitch));
	const fx = (right * CAMERA_DISTANCE) / depth;
	const fy = (ahead * Math.cos(pitch) * CAMERA_DISTANCE) / depth;
	return [fx * Math.cos(roll) - fy * Math.sin(roll), fx * Math.sin(roll) + fy * Math.cos(roll)];
}

/**
 * Speed of the picture between two cameras `dt` seconds apart, in frame
 * widths per second.
 *
 * Measured the way one would with a ruler on the screen: take a grid of
 * spots on the first frame, find the ground each one shows, see where that
 * ground is on the second frame, and average how far the spots moved (root
 * mean square). Panning, zooming, turning, rolling and tilting all move the
 * picture and so all count, each as much as it really does — including the
 * way a steeply tilted camera makes the foreground rush past while the
 * distance hardly moves.
 */
export function screenSpeed(a: CameraState, b: CameraState, dt: number): number {
	if (!(dt > 0)) return 0;
	// From the first camera's centre to the second's, in degrees of arc.
	const midLat = Math.min(MAX_CAMERA_LATITUDE, Math.abs((a.lat + b.lat) / 2));
	const east = angleDelta(a.lng, b.lng) * Math.cos(midLat * DEG);
	const north = b.lat - a.lat;
	let sum = 0;
	for (const [x, y] of PROBES) {
		const [e, n] = frameToGround(a, x, y);
		const [x2, y2] = groundToFrame(b, e - east, n - north);
		sum += (x2 - x) ** 2 + (y2 - y) ** 2;
	}
	return Math.sqrt(sum / PROBES.length) / dt / MAP_REFERENCE_WIDTH;
}
