import { describe, expect, it } from 'vitest';
import { normalizeScreenAnchor, screenAnchorPadding } from './types';

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
