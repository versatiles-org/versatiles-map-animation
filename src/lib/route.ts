import type { Feature, FeatureCollection, LineString } from 'geojson';
import { sampleAt } from './interpolate';
import { movesOf, type Move } from './moves';
import { departureOf, type Keyframe, type MapProjection } from './types';

/** Points drawn per stretch between two neighbouring keyframes. */
const SAMPLES_PER_SEGMENT = 32;

/**
 * The ground track of the camera, for drawing on the map: one line per
 * move, following the positions the camera centre really passes through
 * (so an arc on the globe bends, and a move through waypoints curves). Each
 * line carries the move's `kind` and its `start` keyframe.
 *
 * Longitudes run on past ±180° instead of jumping back, so a line across
 * the date line stays in one piece.
 */
export function routeFeatures(
	keyframes: Keyframe[],
	projection: MapProjection
): FeatureCollection<LineString, { kind: Move['kind']; start: number }> {
	const features: Feature<LineString, { kind: Move['kind']; start: number }>[] = [];
	let lastLng: number | null = null;
	const push = (line: [number, number][], lng: number, lat: number) => {
		// Continue from the previous point by the short way round.
		if (lastLng !== null) lng = lastLng + ((((lng - lastLng + 180) % 360) + 360) % 360) - 180;
		lastLng = lng;
		line.push([lng, lat]);
	};
	for (const move of movesOf(keyframes)) {
		const line: [number, number][] = [];
		for (let i = move.start; i < move.end; i++) {
			const from = departureOf(keyframes[i]);
			const to = keyframes[i + 1].t;
			if (i === move.start) push(line, keyframes[i].lng, keyframes[i].lat);
			for (let s = 1; s < SAMPLES_PER_SEGMENT; s++) {
				const cam = sampleAt(keyframes, from + ((to - from) * s) / SAMPLES_PER_SEGMENT, projection);
				if (cam) push(line, cam.lng, cam.lat);
			}
			push(line, keyframes[i + 1].lng, keyframes[i + 1].lat);
		}
		features.push({
			type: 'Feature',
			properties: { kind: move.kind, start: move.start },
			geometry: { type: 'LineString', coordinates: line }
		});
	}
	return { type: 'FeatureCollection', features };
}
