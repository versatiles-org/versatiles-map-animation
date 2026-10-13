import { sampleAt } from './interpolate';
import { screenSpeed, SPEED_FAST, SPEED_VERY_FAST } from './screen_speed';
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

// ---------------------------------------------------------------------------
// Drawing the speed of a move on the timeline
// ---------------------------------------------------------------------------

/** Moments per move at which its speed is measured for the timeline. */
export const SPEED_SAMPLES = 64;

/**
 * The colour that marks a speed as too fast to follow: clear below
 * `SPEED_FAST`, orange up to `SPEED_VERY_FAST`, red beyond.
 */
export function speedColor(speed: number): string {
	if (speed < SPEED_FAST) return 'transparent';
	if (speed >= SPEED_VERY_FAST) return '#ff4d4d';
	const alpha = 0.55 + (0.45 * (speed - SPEED_FAST)) / (SPEED_VERY_FAST - SPEED_FAST);
	return `rgba(255, 165, 40, ${alpha.toFixed(2)})`;
}

/**
 * Where a move is too fast, as a CSS gradient from its start to its end
 * with a `speedColor` per moment — the strip along the bottom of a move's
 * band. `null` for a move that is nowhere too fast.
 */
export function speedGradient(profile: readonly number[]): string | null {
	if (!profile.some((speed) => speed >= SPEED_FAST)) return null;
	const stops = profile.map(
		(speed, i) => `${speedColor(speed)} ${(((i + 0.5) / profile.length) * 100).toFixed(1)}%`
	);
	return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * The speed that reaches the top of a band, given the peak of every move.
 * The same for all of them, so their curves compare: a little above the
 * fastest — but not so low that an animation that hardly moves looks like
 * it races.
 */
export function speedScaleFor(peaks: readonly number[]): number {
	return 1.1 * Math.max(SPEED_FAST / 3, ...peaks);
}

/**
 * The speed of a move over its time as the outline of an area: an SVG path
 * in a box as wide as the profile is long and 1 high (y points down), with
 * the speed `scale` at the top.
 */
export function speedCurve(profile: readonly number[], scale: number): string {
	if (profile.length === 0) return '';
	const y = (speed: number) => (1 - Math.min(1, speed / scale)).toFixed(3);
	// Each value is the speed over one interval: drawn at its middle, and
	// carried on level to the two ends of the move.
	const points = profile.map((speed, i) => `L${i + 0.5},${y(speed)}`).join('');
	return `M0,1L0,${y(profile[0])}${points}L${profile.length},${y(profile.at(-1)!)}L${profile.length},1Z`;
}

/** What the tooltip of a move says about its speed; nothing unless it is too fast. */
export function speedNote(peak: number): string {
	if (peak < SPEED_FAST) return '';
	const word = peak >= SPEED_VERY_FAST ? 'very fast' : 'fast';
	return ` — ${word}: up to ${peak.toFixed(1)} frame widths per second`;
}
