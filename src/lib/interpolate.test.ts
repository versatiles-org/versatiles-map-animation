import { describe, it, expect } from 'vitest';
import { easeInOut, interpolateKeyframes, lerp, lerpAngle, sampleAt } from './interpolate';
import type { Keyframe } from './types';

describe('easeInOut', () => {
	it('is 0 at 0 and 1 at 1', () => {
		expect(easeInOut(0)).toBe(0);
		expect(easeInOut(1)).toBe(1);
	});
	it('is 0.5 at midpoint', () => {
		expect(easeInOut(0.5)).toBeCloseTo(0.5);
	});
	it('clamps below 0 and above 1', () => {
		expect(easeInOut(-1)).toBe(0);
		expect(easeInOut(2)).toBe(1);
	});
});

describe('lerp', () => {
	it('linearly interpolates', () => {
		expect(lerp(0, 10, 0)).toBe(0);
		expect(lerp(0, 10, 0.5)).toBe(5);
		expect(lerp(0, 10, 1)).toBe(10);
	});
});

describe('lerpAngle', () => {
	it('takes the shortest path across 360/0 wrap (350 -> 10 = +20)', () => {
		// halfway should be 0 (= 360 normalized)
		expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 5);
	});
	it('takes shortest path the other direction (10 -> 350 = -20)', () => {
		expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 5);
	});
	it('reaches target at alpha=1 (normalized)', () => {
		expect(lerpAngle(350, 10, 1)).toBeCloseTo(10, 5);
		expect(lerpAngle(10, 350, 1)).toBeCloseTo(-10, 5); // 350 normalized to -10
	});
	it('handles direct interpolation without wrap (0 -> 90)', () => {
		expect(lerpAngle(0, 90, 0.5)).toBeCloseTo(45, 5);
	});
	it('handles negative bearings (-170 -> 170, shortest path is -20)', () => {
		// Midpoint is the antimeridian — either 180 or -180 represents it
		const v = lerpAngle(-170, 170, 0.5);
		expect(Math.abs(Math.abs(v) - 180)).toBeLessThan(1e-5);
	});
});

describe('interpolateKeyframes', () => {
	const a: Keyframe = { t: 0, lng: 0, lat: 0, zoom: 0, pitch: 0, bearing: 0, roll: 0 };
	const b: Keyframe = { t: 10, lng: 10, lat: 20, zoom: 5, pitch: 60, bearing: 90, roll: 30 };

	it('returns A at alpha=0', () => {
		const out = interpolateKeyframes(a, b, 0);
		expect(out.lng).toBe(0);
		expect(out.lat).toBe(0);
		expect(out.zoom).toBe(0);
		expect(out.bearing).toBe(0);
	});
	it('returns B at alpha=1', () => {
		const out = interpolateKeyframes(a, b, 1);
		expect(out.lng).toBeCloseTo(10);
		expect(out.lat).toBeCloseTo(20);
		expect(out.zoom).toBeCloseTo(5);
		expect(out.bearing).toBeCloseTo(90);
		expect(out.roll).toBeCloseTo(30);
	});
	it('interpolates non-position fields linearly under easing', () => {
		const out = interpolateKeyframes(a, b, 0.5);
		// pitch/bearing/roll are linearly eased, easeInOut(0.5)=0.5
		expect(out.pitch).toBeCloseTo(30);
		expect(out.bearing).toBeCloseTo(45);
		expect(out.roll).toBeCloseTo(15);
	});
	it('with equal zoom, midpoint position is the geographic midpoint', () => {
		// w0 = w1 makes the van Wijk path symmetric around the midpoint.
		const a2: Keyframe = { ...a, zoom: 4 };
		const b2: Keyframe = { ...a2, lng: 10, lat: 0 };
		const mid = interpolateKeyframes(a2, b2, 0.5);
		expect(mid.lng).toBeCloseTo(5, 5);
	});
	it('arcs through a lower zoom when zooming + panning a long distance', () => {
		// At alpha=0.5 the camera should be _lower zoom_ than the linear average,
		// which is the whole point of van Wijk — fly out, then back in.
		const c: Keyframe = { t: 0, lng: 0, lat: 0, zoom: 8, pitch: 0, bearing: 0, roll: 0 };
		const d: Keyframe = { t: 10, lng: 30, lat: 30, zoom: 8, pitch: 0, bearing: 0, roll: 0 };
		const linearMidZoom = (c.zoom + d.zoom) / 2; // 8
		const out = interpolateKeyframes(c, d, 0.5);
		expect(out.zoom).toBeLessThan(linearMidZoom);
	});
	it('respects origin path: "linear" — direct lerp, no zoom-out arc', () => {
		// path is on the *origin* keyframe (kfA) and describes the trajectory
		// LEAVING it.
		const c: Keyframe = {
			t: 0,
			lng: 0,
			lat: 0,
			zoom: 8,
			pitch: 0,
			bearing: 0,
			roll: 0,
			path: 'linear'
		};
		const d: Keyframe = { t: 10, lng: 30, lat: 30, zoom: 8, pitch: 0, bearing: 0, roll: 0 };
		const out = interpolateKeyframes(c, d, 0.5);
		// Both endpoints at zoom 8 → midpoint should be exactly 8 with linear path.
		expect(out.zoom).toBeCloseTo(8, 5);
		expect(out.lat).toBeCloseTo(15, 5);
	});
});

describe('sampleAt', () => {
	const kfs: Keyframe[] = [
		{ t: 0, lng: 0, lat: 0, zoom: 0, pitch: 0, bearing: 0, roll: 0 },
		{ t: 10, lng: 10, lat: 0, zoom: 0, pitch: 0, bearing: 0, roll: 0 }
	];

	it('returns null on empty array', () => {
		expect(sampleAt([], 0)).toBeNull();
	});
	it('holds first kf before its time', () => {
		expect(sampleAt(kfs, -5)?.lng).toBe(0);
	});
	it('holds last kf past its time', () => {
		expect(sampleAt(kfs, 999)?.lng).toBe(10);
	});
	it('interpolates between kfs', () => {
		const out = sampleAt(kfs, 5);
		expect(out?.lng).toBeCloseTo(5); // ease-in-out at 0.5 = 0.5
	});
	it('returns the only kf when only one is provided', () => {
		expect(sampleAt([kfs[0]], 5)?.lng).toBe(0);
	});
	it('returns exactly the kf at its own t', () => {
		const out = sampleAt(kfs, 0);
		expect(out?.lng).toBe(0);
	});
});
