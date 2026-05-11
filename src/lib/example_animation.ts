import type { Animation } from './types';

/**
 * 12-second flight westward across Corsica's Monte Cinto massif — the
 * highest range in the Mediterranean. The camera enters from the east just
 * north of the Asco valley, banks WSW to face the spine of the massif, and
 * tracks across the headliner peaks (Cinto, Punta Minuta, Paglia Orba)
 * before pulling out toward the western coast. Used by the editor's
 * "★ Load example" menu item.
 *
 * Annotations mark the five most prominent summits visible from the path;
 * staggered `visibleFrom` times let them fade in as the camera approaches.
 * Shared halo / icon-style settings live in `defaultAnnotation` so each
 * marker only spells out what's unique about it.
 */
export const EXAMPLE_ANIMATION: Animation = {
	version: 1,
	style: 'satellite',
	labels: true,
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
			lng: 9.082452682358053,
			lat: 42.471667980467544,
			zoom: 13.037343523200418,
			pitch: 76.86376111628292,
			bearing: -107.19999999999982,
			roll: 0,
			path: 'linear'
		},
		{
			t: 6,
			lng: 8.927959249318633,
			lat: 42.42334184667922,
			zoom: 13.037343523200418,
			pitch: 76.86376111628292,
			bearing: -107.19999999999982,
			roll: 0,
			path: 'linear'
		},
		{
			t: 9,
			lng: 8.889387884480328,
			lat: 42.39070248767513,
			zoom: 13.037343523200418,
			pitch: 55.85460418718874,
			bearing: -120.88520077304912,
			roll: 0,
			path: 'linear'
		},
		{
			t: 12,
			lng: 8.786494184837238,
			lat: 42.37066289843767,
			zoom: 13.73266865294977,
			pitch: 55.85460418718874,
			bearing: -111.28520077304904,
			roll: 0
		}
	],
	annotations: [
		// Monte Cinto — the headliner: highest peak in Corsica and the
		// Mediterranean. Larger icon and bolder colour so it stands out from
		// the supporting peaks.
		{
			lng: 8.9459,
			lat: 42.3795,
			icon: 'symbol-arrow1',
			label: 'Monte Cinto\n2706 m',
			labelPosition: 'top',
			visibleFrom: 3,
			labelDistance: 2.5,
			fadeIn: 1,
			iconColor: '#660000',
			iconSize: 2.5,
			labelColor: '#660000',
			labelSize: 1.6
		},
		// Monte Padro — the northern sentinel of the massif, visible first as
		// the camera enters from the east.
		{
			lng: 8.9895,
			lat: 42.4667,
			icon: 'symbol-arrow1',
			label: 'Monte Padro\n2389 m',
			labelPosition: 'top-right',
			visibleFrom: 0.5,
			labelDistance: 2.2,
			fadeIn: 1,
			iconColor: '#7a3030',
			iconSize: 1.8,
			labelColor: '#7a3030',
			labelSize: 1.2
		},
		// Punta Minuta — second-highest in the Asco section of the massif,
		// just NW of Cinto on the same ridge.
		{
			lng: 8.911,
			lat: 42.379,
			icon: 'symbol-arrow1',
			label: 'Punta Minuta\n2556 m',
			labelPosition: 'bottom-left',
			visibleFrom: 2,
			labelDistance: 2.2,
			fadeIn: 1,
			iconColor: '#7a3030',
			iconSize: 1.8,
			labelColor: '#7a3030',
			labelSize: 1.2
		},
		// Paglia Orba — the iconic horn-shaped peak between the Golo and
		// Cavicchia valleys, south of Cinto on the GR 20.
		{
			lng: 8.8787,
			lat: 42.3431,
			icon: 'symbol-arrow1',
			label: 'Paglia Orba\n2525 m',
			labelPosition: 'right',
			visibleFrom: 5,
			labelDistance: 2.2,
			fadeIn: 1,
			iconColor: '#7a3030',
			iconSize: 1.8,
			labelColor: '#7a3030',
			labelSize: 1.2
		},
		// Capo Tafonato — famous for its natural rock window (tafonu), just
		// west of Paglia Orba on the same ridge.
		{
			lng: 8.867,
			lat: 42.333,
			icon: 'symbol-arrow1',
			label: 'Capo Tafonato\n2335 m',
			labelPosition: 'bottom-right',
			visibleFrom: 7,
			labelDistance: 2.2,
			fadeIn: 1,
			iconColor: '#7a3030',
			iconSize: 1.7,
			labelColor: '#7a3030',
			labelSize: 1.15
		}
	],
	annotationScale: 1,
	aspectRatio: '16:9',
	defaultAnnotation: {
		// Shared style for every marker: a white halo around both icon and
		// label so they stay legible against the satellite imagery.
		iconHaloColor: '#ffffff',
		iconHaloWidth: 1,
		labelHaloColor: '#ffffff',
		labelHaloWidth: 1
	}
};
