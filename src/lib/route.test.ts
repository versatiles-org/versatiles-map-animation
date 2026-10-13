import { describe, expect, it } from 'vitest';
import { routeFeatures } from './route';
import type { Keyframe } from './types';

const kf = (t: number, lng: number, lat: number, extra: Partial<Keyframe> = {}): Keyframe => ({
	t,
	lng,
	lat,
	zoom: 5,
	pitch: 0,
	bearing: 0,
	roll: 0,
	...extra
});

describe('routeFeatures', () => {
	it('is empty without a move', () => {
		expect(routeFeatures([], 'mercator').features).toEqual([]);
		expect(routeFeatures([kf(0, 0, 0)], 'mercator').features).toEqual([]);
	});

	it('draws one line per move, tagged with its kind and start', () => {
		const keyframes = [
			kf(0, 0, 0),
			kf(1, 10, 0, { waypoint: true }),
			kf(2, 10, 10, { path: 'linear' }),
			kf(3, 20, 10)
		];
		const { features } = routeFeatures(keyframes, 'mercator');
		expect(features.map((f) => f.properties)).toEqual([
			{ kind: 'curve', start: 0 },
			{ kind: 'linear', start: 2 }
		]);
	});

	it('starts and ends each line on its stops and passes through the waypoints', () => {
		const keyframes = [kf(0, 0, 0), kf(1, 10, 0, { waypoint: true }), kf(2, 10, 10), kf(3, 20, 10)];
		const [curve, straight] = routeFeatures(keyframes, 'mercator').features.map(
			(f) => f.geometry.coordinates
		);
		expect(curve[0]).toEqual([0, 0]);
		expect(curve[curve.length - 1]).toEqual([10, 10]);
		expect(curve).toContainEqual([10, 0]);
		expect(straight[0]).toEqual([10, 10]);
		expect(straight[straight.length - 1]).toEqual([20, 10]);
	});

	it('follows where the camera really goes: a curve swings wide around a waypoint', () => {
		const corner = [kf(0, 0, 0), kf(1, 10, 0, { waypoint: true }), kf(2, 10, 10)];
		const line = routeFeatures(corner, 'mercator').features[0].geometry.coordinates;
		// East then north: it dips south of the first leg and overshoots east of the second.
		expect(line.some(([, lat]) => lat < -0.1)).toBe(true);
		expect(line.some(([lng]) => lng > 10.1)).toBe(true);
	});

	it('bends along the great circle on the globe but not in Mercator', () => {
		const keyframes = [kf(0, -60, 50), kf(4, 60, 50)];
		const top = (projection: 'mercator' | 'globe') =>
			Math.max(
				...routeFeatures(keyframes, projection).features[0].geometry.coordinates.map((c) => c[1])
			);
		expect(top('mercator')).toBeCloseTo(50, 6);
		expect(top('globe')).toBeGreaterThan(60);
	});

	it('keeps a line across the date line in one piece', () => {
		const keyframes = [
			kf(0, 170, 0, { path: 'linear' }),
			kf(1, -170, 0, { path: 'linear' }),
			kf(2, -150, 0)
		];
		const lines = routeFeatures(keyframes, 'mercator').features.map((f) => f.geometry.coordinates);
		const all = lines.flat();
		for (let i = 1; i < all.length; i++)
			expect(Math.abs(all[i][0] - all[i - 1][0])).toBeLessThan(5);
		expect(all[all.length - 1][0]).toBeCloseTo(210, 6);
	});

	it('does not draw anything for the time a stop holds', () => {
		const plain = [kf(0, 0, 0, { path: 'linear' }), kf(2, 10, 0)];
		const held = [kf(0, 0, 0, { path: 'linear', hold: 5 }), kf(7, 10, 0)];
		const coords = (k: Keyframe[]) => routeFeatures(k, 'mercator').features[0].geometry.coordinates;
		expect(coords(held)).toEqual(coords(plain));
	});
});
