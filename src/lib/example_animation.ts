import type { Animation } from './types';

/**
 * 15-second flight westward across Corsica's Monte Cinto massif — the
 * highest range in the Mediterranean. The camera enters from the east just
 * north of the Asco valley, banks WSW to face the spine of the massif and
 * holds there for three seconds. The second half is one continuous move:
 * it tracks across the range through three waypoints and only comes to
 * rest at the western coast. Used by the editor's
 * "Load example" menu item — and so a tour of what a path is made of: a
 * plain move between two stops, a hold, and a move through waypoints.
 *
 * Annotations mark the two summits in view during the hold: they fade in
 * as the camera arrives and out as it leaves.
 * Shared halo / icon-style settings live in `defaultAnnotation` so each
 * marker only spells out what's unique about it.
 */
export const EXAMPLE_ANIMATION: Animation = {
	version: 1,
	style: 'satellite',
	labels: true,
	hiddenLayers: ['roads', 'transit', 'boundaries', 'pois', 'markings'],
	terrain: true,
	sky: true,
	keyframes: [
		{
			t: 0,
			lng: 9.207562239246954,
			lat: 42.46742573281935,
			zoom: 13.037343523200418,
			pitch: 64.8637611162829,
			bearing: -33.59999999999956,
			roll: 0,
			path: 'linear'
		},
		{
			t: 3,
			lng: 9.025101668966386,
			lat: 42.465075378385336,
			zoom: 11.730405914063946,
			pitch: 74.36376111628292,
			bearing: -111.39718159357824,
			roll: 0,
			path: 'linear',
			hold: 3
		},
		{
			t: 8,
			lng: 8.972740905521619,
			lat: 42.44433144334781,
			zoom: 12.491358374148188,
			pitch: 78.10676998329694,
			bearing: -107.46341213301957,
			roll: 0,
			waypoint: true
		},
		{
			t: 10,
			lng: 8.927959249318633,
			lat: 42.42334184667922,
			zoom: 13.037343523200418,
			pitch: 76.86376111628292,
			bearing: -107.19999999999982,
			roll: 0,
			waypoint: true
		},
		{
			t: 12,
			lng: 8.86269699265597,
			lat: 42.382048859918086,
			zoom: 13.198243989916337,
			pitch: 53.801869957155205,
			bearing: -120.00086500982898,
			roll: 0,
			waypoint: true
		},
		{
			t: 15,
			lng: 8.790330428750764,
			lat: 42.367089388972346,
			zoom: 13.73266865294977,
			pitch: 55.85460418718874,
			bearing: -111.28520077304904,
			roll: 0
		}
	],
	annotations: [
		{
			lng: 8.9459,
			lat: 42.3795,
			label: 'Monte Cinto\n2706 m',
			visibleUntil: 6,
			visibleFrom: 3,
			fadeIn: 1,
			fadeOut: 1
		},
		{
			lng: 8.9895,
			lat: 42.4667,
			label: 'Monte Padro\n2389 m',
			visibleUntil: 6,
			visibleFrom: 3,
			fadeIn: 1,
			fadeOut: 1
		}
	],
	annotationScale: 1,
	aspectRatio: '16:9',
	defaultAnnotation: {
		icon: 'symbol-arrow1',
		iconColor: '#ffffff',
		labelPosition: 'top',
		iconSize: 2.5,
		labelSize: 2.15,
		labelDistance: 1.8,
		labelColor: '#ffffff',
		labelHaloColor: '#000000',
		labelHaloWidth: 1,
		iconHaloColor: '#000000',
		iconHaloWidth: 1
	}
};
