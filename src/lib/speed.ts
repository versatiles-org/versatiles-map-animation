import { sampleAt } from './interpolate';
import { screenSpeed } from './screen_speed';
import type { Keyframe, MapProjection } from './types';

export { screenSpeed, SPEED_FAST, SPEED_VERY_FAST } from './screen_speed';

/** The longest stretch of time a speed is measured over, in seconds: a frame of video. */
const SPEED_FRAME = 1 / 60;

/**
 * The speed of the picture at `samples` evenly spaced moments between the
 * times `from` and `to` of an animation: at the middle of each of that many
 * intervals, over the frame around it. Not over the whole interval — while
 * the camera zooms, how far the picture has moved after a long step says
 * little about how fast it moves, and reads far too high.
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
	const dt = Math.min(step, SPEED_FRAME);
	const out: number[] = [];
	for (let i = 0; i < samples; i++) {
		const start = from + (i + 0.5) * step - dt / 2;
		const prev = sampleAt(keyframes, start, projection);
		const next = sampleAt(keyframes, start + dt, projection);
		out.push(prev && next ? screenSpeed(prev, next, dt) : 0);
	}
	return out;
}
