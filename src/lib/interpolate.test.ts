import { describe, it, expect } from 'vitest';
import {
	easeInOut,
	fromGlobeZoom,
	interpolateKeyframes,
	lerp,
	lerpAngle,
	sampleAt,
	toGlobeZoom
} from './interpolate';
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

describe('globe projection', () => {
	const kf = (t: number, lng: number, lat: number, zoom: number, path?: Keyframe['path']) =>
		({ t, lng, lat, zoom, pitch: 0, bearing: 0, roll: 0, ...(path && { path }) }) as Keyframe;

	it('globe zoom is the zoom at the equator and grows towards the poles', () => {
		expect(toGlobeZoom(3, 0)).toBe(3);
		expect(toGlobeZoom(3, 60)).toBeCloseTo(4, 10); // cos 60° = ½ → twice the size
		expect(toGlobeZoom(3, -60)).toBeCloseTo(4, 10);
		expect(fromGlobeZoom(toGlobeZoom(2.5, 47), 47)).toBeCloseTo(2.5, 10);
		// Past the Mercator edge MapLibre keeps the size it has at the edge.
		expect(toGlobeZoom(3, 89)).toBe(toGlobeZoom(3, 85.051129));
	});

	it('hits both keyframes exactly', () => {
		const a = kf(0, -21.9, 64.1, 1.5);
		const b = kf(4, 36.8, -1.3, 2.68);
		for (const path of ['arc', 'linear'] as const) {
			const from = { ...a, path };
			expect(interpolateKeyframes(from, b, 0, 'globe')).toMatchObject({
				lng: -21.9,
				lat: 64.1,
				zoom: 1.5
			});
			expect(interpolateKeyframes(from, b, 1, 'globe')).toMatchObject({
				lng: 36.8,
				lat: -1.3,
				zoom: 2.68
			});
		}
	});

	it('a linear move between equally sized globes keeps the globe size, unlike Mercator', () => {
		const a = kf(0, 0, 60, 2, 'linear');
		const b = kf(4, 40, 0, 3); // same globe zoom: 2 + log2(1 / cos 60°) = 3
		for (const alpha of [0.2, 0.5, 0.8]) {
			const cam = interpolateKeyframes(a, b, alpha, 'globe');
			expect(toGlobeZoom(cam.zoom, cam.lat)).toBeCloseTo(3, 10);
		}
		const mercator = interpolateKeyframes(a, b, 0.5);
		expect(mercator.zoom).toBeCloseTo(2.5, 10);
		expect(toGlobeZoom(mercator.zoom, mercator.lat)).not.toBeCloseTo(3, 1);
	});

	it('an arc follows the great circle, which bulges towards the pole', () => {
		const a = kf(0, -60, 50, 3);
		const b = kf(4, 60, 50, 3);
		const mid = interpolateKeyframes(a, b, 0.5, 'globe');
		expect(mid.lng).toBeCloseTo(0, 6);
		// Great-circle midpoint: tan(lat) = tan 50° / cos 60°.
		expect(mid.lat).toBeCloseTo(
			(Math.atan(Math.tan((50 * Math.PI) / 180) / 0.5) * 180) / Math.PI,
			6
		);
		// In Mercator the same move stays on the 50th parallel.
		expect(interpolateKeyframes(a, b, 0.5).lat).toBeCloseTo(50, 6);
		// Like any arc it rises on the way: the globe is smallest in the middle.
		expect(toGlobeZoom(mid.zoom, mid.lat)).toBeLessThan(toGlobeZoom(3, 50));
	});

	it('a route over the pole stays within the latitudes the camera can hold', () => {
		const a = kf(0, 10, 80, 2);
		const b = kf(4, -170, 80, 2);
		for (const alpha of [0.1, 0.3, 0.5, 0.7, 0.9]) {
			const cam = interpolateKeyframes(a, b, alpha, 'globe');
			expect(Math.abs(cam.lat)).toBeLessThanOrEqual(85.051129);
			expect(Number.isFinite(cam.zoom)).toBe(true);
			expect(Number.isFinite(cam.lng)).toBe(true);
		}
	});

	it('copes with antipodes and with a pure zoom', () => {
		const anti = interpolateKeyframes(kf(0, 0, 0, 2), kf(4, 180, 0, 2), 0.5, 'globe');
		expect(
			Number.isFinite(anti.lng) && Number.isFinite(anti.lat) && Number.isFinite(anti.zoom)
		).toBe(true);
		const zoomOnly = interpolateKeyframes(kf(0, 10, 50, 2), kf(4, 10, 50, 6), 0.5, 'globe');
		expect(zoomOnly).toMatchObject({ lng: 10, lat: 50 });
		expect(zoomOnly.zoom).toBeCloseTo(4, 10);
	});

	it('sampleAt passes the projection on and defaults to Mercator', () => {
		const kfs = [kf(0, 0, 60, 2, 'linear'), kf(4, 40, 0, 3)];
		expect(sampleAt(kfs, 2)).toEqual(interpolateKeyframes(kfs[0], kfs[1], 0.5, 'mercator'));
		expect(sampleAt(kfs, 2, 'globe')).toEqual(interpolateKeyframes(kfs[0], kfs[1], 0.5, 'globe'));
		expect(sampleAt(kfs, 2, 'globe')).not.toEqual(sampleAt(kfs, 2));
	});
});
