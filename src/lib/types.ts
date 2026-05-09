export const SCHEMA_VERSION = 1;

export const PATH_STYLES = ['arc', 'linear'] as const;
export type PathStyle = (typeof PATH_STYLES)[number];
export const DEFAULT_PATH: PathStyle = 'arc';

export function isPathStyle(value: unknown): value is PathStyle {
	return typeof value === 'string' && (PATH_STYLES as readonly string[]).includes(value);
}

export const MAP_STYLE_IDS = ['colorful', 'satellite'] as const;
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
// Red reads as a marker on every basemap we ship (light colourful, dark
// satellite, satellite + overlay) — white was nearly invisible on the
// colourful style, which made freshly-pinned markers easy to lose.
export const DEFAULT_ANNOTATION_COLOR = '#cc0000';
// Near-black text reads on the colourful basemap; the auto-flipped halo
// (white here, black when the label is light) keeps it legible on satellite.
export const DEFAULT_ANNOTATION_LABEL_COLOR = '#111111';

/**
 * Animation-wide multiplier on annotation icon and label size. The map also
 * auto-scales annotations by container width (so a 4K render gets bigger
 * markers than a 480p embed); this factor stacks on top of that.
 */
export const DEFAULT_ANNOTATION_SCALE = 1;

export const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
	colorful: 'Colorful',
	satellite: 'Satellite'
};

export const DEFAULT_STYLE: MapStyleId = 'colorful';
export const DEFAULT_LABELS = true;
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
	/** Icon colour. Any CSS hex; canonical wire form is `#RRGGBB`. */
	color: string;
	/**
	 * Label text colour. Default `DEFAULT_ANNOTATION_LABEL_COLOR` (near-black);
	 * the halo auto-flips to the contrasting brightness so the label stays
	 * legible on any basemap.
	 */
	labelColor?: string;
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
	/**
	 * Per-annotation icon size multiplier (default 1). Stacks on top of the
	 * animation-level annotationScale and the container-width auto-scale.
	 */
	iconSize?: number;
	/** Per-annotation label size multiplier (default 1). Stacks like iconSize. */
	labelSize?: number;
	/**
	 * Where the label sits relative to the icon (default `bottom`). See
	 * `LABEL_POSITIONS`.
	 */
	labelPosition?: LabelPosition;
	/**
	 * Gap (in `em`) between the geo point and the label, in the direction
	 * `labelPosition` points. Default `DEFAULT_LABEL_DISTANCE` (1.5).
	 */
	labelDistance?: number;
	/**
	 * Fade-in duration in seconds. Begins `fadeIn` seconds *before*
	 * `visibleFrom` and reaches full opacity at `visibleFrom`. Default 0
	 * (hard cut-in). Ignored if `visibleFrom` is undefined.
	 */
	fadeIn?: number;
	/**
	 * Fade-out duration in seconds. Begins at `visibleUntil` and reaches
	 * opacity 0 at `visibleUntil + fadeOut`. Default 0 (hard cut-out).
	 * Ignored if `visibleUntil` is undefined.
	 */
	fadeOut?: number;
}

export const DEFAULT_ANNOTATION_ICON_SIZE = 1;
export const DEFAULT_ANNOTATION_LABEL_SIZE = 1;

/**
 * Where the label sits relative to the icon. The name describes where the
 * *label* appears, not which corner of the text touches the geo point — so
 * `top` means "label above the icon", `bottom-left` means "label down-left
 * of the icon". The `MapStage` translates each value to MapLibre's
 * `text-anchor` + `text-offset` pair internally.
 */
export const LABEL_POSITIONS = [
	'center',
	'top',
	'bottom',
	'left',
	'right',
	'top-left',
	'top-right',
	'bottom-left',
	'bottom-right'
] as const;
export type LabelPosition = (typeof LABEL_POSITIONS)[number];
export const DEFAULT_LABEL_POSITION: LabelPosition = 'bottom';

/**
 * Default gap (in `em` of `text-size`) between the geo point and the nearest
 * edge of the label. With `text-size = 13 px` that's ≈20 px — enough to clear
 * a default-size icon without floating away from it.
 */
export const DEFAULT_LABEL_DISTANCE = 1.5;

export function isLabelPosition(value: unknown): value is LabelPosition {
	return typeof value === 'string' && (LABEL_POSITIONS as readonly string[]).includes(value);
}

export interface Animation {
	version: number;
	style: MapStyleId;
	/**
	 * For `colorful`: show / hide place names, road names, POIs, etc.
	 * For `satellite`: show the colorful overlay (roads + labels) on top of
	 * the imagery, or just the raw imagery on its own.
	 */
	labels: boolean;
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
		labels: DEFAULT_LABELS,
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
