import { describe, expect, it } from 'vitest';
import { screenSpeed, SPEED_FAST, SPEED_VERY_FAST, speedProfile } from './speed';
import type { CameraState, Keyframe } from './types';

const cam = (extra: Partial<CameraState> = {}): CameraState => ({
	lng: 0,
	lat: 0,
	zoom: 0,
	pitch: 0,
	bearing: 0,
	roll: 0,
	...extra
});

describe('screenSpeed', () => {
	it('is zero for a still camera and for no time', () => {
		expect(screenSpeed(cam(), cam(), 1)).toBe(0);
		expect(screenSpeed(cam(), cam({ lng: 10 }), 0)).toBe(0);
	});

	it('is one frame width per second when the ground passes by one frame width in a second', () => {
		// At zoom 0 the world is 512 px wide; the frame is 1280 px: 2.5 worlds.
		expect(screenSpeed(cam(), cam({ lng: 9 }), 0.01)).toBeCloseTo(9 / 360 / 2.5 / 0.01, 6);
		// The same distance on the ground is twice as far on screen one zoom level in…
		const z0 = screenSpeed(cam({ zoom: 5 }), cam({ zoom: 5, lng: 0.1 }), 1);
		const z1 = screenSpeed(cam({ zoom: 6 }), cam({ zoom: 6, lng: 0.1 }), 1);
		expect(z1 / z0).toBeCloseTo(2, 9);
		// …and takes half the speed in twice the time.
		expect(screenSpeed(cam(), cam({ lng: 9 }), 2) * 2).toBeCloseTo(
			screenSpeed(cam(), cam({ lng: 9 }), 1),
			9
		);
	});

	it('measures distance on the ground, not in degrees of longitude', () => {
		// A degree of longitude at 60° north is half as long, but the map is
		// twice as large there at the same zoom: the same speed on screen.
		const equator = screenSpeed(cam({ zoom: 6 }), cam({ zoom: 6, lng: 0.01 }), 1);
		const north = screenSpeed(cam({ zoom: 6, lat: 60 }), cam({ zoom: 6, lat: 60, lng: 0.01 }), 1);
		expect(north / equator).toBeCloseTo(1, 4);
	});

	it('counts zooming and turning too, and takes the short way round', () => {
		// One zoom level per second: the edge moves ln 2 × half a frame.
		expect(screenSpeed(cam(), cam({ zoom: 1 }), 1)).toBeCloseTo(Math.LN2 / 2, 9);
		expect(screenSpeed(cam({ zoom: 1 }), cam(), 1)).toBeCloseTo(Math.LN2 / 2, 9);
		// A quarter turn per second: the edge swings π/2 × half a frame.
		expect(screenSpeed(cam(), cam({ bearing: 90 }), 1)).toBeCloseTo(Math.PI / 4, 9);
		expect(screenSpeed(cam({ bearing: 170 }), cam({ bearing: -170 }), 1)).toBeCloseTo(
			screenSpeed(cam(), cam({ bearing: 20 }), 1),
			9
		);
		expect(screenSpeed(cam(), cam({ roll: 90 }), 1)).toBeCloseTo(Math.PI / 4, 9);
	});

	it('has thresholds in a sensible order', () => {
		expect(SPEED_FAST).toBeGreaterThan(0);
		expect(SPEED_VERY_FAST).toBeGreaterThan(SPEED_FAST);
	});
});

describe('speedProfile', () => {
	const kf = (t: number, lng: number, extra: Partial<Keyframe> = {}): Keyframe => ({
		t,
		lng,
		lat: 0,
		zoom: 8,
		pitch: 0,
		bearing: 0,
		roll: 0,
		path: 'linear',
		...extra
	});

	it('is empty for a span without length', () => {
		expect(speedProfile([kf(0, 0), kf(1, 1)], 'mercator', 1, 1)).toEqual([]);
	});

	it('rises and falls over an eased move, and is slow at both stops', () => {
		const profile = speedProfile([kf(0, 0), kf(4, 1)], 'mercator', 0, 4, 16);
		expect(profile).toHaveLength(16);
		const peak = Math.max(...profile);
		expect(profile.indexOf(peak)).toBeGreaterThanOrEqual(7);
		expect(profile.indexOf(peak)).toBeLessThanOrEqual(8);
		expect(profile[0]).toBeLessThan(peak / 10);
		expect(profile[15]).toBeLessThan(peak / 10);
	});

	it('halves when the same move takes twice as long', () => {
		const quick = Math.max(...speedProfile([kf(0, 0), kf(2, 1)], 'mercator', 0, 2));
		const slow = Math.max(...speedProfile([kf(0, 0), kf(4, 1)], 'mercator', 0, 4));
		expect(quick / slow).toBeCloseTo(2, 6);
	});

	it('is flat through evenly spaced waypoints', () => {
		const via = (t: number, lng: number) => kf(t, lng, { waypoint: true });
		const profile = speedProfile([via(0, 0), via(1, 1), via(2, 2), via(3, 3)], 'mercator', 0, 3);
		expect(Math.max(...profile) / Math.min(...profile)).toBeCloseTo(1, 6);
	});

	it('is zero while a stop holds', () => {
		const held = [kf(0, 0, { hold: 2 }), kf(4, 1)];
		expect(Math.max(...speedProfile(held, 'mercator', 0, 2))).toBe(0);
	});
});
