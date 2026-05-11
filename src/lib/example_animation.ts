import type { Animation } from './types';

/**
 * 10-second flight around Germany's Zugspitze (2962 m) and the surrounding
 * Wetterstein massif. Camera starts as a wide aerial north of
 * Garmisch-Partenkirchen, descends toward the Eibsee at the foot of the
 * Zugspitze, then pulls into a high-pitch panorama that reveals the whole
 * massif from west to east. Used by the editor's "★ Load example" menu item.
 */
export const EXAMPLE_ANIMATION: Animation = {
	version: 1,
	style: 'satellite',
	labels: false,
	terrain: true,
	sky: true,
	keyframes: [
		{ t: 0, lng: 11.05, lat: 47.62, zoom: 10, pitch: 30, bearing: 200, roll: 0 },
		{ t: 3, lng: 10.99, lat: 47.52, zoom: 11.5, pitch: 55, bearing: 200, roll: 0 },
		{
			t: 6.5,
			lng: 10.96,
			lat: 47.5,
			zoom: 11.8,
			pitch: 72,
			bearing: 220,
			roll: 0,
			path: 'linear'
		},
		{ t: 10, lng: 11.05, lat: 47.52, zoom: 11.3, pitch: 78, bearing: 245, roll: 0 }
	],
	annotations: [
		// Zugspitze — the headliner: Germany's highest peak. Larger icon and
		// bolder colour to stand out from the supporting peaks.
		{
			lng: 10.985278,
			lat: 47.421111,
			icon: 'symbol-arrow1',
			label: 'Zugspitze\n2962 m',
			labelPosition: 'top',
			visibleFrom: 0,
			labelDistance: 2.5,
			fadeIn: 1,
			iconColor: '#660000',
			iconHaloColor: '#ffffff',
			iconHaloWidth: 1,
			iconSize: 2.5,
			labelColor: '#660000',
			labelHaloColor: '#ffffff',
			labelHaloWidth: 1,
			labelSize: 1.75
		},
		// Supporting peaks of the Wetterstein massif, fanned out so the labels
		// don't collide at the panoramic shot. Coordinates from each peak's
		// Wikipedia summit page.
		{
			lng: 10.971944,
			lat: 47.412917,
			icon: 'symbol-arrow1',
			iconColor: '#7a3030',
			label: 'Schneefernerkopf\n2875 m',
			labelPosition: 'bottom-left',
			visibleFrom: 2,
			iconSize: 1.8,
			labelSize: 1.3,
			labelDistance: 2.2,
			fadeIn: 1,
			labelColor: '#7a3030',
			labelHaloWidth: 1
		},
		{
			lng: 11.0375,
			lat: 47.4525,
			icon: 'symbol-arrow1',
			iconColor: '#7a3030',
			label: 'Alpspitze\n2628 m',
			labelPosition: 'top-right',
			visibleFrom: 2,
			iconSize: 1.8,
			labelSize: 1.3,
			labelDistance: 2.2,
			fadeIn: 1,
			labelColor: '#7a3030',
			labelHaloWidth: 1
		},
		{
			lng: 11.082222,
			lat: 47.413056,
			icon: 'symbol-arrow1',
			iconColor: '#7a3030',
			label: 'Hochwanner\n2744 m',
			labelPosition: 'bottom-right',
			visibleFrom: 2,
			iconSize: 1.8,
			labelSize: 1.3,
			labelDistance: 2.2,
			fadeIn: 1,
			labelColor: '#7a3030',
			labelHaloWidth: 1
		},
		{
			lng: 11.013333,
			lat: 47.430278,
			icon: 'symbol-arrow1',
			iconColor: '#7a3030',
			label: 'Höllentalspitze\n2743 m',
			labelPosition: 'right',
			visibleFrom: 2,
			iconSize: 1.8,
			labelSize: 1.3,
			labelDistance: 2.2,
			fadeIn: 1,
			labelColor: '#7a3030',
			labelHaloWidth: 1
		},
		// Eibsee — the turquoise alpine lake at the foot of the Zugspitze.
		// Different icon (marker pin) so it reads as a point of interest rather
		// than another peak.
		{
			lng: 10.9783,
			lat: 47.4581,
			icon: 'symbol-marker',
			iconColor: '#1a6fa8',
			label: 'Eibsee\n973 m',
			labelPosition: 'top-left',
			visibleFrom: 2,
			iconSize: 1.6,
			labelSize: 1.2,
			labelDistance: 1.8,
			fadeIn: 1,
			labelColor: '#1a6fa8',
			labelHaloWidth: 1
		}
	],
	annotationScale: 1,
	aspectRatio: '16:9',
	defaultAnnotation: {}
};
