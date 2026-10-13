import { describe, it, expect } from 'vitest';
import {
	easeInOut,
	evenSpeedFraction,
	fromGlobeZoom,
	interpolateKeyframes,
	lerp,
	lerpAngle,
	sampleAt,
	toGlobeZoom
} from './interpolate';
import { screenSpeed, SPEED_FAST } from './screen_speed';
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

describe('waypoints', () => {
	const stop = (t: number, lng: number, lat = 0, extra: Partial<Keyframe> = {}): Keyframe => ({
		t,
		lng,
		lat,
		zoom: 5,
		pitch: 0,
		bearing: 0,
		roll: 0,
		...extra
	});
	const via = (t: number, lng: number, lat = 0, extra: Partial<Keyframe> = {}): Keyframe =>
		stop(t, lng, lat, { waypoint: true, ...extra });
	/** Speed in degrees of longitude per second around time `t`. */
	const speed = (kfs: Keyframe[], t: number, dt = 1e-4) =>
		(sampleAt(kfs, t + dt)!.lng - sampleAt(kfs, t - dt)!.lng) / (2 * dt);

	// One move through two waypoints: four keyframes, one second and ten degrees apart.
	const row = [stop(0, 0), via(1, 10), via(2, 20), stop(3, 30)];

	it('passes through every keyframe', () => {
		for (const k of row) expect(sampleAt(row, k.t)).toMatchObject({ lng: k.lng, lat: 0, zoom: 5 });
	});

	it('does not stop at a waypoint, but does at a stop', () => {
		expect(speed(row, 1)).toBeCloseTo(10, 3);
		expect(speed(row, 2)).toBeCloseTo(10, 3);
		for (const path of ['arc', 'linear'] as const) {
			const stopping = row.map((k) => stop(k.t, k.lng, 0, { path }));
			expect(Math.abs(speed(stopping, 1))).toBeLessThan(0.01);
		}
	});

	it('moves at constant speed between evenly spaced waypoints', () => {
		for (const t of [1.1, 1.5, 1.9]) expect(speed(row, t)).toBeCloseTo(10, 6);
		expect(sampleAt(row, 1.5)!.lng).toBeCloseTo(15, 9);
	});

	it('eases in at the stop the move starts from and out at the one it ends on', () => {
		expect(Math.abs(speed(row, 0.001, 1e-4))).toBeLessThan(0.1);
		expect(Math.abs(speed(row, 2.999, 1e-4))).toBeLessThan(0.1);
		expect(speed(row, 0.5)).toBeGreaterThan(5);
	});

	it('a stop between two moves is a rest, whatever the moves are', () => {
		// Move through a waypoint, stop, then a plain move.
		const mixed = [stop(0, 0), via(1, 10), stop(2, 20), stop(3, 30)];
		expect(speed(mixed, 1)).toBeGreaterThan(5);
		expect(Math.abs(speed(mixed, 2))).toBeLessThan(0.01);
		// Plain move, stop, then a move through a waypoint.
		const late = [stop(0, 0), stop(1, 10), via(2, 20), stop(3, 30)];
		expect(Math.abs(speed(late, 1))).toBeLessThan(0.01);
		expect(speed(late, 2)).toBeGreaterThan(5);
	});

	it('ignores the travel style on a move through waypoints', () => {
		const styled = row.map((k) => ({ ...k, path: 'linear' as const }));
		for (const t of [0.3, 1.5, 2.7]) expect(sampleAt(styled, t)).toEqual(sampleAt(row, t));
	});

	it('a waypoint as first keyframe starts in motion, as last keyframe ends in motion', () => {
		const flying = [via(0, 0), via(1, 10), via(2, 20), via(3, 30)];
		for (const t of [0.001, 0.5, 1.5, 2.5, 2.999]) expect(speed(flying, t)).toBeCloseTo(10, 4);
		// Only two keyframes, both waypoints: one move at constant speed.
		const two = [via(0, 0), via(2, 10)];
		expect(sampleAt(two, 0.5)!.lng).toBeCloseTo(2.5, 9);
		// Starts in motion, ends at rest.
		const landing = [via(0, 0), stop(2, 10)];
		expect(speed(landing, 0.001)).toBeCloseTo(5, 1);
		expect(Math.abs(speed(landing, 1.999))).toBeLessThan(0.1);
	});

	it('respects uneven timing: speed is continuous across a waypoint', () => {
		const uneven = [stop(0, 0), via(1, 10), via(4, 20), stop(5, 30)];
		const before = (sampleAt(uneven, 1)!.lng - sampleAt(uneven, 1 - 1e-5)!.lng) / 1e-5;
		const after = (sampleAt(uneven, 1 + 1e-5)!.lng - sampleAt(uneven, 1)!.lng) / 1e-5;
		expect(before).toBeCloseTo(after, 2);
		expect(before).toBeCloseTo(20 / 4, 2); // slope between the neighbours
	});

	it('takes the short way across the antimeridian and around the compass', () => {
		const wrap = [
			stop(0, 160, 0, { bearing: 160 }),
			via(1, 170, 0, { bearing: 170 }),
			via(2, -180, 0, { bearing: -180 }),
			stop(3, -170, 0, { bearing: -170 })
		];
		const mid = sampleAt(wrap, 1.5)!;
		expect(mid.lng).toBeCloseTo(175, 6);
		expect(mid.bearing).toBeCloseTo(175, 6);
		// The last segment eases out, so its midpoint is a little past halfway.
		const across = sampleAt(wrap, 2.5)!;
		expect(across.lng).toBeCloseTo(-173.75, 6);
		expect(across.bearing).toBeCloseTo(-173.75, 6);
	});

	it('curves through a corner instead of turning on the spot', () => {
		// East, then north: at the corner the camera is already heading north-east.
		const corner = [stop(0, 0, 0), via(1, 10, 0), via(2, 10, 10), stop(3, 10, 20)];
		const justBefore = sampleAt(corner, 0.99)!;
		const justAfter = sampleAt(corner, 1.01)!;
		expect(justAfter.lng - justBefore.lng).toBeGreaterThan(0);
		expect(justAfter.lat - justBefore.lat).toBeGreaterThan(0);
	});

	it('keeps the pitch inside what the camera can do', () => {
		const tilt = [
			stop(0, 0, 0, { pitch: 0 }),
			via(1, 1, 0, { pitch: 85 }),
			via(2, 2, 0, { pitch: 88 }),
			stop(3, 3, 0, { pitch: 0 })
		];
		for (let t = 0; t <= 3; t += 0.05) {
			const { pitch } = sampleAt(tilt, t)!;
			expect(pitch).toBeGreaterThanOrEqual(0);
			expect(pitch).toBeLessThanOrEqual(90);
		}
	});

	describe('through very different zooms', () => {
		// Reported: from the whole globe down to a valley in the Alps through a
		// waypoint, then tilting. The curve used to carry the ground speed of
		// the long haul into the zoomed-in end: the camera dived over Italy and
		// then raced to the Alps at twenty frame widths a second.
		const dive: Keyframe[] = [
			stop(0, 16.36, 35.29, { zoom: 1.73 }),
			via(5, 7.08, 46.11, { zoom: 13.24 }),
			stop(10, 7.49, 46.29, { zoom: 12.27, pitch: 67, bearing: 50 })
		];
		const projections = ['mercator', 'globe'] as const;

		it('never crosses the screen fast', () => {
			for (const projection of projections) {
				for (let t = 0; t < 10; t += 0.01) {
					const from = sampleAt(dive, t, projection)!;
					const to = sampleAt(dive, t + 0.005, projection)!;
					expect(screenSpeed(from, to, 0.005)).toBeLessThan(SPEED_FAST);
				}
			}
		});

		it('is over its target before it is close to the ground', () => {
			for (const projection of projections) {
				for (let t = 0; t <= 5; t += 0.05) {
					const cam = sampleAt(dive, t, projection)!;
					const visible = 360 / Math.pow(2, cam.zoom);
					const away = Math.hypot(cam.lng - dive[1].lng, cam.lat - dive[1].lat);
					// From zoom 6 on, the waypoint is within the frame.
					if (cam.zoom > 6) expect(away / visible).toBeLessThan(0.5);
				}
			}
		});

		it('does not swing past its keyframes', () => {
			for (const projection of projections) {
				for (let t = 0; t <= 10; t += 0.05) {
					const cam = sampleAt(dive, t, projection)!;
					// The zoom turns around at the waypoint, the rest only starts there.
					expect(cam.zoom).toBeLessThanOrEqual(13.24 + 1e-6);
					expect(cam.zoom).toBeGreaterThanOrEqual(1.73 - 1e-6);
					expect(cam.bearing).toBeGreaterThanOrEqual(-1e-6);
					expect(cam.bearing).toBeLessThanOrEqual(50 + 1e-6);
					expect(cam.pitch).toBeLessThanOrEqual(67 + 1e-6);
				}
			}
		});

		it('still passes the waypoint without a jump in speed', () => {
			const climb = [
				stop(0, 0, 0, { zoom: 4 }),
				via(2, 10, 0, { zoom: 6 }),
				via(4, 13, 0, { zoom: 8 }),
				stop(6, 14, 0, { zoom: 9 })
			];
			for (const t of [2, 4]) {
				const before = (sampleAt(climb, t)!.lng - sampleAt(climb, t - 1e-4)!.lng) / 1e-4;
				const after = (sampleAt(climb, t + 1e-4)!.lng - sampleAt(climb, t)!.lng) / 1e-4;
				expect(before).toBeGreaterThan(0);
				expect(after / before).toBeCloseTo(1, 2);
			}
			// And it only ever moves forward.
			for (let t = 0; t < 6; t += 0.05) {
				expect(sampleAt(climb, t + 0.05)!.lng).toBeGreaterThanOrEqual(sampleAt(climb, t)!.lng);
			}
		});
	});

	it('on the globe keeps the globe size between equally sized keyframes', () => {
		const globe = [
			stop(0, 0, 60, { zoom: 2 }),
			via(1, 20, 40, { zoom: fromGlobeZoom(3, 40) }),
			via(2, 40, 0, { zoom: 3 }),
			stop(3, 60, -30, { zoom: fromGlobeZoom(3, -30) })
		];
		for (const t of [0.5, 1, 1.5, 2.5]) {
			const cam = sampleAt(globe, t, 'globe')!;
			expect(toGlobeZoom(cam.zoom, cam.lat)).toBeCloseTo(3, 9);
		}
	});
});

describe('hold', () => {
	const kf = (t: number, lng: number, extra: Partial<Keyframe> = {}): Keyframe => ({
		t,
		lng,
		lat: 0,
		zoom: 5,
		pitch: 0,
		bearing: 0,
		roll: 0,
		path: 'linear',
		...extra
	});

	it('keeps the view of the stop until the hold is over, then moves in the time left', () => {
		const kfs = [kf(0, 0, { hold: 2 }), kf(4, 10)];
		for (const t of [0, 1, 2]) expect(sampleAt(kfs, t)).toMatchObject({ lng: 0 });
		// The move runs from 2 s to 4 s: halfway is at 3 s.
		expect(sampleAt(kfs, 3)!.lng).toBeCloseTo(5, 9);
		expect(sampleAt(kfs, 4)).toMatchObject({ lng: 10 });
		// Same move without the hold, two seconds earlier.
		const plain = [kf(0, 0), kf(2, 10)];
		for (const dt of [0.3, 1, 1.7]) {
			expect(sampleAt(kfs, 2 + dt)!.lng).toBeCloseTo(sampleAt(plain, dt)!.lng, 9);
		}
	});

	it('holds in the middle and at the end of an animation', () => {
		const kfs = [kf(0, 0), kf(2, 10, { hold: 3 }), kf(7, 20, { hold: 1 })];
		for (const t of [2, 3.5, 5]) expect(sampleAt(kfs, t)).toMatchObject({ lng: 10 });
		expect(sampleAt(kfs, 6)!.lng).toBeCloseTo(15, 9);
		for (const t of [7, 7.5, 8, 9]) expect(sampleAt(kfs, t)).toMatchObject({ lng: 20 });
	});

	it('a move through waypoints leaves when the hold is over', () => {
		const held = [kf(0, 0, { hold: 5 }), kf(6, 10, { waypoint: true }), kf(7, 20)];
		const plain = [kf(0, 0), kf(1, 10, { waypoint: true }), kf(2, 20)];
		for (const dt of [0.25, 0.5, 1, 1.5]) {
			expect(sampleAt(held, 5 + dt)!.lng).toBeCloseTo(sampleAt(plain, dt)!.lng, 9);
		}
	});

	it('ignores a hold on a waypoint', () => {
		const flagged = [kf(0, 0), kf(1, 10, { waypoint: true, hold: 3 }), kf(2, 20)];
		const plain = [kf(0, 0), kf(1, 10, { waypoint: true }), kf(2, 20)];
		for (const t of [0.5, 1, 1.5]) expect(sampleAt(flagged, t)).toEqual(sampleAt(plain, t));
	});
});

describe('Stay low: even speed on screen', () => {
	const kf = (t: number, lng: number, lat: number, zoom: number): Keyframe => ({
		t,
		lng,
		lat,
		zoom,
		pitch: 0,
		bearing: 0,
		roll: 0,
		path: 'linear'
	});

	it('starts at 0, ends at 1, and goes in step with the zoom when it does not change', () => {
		for (const [z0, z1] of [
			[3, 9],
			[9, 3],
			[5, 5]
		]) {
			expect(evenSpeedFraction(z0, z1, 0)).toBeCloseTo(0, 12);
			expect(evenSpeedFraction(z0, z1, 1)).toBeCloseTo(1, 12);
		}
		for (const a of [0.1, 0.5, 0.9]) expect(evenSpeedFraction(5, 5, a)).toBe(a);
	});

	it('covers most of the ground while zoomed out', () => {
		// Zooming in by 4 levels: halfway through, 80 % of the way is done.
		expect(evenSpeedFraction(4, 8, 0.5)).toBeCloseTo(0.8, 12);
		// Zooming out is the same move backwards.
		for (const a of [0.2, 0.5, 0.7]) {
			expect(evenSpeedFraction(8, 4, a)).toBeCloseTo(1 - evenSpeedFraction(4, 8, 1 - a), 12);
		}
	});

	it('keeps ground speed × map scale constant, which is the speed on screen', () => {
		const z0 = 4;
		const z1 = 9;
		const screenSpeed = (a: number, da = 1e-6) =>
			((evenSpeedFraction(z0, z1, a + da) - evenSpeedFraction(z0, z1, a - da)) / (2 * da)) *
			Math.pow(2, z0 + (z1 - z0) * a);
		const reference = screenSpeed(0.5);
		for (const a of [0.05, 0.25, 0.75, 0.95]) expect(screenSpeed(a) / reference).toBeCloseTo(1, 5);
	});

	it('moves the camera that way in Mercator', () => {
		const a = kf(0, 0, 0, 4);
		const b = kf(2, 10, 20, 8);
		const mid = interpolateKeyframes(a, b, 0.5); // easing is symmetric: halfway in zoom
		expect(mid.zoom).toBeCloseTo(6, 10);
		expect(mid.lng).toBeCloseTo(8, 10);
		expect(mid.lat).toBeCloseTo(16, 10);
		// Without a zoom change nothing changes: still the plain straight line.
		const flat = interpolateKeyframes(kf(0, 0, 0, 6), kf(2, 10, 20, 6), 0.5);
		expect(flat).toMatchObject({ lng: 5, lat: 10, zoom: 6 });
	});

	it('moves the camera that way on the globe, measured in globe size', () => {
		const a = kf(0, 0, 0, 4);
		const b = kf(2, 40, 60, 7); // globe zoom 8 at 60° north
		const mid = interpolateKeyframes(a, b, 0.5, 'globe');
		expect(mid.lng).toBeCloseTo(32, 10);
		expect(mid.lat).toBeCloseTo(48, 10);
		expect(toGlobeZoom(mid.zoom, mid.lat)).toBeCloseTo(6, 10);
	});
});
