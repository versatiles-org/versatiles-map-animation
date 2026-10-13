import { describe, expect, it } from 'vitest';
import {
	screenSpeed,
	SPEED_FAST,
	SPEED_VERY_FAST,
	speedColor,
	speedCurve,
	speedGradient,
	speedNote,
	speedProfile,
	speedScaleFor
} from './speed';
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

	// Root mean square distance of the measuring grid from the frame centre, in
	// frame widths: what one radian of turning, or a factor e of zooming, moves.
	const GRID_RADIUS =
		Math.sqrt((2 * 640 ** 2 + 2 * 320 ** 2) / 5 + (120 ** 2 + 240 ** 2 + 360 ** 2) / 4) / 1280;

	it('counts zooming, turning and rolling by how far they move the picture', () => {
		const dt = 1e-4;
		// Zooming scales the picture around its centre: ln 2 per zoom level.
		expect(screenSpeed(cam(), cam({ zoom: dt }), dt)).toBeCloseTo(GRID_RADIUS * Math.LN2, 3);
		expect(screenSpeed(cam({ zoom: dt }), cam(), dt)).toBeCloseTo(GRID_RADIUS * Math.LN2, 3);
		// Turning and rolling swing it around its centre.
		const perDegree = (GRID_RADIUS * Math.PI) / 180;
		expect(screenSpeed(cam(), cam({ bearing: dt }), dt)).toBeCloseTo(perDegree, 4);
		expect(screenSpeed(cam(), cam({ roll: dt }), dt)).toBeCloseTo(perDegree, 4);
		// …by the short way round.
		expect(screenSpeed(cam({ bearing: 179.99 }), cam({ bearing: -179.99 }), 1)).toBeCloseTo(
			screenSpeed(cam(), cam({ bearing: 0.02 }), 1),
			6
		);
	});

	it('counts tilting, and the rush of the foreground under a tilted camera', () => {
		// Tilting moves the picture too, though less than turning by the same angle.
		const tilt = screenSpeed(cam({ pitch: 40 }), cam({ pitch: 41 }), 1);
		expect(tilt).toBeGreaterThan(0.001);
		expect(tilt).toBeLessThan(screenSpeed(cam({ pitch: 40 }), cam({ pitch: 40, bearing: 1 }), 1));
		// The same flight straight ahead moves the picture more the steeper the
		// camera looks at the horizon: the ground close to it is magnified.
		const ahead = (pitch: number) =>
			screenSpeed(cam({ zoom: 10, pitch }), cam({ zoom: 10, pitch, lat: 0.001 }), 1);
		expect(ahead(60)).toBeGreaterThan(ahead(0));
		expect(ahead(80)).toBeGreaterThan(ahead(60) * 1.2);
		// Flat, a flight sideways is as fast as one ahead; tilted it is not.
		const sideways = (pitch: number) =>
			screenSpeed(cam({ zoom: 10, pitch }), cam({ zoom: 10, pitch, lng: 0.001 }), 1);
		expect(sideways(0)).toBeCloseTo(ahead(0), 6);
		expect(Math.abs(sideways(75) / ahead(75) - 1)).toBeGreaterThan(0.2);
	});

	it('agrees with MapLibre: values measured in the browser', () => {
		// Each pair was set on a real 1280 × 720 map; the same grid of screen
		// points was unprojected under the first camera and projected under the
		// second. The number is the root mean square of how far they moved, in px.
		const measured: [Partial<CameraState>, Partial<CameraState>, number][] = [
			[{ lng: 9, lat: 42.4, zoom: 12 }, { lng: 9.002, lat: 42.401, zoom: 12 }, 14.07],
			[
				{ lng: 9, lat: 42.4, zoom: 12, pitch: 75, bearing: -110 },
				{ lng: 8.998, lat: 42.3995, zoom: 12.02, pitch: 75, bearing: -110 },
				26.45
			],
			[
				{ lng: 9, lat: 42.4, zoom: 13, pitch: 55, bearing: -120 },
				{ lng: 8.999, lat: 42.3996, zoom: 13.01, pitch: 54, bearing: -119 },
				22.39
			],
			[
				{ lng: 9, lat: 42.4, zoom: 11, pitch: 60, bearing: 30, roll: 10 },
				{ lng: 9, lat: 42.4, zoom: 11, pitch: 62, bearing: 33, roll: 12 },
				45.89
			],
			[
				{ lng: -70, lat: -33, zoom: 8, pitch: 40, bearing: 200 },
				{ lng: -70.01, lat: -33.02, zoom: 8.05, pitch: 40, bearing: 201 },
				30.16
			]
		];
		for (const [a, b, px] of measured) {
			expect((screenSpeed(cam(a), cam(b), 1) * 1280) / px).toBeCloseTo(1, 2);
		}
	});

	it('stays finite when the camera looks along the ground', () => {
		const flat = screenSpeed(cam({ pitch: 90 }), cam({ pitch: 90, lat: 0.001, bearing: 5 }), 1);
		expect(Number.isFinite(flat)).toBe(true);
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
		// Measured over a frame, which is a larger part of the quick move.
		expect(quick / slow).toBeCloseTo(2, 3);
	});

	it('does not read higher with fewer samples, also while the camera zooms', () => {
		const dive = [kf(0, 0, { zoom: 2 }), kf(4, 1, { zoom: 12 })];
		const peak = (samples: number) => Math.max(...speedProfile(dive, 'mercator', 0, 4, samples));
		// Few samples may miss the fastest moment, but never exaggerate it.
		for (const samples of [8, 16, 64]) {
			expect(peak(samples)).toBeLessThan(peak(256) * 1.001);
			expect(peak(samples)).toBeGreaterThan(peak(256) * 0.7);
		}
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

describe('drawing the speed on the timeline', () => {
	it('colours only what is too fast, and red what is far too fast', () => {
		expect(speedColor(SPEED_FAST * 0.99)).toBe('transparent');
		expect(speedColor(SPEED_FAST)).toMatch(/^rgba\(255, 165, 40, 0\.55\)$/);
		expect(speedColor(SPEED_VERY_FAST)).toBe('#ff4d4d');
	});

	it('has no strip for a move that is nowhere too fast', () => {
		expect(speedGradient([0, 0.5, SPEED_FAST * 0.99])).toBeNull();
		expect(speedGradient([])).toBeNull();
		const strip = speedGradient([0, SPEED_FAST, SPEED_VERY_FAST, 0])!;
		expect(strip).toBe(
			'linear-gradient(to right, transparent 12.5%, rgba(255, 165, 40, 0.55) 37.5%, #ff4d4d 62.5%, transparent 87.5%)'
		);
	});

	it('scales all moves alike, by the fastest, and never amplifies a slow animation', () => {
		expect(speedScaleFor([0.2, 2, 1])).toBeCloseTo(2.2);
		expect(speedScaleFor([0.01])).toBeCloseTo((1.1 * SPEED_FAST) / 3);
		expect(speedScaleFor([])).toBeCloseTo((1.1 * SPEED_FAST) / 3);
	});

	it('draws the curve as a closed area, level at both ends and capped at the top', () => {
		expect(speedCurve([], 1)).toBe('');
		expect(speedCurve([0, 1, 4], 2)).toBe(
			'M0,1L0,1.000L0.5,1.000L1.5,0.500L2.5,0.000L3,0.000L3,1Z'
		);
	});

	it('mentions the speed of a move only where it is too fast', () => {
		expect(speedNote(1)).toBe('');
		expect(speedNote(2)).toBe(' — fast: up to 2.0 frame widths per second');
		expect(speedNote(3.26)).toBe(' — very fast: up to 3.3 frame widths per second');
	});
});
