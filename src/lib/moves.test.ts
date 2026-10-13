import { describe, expect, it } from 'vitest';
import { movesOf } from './moves';
import type { Keyframe } from './types';

const kf = (t: number, extra: Partial<Keyframe> = {}): Keyframe => ({
	t,
	lng: t,
	lat: 0,
	zoom: 5,
	pitch: 0,
	bearing: 0,
	roll: 0,
	...extra
});
const via = (t: number) => kf(t, { waypoint: true });

describe('movesOf', () => {
	it('has no moves for fewer than two keyframes', () => {
		expect(movesOf([])).toEqual([]);
		expect(movesOf([kf(0)])).toEqual([]);
	});

	it('is one move per pair of stops, with the style of the stop it starts from', () => {
		expect(movesOf([kf(0), kf(1, { path: 'linear' }), kf(2, { path: 'linear' })])).toEqual([
			{ start: 0, end: 1, kind: 'arc' },
			{ start: 1, end: 2, kind: 'linear' }
		]);
	});

	it('runs through waypoints from stop to stop and is then a curve', () => {
		expect(movesOf([kf(0), via(1), via(2), kf(3, { path: 'linear' }), kf(4)])).toEqual([
			{ start: 0, end: 3, kind: 'curve' },
			{ start: 3, end: 4, kind: 'linear' }
		]);
	});

	it('ignores the style of the starting stop on a curve', () => {
		expect(movesOf([kf(0, { path: 'linear' }), via(1), kf(2)])[0].kind).toBe('curve');
	});

	it('is bounded by the first and last keyframe even if they are waypoints', () => {
		expect(movesOf([via(0), kf(1), via(2)])).toEqual([
			{ start: 0, end: 1, kind: 'curve' },
			{ start: 1, end: 2, kind: 'curve' }
		]);
		expect(movesOf([via(0), via(1), via(2)])).toEqual([{ start: 0, end: 2, kind: 'curve' }]);
	});

	it('covers every segment exactly once', () => {
		const keyframes = [kf(0), via(1), kf(2), kf(3), via(4), via(5), kf(6), via(7)];
		const moves = movesOf(keyframes);
		expect(moves[0].start).toBe(0);
		expect(moves[moves.length - 1].end).toBe(keyframes.length - 1);
		for (let i = 1; i < moves.length; i++) expect(moves[i].start).toBe(moves[i - 1].end);
	});
});
