export const SCHEMA_VERSION = 1;

export const PATH_STYLES = ['arc', 'linear'] as const;
export type PathStyle = (typeof PATH_STYLES)[number];
export const DEFAULT_PATH: PathStyle = 'arc';

export function isPathStyle(value: unknown): value is PathStyle {
	return typeof value === 'string' && (PATH_STYLES as readonly string[]).includes(value);
}

export const MAP_STYLE_IDS = ['colorful', 'satellite', 'satellite-overlay'] as const;
export type MapStyleId = (typeof MAP_STYLE_IDS)[number];

/**
 * Curated subset of the VersaTiles markers sprite sheet that we expose in the
 * annotation icon picker. All entries are SDF sprites, so `icon-color` recolours
 * them to any value at runtime. See:
 *   https://tiles.versatiles.org/assets/sprites/markers/sprites.json
 *
 * Order matters: the first entry is the deltaArray default and the icon picker
 * default for new annotations.
 */
export const ANNOTATION_ICONS = [
	'symbol-marker',
	'symbol-marker_outline',
	'symbol-circle',
	'symbol-circle_outline',
	'symbol-star',
	'symbol-star_outline',
	'symbol-arrow',
	'symbol-arrow1',
	'symbol-arrow2',
	'icon-home',
	'icon-mountain',
	'icon-information'
] as const;
export type AnnotationIcon = (typeof ANNOTATION_ICONS)[number];

export function isAnnotationIcon(value: unknown): value is AnnotationIcon {
	return typeof value === 'string' && (ANNOTATION_ICONS as readonly string[]).includes(value);
}

/**
 * Per-icon icon-anchor for the maplibre symbol layer. Arrows and pin-style
 * markers point at the lng/lat from above, so they anchor at the bottom; the
 * rest are visually centred shapes.
 */
export const ANNOTATION_ICON_ANCHORS: Record<AnnotationIcon, 'center' | 'bottom'> = {
	'symbol-marker': 'bottom',
	'symbol-marker_outline': 'bottom',
	'symbol-circle': 'center',
	'symbol-circle_outline': 'center',
	'symbol-star': 'center',
	'symbol-star_outline': 'center',
	'symbol-arrow': 'bottom',
	'symbol-arrow1': 'bottom',
	'symbol-arrow2': 'bottom',
	'icon-home': 'center',
	'icon-mountain': 'center',
	'icon-information': 'center'
};

export const DEFAULT_ANNOTATION_ICON: AnnotationIcon = 'symbol-marker';
export const DEFAULT_ANNOTATION_COLOR = '#ffffff';

export const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
	colorful: 'Colorful',
	satellite: 'Satellite',
	'satellite-overlay': 'Satellite + overlay'
};

export const DEFAULT_STYLE: MapStyleId = 'colorful';
export const DEFAULT_TERRAIN = false;

export function isMapStyleId(value: unknown): value is MapStyleId {
	return typeof value === 'string' && (MAP_STYLE_IDS as readonly string[]).includes(value);
}

export interface Keyframe {
	/** seconds, absolute, monotonically increasing */
	t: number;
	lng: number;
	lat: number;
	zoom: number;
	/** 0..90 degrees */
	pitch: number;
	/** -180..180 degrees */
	bearing: number;
	/** -180..180 degrees */
	roll: number;
	/**
	 * Shape of the trajectory leaving this keyframe — i.e., the path used to
	 * interpolate from this keyframe to the *next* one. `arc` (default) uses
	 * van Wijk smooth zoom-and-pan; `linear` lerps each field directly.
	 * Ignored for the last keyframe.
	 */
	path?: PathStyle;
}

export type CameraState = Omit<Keyframe, 't' | 'path'>;

export interface Annotation {
	lng: number;
	lat: number;
	icon: AnnotationIcon;
	/** Any CSS hex colour; the canonical wire form is `#RRGGBB`. */
	color: string;
	/** Text shown next to the marker. Empty string = no label. */
	label: string;
	/** Degrees clockwise; only meaningful for arrow-style icons. */
	rotation?: number;
	/** Seconds; defaults to 0 (visible from the start of the animation). */
	visibleFrom?: number;
	/**
	 * Seconds; defaults to "always visible" (no upper bound). Stored on the
	 * wire as a large sentinel.
	 */
	visibleUntil?: number;
}

export interface Animation {
	version: number;
	style: MapStyleId;
	terrain: boolean;
	keyframes: Keyframe[];
	annotations: Annotation[];
}

export const DEFAULT_INITIAL_VIEW: CameraState = {
	lng: 10,
	lat: 50,
	zoom: 3.5,
	pitch: 0,
	bearing: 0,
	roll: 0
};

export function createEmptyAnimation(): Animation {
	return {
		version: SCHEMA_VERSION,
		style: DEFAULT_STYLE,
		terrain: DEFAULT_TERRAIN,
		keyframes: [],
		annotations: []
	};
}

export function cameraOf(kf: Keyframe): CameraState {
	return {
		lng: kf.lng,
		lat: kf.lat,
		zoom: kf.zoom,
		pitch: kf.pitch,
		bearing: kf.bearing,
		roll: kf.roll
	};
}
