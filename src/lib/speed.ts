import { sampleAt } from './interpolate';
import { screenSpeed } from './screen_speed';
import type { Keyframe, MapProjection } from './types';

export { screenSpeed, SPEED_FAST, SPEED_VERY_FAST } from './screen_speed';

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
