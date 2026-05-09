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
 * Per-icon `icon-offset` (px) used with `icon-anchor: 'center'` on the symbol
 * layer. Each value places the icon's intended visual pivot exactly on the
 * geographic point and makes `icon-rotate` rotate around that pivot — marker
 * tips stay planted, arrow tips stay glued to the location, etc.
 *
 * Tuned visually with the throwaway page at /routes/anchors/+page.svelte.
 */
export const ANNOTATION_ICON_OFFSETS: Record<AnnotationIcon, [number, number]> = {
	'symbol-marker': [0, -11],
	'symbol-marker_outline': [0, -11],
	'symbol-circle': [0, 0],
	'symbol-circle_outline': [0, 0],
	'symbol-star': [0, -1],
	'symbol-star_outline': [0, -1],
	'symbol-arrow': [-11, 0],
	'symbol-arrow1': [-10, 0],
	'symbol-arrow2': [-9, 0],
	'icon-home': [0, 0],
	'icon-mountain': [0, 0],
	'icon-information': [0, -8]
};

export const DEFAULT_ANNOTATION_ICON: AnnotationIcon = 'symbol-marker';
export const DEFAULT_ANNOTATION_COLOR = '#ffffff';

/**
 * Animation-wide multiplier on annotation icon and label size. The map also
 * auto-scales annotations by container width (so a 4K render gets bigger
 * markers than a 480p embed); this factor stacks on top of that.
 */
export const DEFAULT_ANNOTATION_SCALE = 1;

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
	/** Multiplier for icon + label size. Defaults to 1. */
	annotationScale: number;
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
		annotations: [],
		annotationScale: DEFAULT_ANNOTATION_SCALE
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
