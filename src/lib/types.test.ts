import { describe, expect, it } from 'vitest';
import {
	normalizeScreenAnchor,
	screenAnchorPadding,
	snapKeyframeTimes,
	snapTime,
	TIME_RESOLUTION,
	type Keyframe
} from './types';

describe('screenAnchorPadding', () => {
	/** Middle of what the padding leaves free, as fractions of the frame. */
	const middle = (x: number, y: number, w = 1280, h = 720) => {
		const p = screenAnchorPadding({ x, y }, w, h);
		return [(p.left + (w - p.right)) / 2 / w, (p.top + (h - p.bottom)) / 2 / h];
	};

	it('pads nothing for the middle of the frame', () => {
		expect(screenAnchorPadding({ x: 0.5, y: 0.5 }, 1280, 720)).toEqual({
			top: 0,
			right: 0,
			bottom: 0,
			left: 0
		});
	});

	it('leaves a free area whose middle is the anchor', () => {
		for (const [x, y] of [
			[0.25, 0.7],
			[0.9, 0.1],
			[0, 0],
			[1, 1]
		]) {
			const [mx, my] = middle(x, y);
			expect(mx).toBeCloseTo(x, 10);
			expect(my).toBeCloseTo(y, 10);
		}
	});

	it('pads one side per axis, in proportion to the frame', () => {
		expect(screenAnchorPadding({ x: 0.25, y: 0.7 }, 1280, 720)).toEqual({
			left: 0,
			right: 640,
			top: expect.closeTo(288, 6),
			bottom: 0
		});
		const half = screenAnchorPadding({ x: 0.25, y: 0.7 }, 640, 360);
		expect(half.right).toBe(320);
		expect(half.top).toBeCloseTo(144, 6);
	});
});

describe('normalizeScreenAnchor', () => {
	it('rounds to whole percent and clamps into the frame', () => {
		expect(normalizeScreenAnchor({ x: 0.254, y: 0.7 })).toEqual({ x: 0.25, y: 0.7 });
		expect(normalizeScreenAnchor({ x: -0.2, y: 3 })).toEqual({ x: 0, y: 1 });
	});

	it('rejects anything that is not a pair of finite numbers', () => {
		for (const value of [undefined, null, 'centre', {}, { x: 0.5 }, { x: NaN, y: 0.5 }]) {
			expect(normalizeScreenAnchor(value)).toBeUndefined();
		}
	});
});

describe('time resolution', () => {
	const kf = (t: number, extra: Partial<Keyframe> = {}): Keyframe => ({
		t,
		lng: 0,
		lat: 0,
		zoom: 5,
		pitch: 0,
		bearing: 0,
		roll: 0,
		...extra
	});

	it('is a hundredth of a second', () => {
		expect(TIME_RESOLUTION).toBe(0.01);
	});

	it('snapTime rounds to the grid and leaves clean decimals', () => {
		expect(snapTime(3.274)).toBe(3.27);
		expect(snapTime(3.275001)).toBe(3.28);
		expect(snapTime(0.004)).toBe(0);
		// No floating-point dust, for any step.
		for (let i = 0; i <= 1000; i++)
			expect(String(snapTime(i * 0.01)).length).toBeLessThanOrEqual(5);
	});

	it('snapKeyframeTimes puts times and holds on the grid, sorted', () => {
		const out = snapKeyframeTimes([kf(4.004), kf(1.234, { hold: 0.777 }), kf(0)]);
		expect(out.map((k) => k.t)).toEqual([0, 1.23, 4]);
		expect(out.map((k) => k.hold)).toEqual([undefined, 0.78, undefined]);
	});

	it('keeps keyframes one step apart, and out of the hold before them', () => {
		// Three keyframes within the same hundredth of a second.
		expect(snapKeyframeTimes([kf(1.001), kf(1.002), kf(1.003)]).map((k) => k.t)).toEqual([
			1, 1.01, 1.02
		]);
		// A keyframe that sits inside the hold before it moves behind it.
		expect(snapKeyframeTimes([kf(1, { hold: 2 }), kf(2), kf(5)]).map((k) => k.t)).toEqual([
			1, 3.01, 5
		]);
	});

	it('drops what cannot be: negative times, empty holds, holds on waypoints', () => {
		const out = snapKeyframeTimes([
			kf(-1),
			kf(1, { hold: 0.001 }),
			kf(2, { hold: 3, waypoint: true }),
			kf(3, { hold: -2 })
		]);
		expect(out.map((k) => k.t)).toEqual([0, 1, 2, 3]);
		for (const k of out) expect(k).not.toHaveProperty('hold');
	});

	it('leaves keyframes that are already on the grid as they are, without touching the input', () => {
		const input = [kf(0), kf(1.5, { hold: 0.5, path: 'linear' }), kf(4, { waypoint: true }), kf(6)];
		const copy = structuredClone(input);
		expect(snapKeyframeTimes(input)).toEqual(input);
		expect(input).toEqual(copy);
	});
});
