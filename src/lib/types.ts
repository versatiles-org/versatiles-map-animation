import { DEFAULT_ANNOTATION_LABEL_FONT, type AnnotationLabelFont } from './fonts';

export const SCHEMA_VERSION = 1;

/**
 * Map composition aspect ratios. Both the editor preview and the viewer iframe
 * letterbox the map to the chosen aspect so what you compose is what gets
 * rendered, regardless of window/iframe size. The editor exposes a picker;
 * the chosen ratio rides on the `aspectRatio` field on `Animation`.
 *
 * Curated set covers landscape video (`16:9`, `21:9`, `4:3`), photo (`3:2`),
 * square (`1:1`), and the two vertical formats people actually compose for
 * (`4:5`, `9:16`). Order matters: index 0 is the wire-format default.
 */
export const ASPECT_RATIOS = ['16:9', '21:9', '4:3', '3:2', '1:1', '4:5', '9:16'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9';

export function isAspectRatio(value: unknown): value is AspectRatio {
	return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value);
}

/** Numeric width/height ratio for use in CSS `aspect-ratio` and arithmetic. */
export function aspectRatioValue(ar: AspectRatio): number {
	const [w, h] = ar.split(':').map(Number);
	return w / h;
}

/** Human label used in the aspect picker UI. */
export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
	'16:9': '16:9 — landscape',
	'21:9': '21:9 — cinematic',
	'4:3': '4:3 — TV',
	'3:2': '3:2 — photo',
	'1:1': '1:1 — square',
	'4:5': '4:5 — portrait',
	'9:16': '9:16 — vertical'
};

/**
 * `MAP_REFERENCE_WIDTH` is the canonical pixel width that camera zoom values
 * are stored against — when the map is rendered at a different display width,
 * MapStage adjusts zoom by `log2(actualWidth / MAP_REFERENCE_WIDTH)` so the
 * same geographic content fills the frame at any size. Independent of the
 * chosen aspect ratio: still measured along the width.
 */
export const MAP_REFERENCE_WIDTH = 1280;

/**
 * How the camera travels on a move from one stop straight to the next:
 * `arc` rises and descends on long distances (van Wijk's smooth
 * zoom-and-pan), `linear` keeps to the altitude of its two ends. A move that
 * runs through waypoints follows the curve through them instead.
 */
export const PATH_STYLES = ['arc', 'linear'] as const;
export type PathStyle = (typeof PATH_STYLES)[number];
export const DEFAULT_PATH: PathStyle = 'arc';
/** Name and one-line explanation of each travel style, for pickers and tooltips. */
export const PATH_STYLE_LABELS: Record<PathStyle, readonly [string, string]> = {
	arc: ['Fly over', 'Rises and descends on long moves, like a flight. The default.'],
	linear: [
		'Stay low',
		'Travels straight between the two views without rising, at an even speed on screen. Best for short moves.'
	]
};

/**
 * For a short while `'spline'` was a third path style: consecutive spline
 * segments flew through the keyframes between them. Waypoints say the same
 * thing on the keyframe itself. Links and files from that time are
 * converted on load: a keyframe between two spline segments becomes a
 * waypoint, and what is left of `'spline'` becomes `'linear'`, the style it
 * resembled on its own.
 */
export const LEGACY_SPLINE_PATH = 'spline';
export function convertLegacySplinePaths(
	keyframes: (Omit<Keyframe, 'path'> & { path?: PathStyle | typeof LEGACY_SPLINE_PATH })[]
): Keyframe[] {
	const isSpline = (i: number) => keyframes[i]?.path === LEGACY_SPLINE_PATH;
	return keyframes.map((kf, i) => {
		const { path, ...rest } = kf;
		const out: Keyframe = { ...rest };
		if (path === LEGACY_SPLINE_PATH) out.path = 'linear';
		else if (path !== undefined) out.path = path;
		if (isSpline(i - 1) && isSpline(i) && i < keyframes.length - 1) out.waypoint = true;
		return out;
	});
}

export function isPathStyle(value: unknown): value is PathStyle {
	return typeof value === 'string' && (PATH_STYLES as readonly string[]).includes(value);
}

/**
 * Base map kinds. `colorful` is the OSM vector map — the id predates the
 * theme picker and is persisted (JSON export, URL state), so it stays even
 * though the map's colours now come from `Animation.theme`.
 */
export const MAP_STYLE_IDS = ['colorful', 'satellite'] as const;
export type MapStyleId = (typeof MAP_STYLE_IDS)[number];

/**
 * Colour themes of the OSM map (the palettes of `@versatiles/style`). On
 * `satellite` the theme colours the OSM overlay drawn on top of the imagery.
 *
 * Pinned in code because the URL codec stores a theme as its index in this
 * list: only ever append, never reorder or remove. A unit test compares the
 * list with what the installed `@versatiles/style` offers.
 */
export const MAP_THEMES = [
	'colorful',
	'colorful-dark',
	'natural',
	'natural-dark',
	'muted',
	'muted-dark',
	'gray',
	'gray-dark',
	'toner',
	'toner-dark',
	'positrino',
	'positrino-dark',
	'fnord',
	'protocol',
	'protocol-dark',
	'protostar',
	'protostar-dark',
	'protozoa',
	'classic',
	'googol',
	'freedom',
	'macbob',
	'mactaylor',
	'bingo'
] as const;
export type MapTheme = (typeof MAP_THEMES)[number];

export function isMapTheme(value: unknown): value is MapTheme {
	return typeof value === 'string' && (MAP_THEMES as readonly string[]).includes(value);
}

/**
 * The theme a map style is drawn in when `Animation.theme` is unset. These
 * are the looks both styles had before themes were selectable.
 */
export const DEFAULT_MAP_THEMES: Record<MapStyleId, MapTheme> = {
	colorful: 'colorful',
	satellite: 'gray'
};

/**
 * The first ten themes are VersaTiles' own; the rest resemble other
 * projects' maps. The theme picker groups them accordingly.
 */
export const MAP_THEME_LOOKALIKES_START = 10;

/** Human label for the theme picker: `colorful-dark` → `Colorful dark`. */
export function mapThemeLabel(theme: MapTheme): string {
	const words = theme.replace(/-/g, ' ');
	return words[0].toUpperCase() + words.slice(1);
}

/**
 * Curated set of VersaTiles sprites that we expose in the annotation icon
 * picker. All entries are SDF sprites, so `icon-color` recolours them to any
 * value at runtime.
 *
 * These ids are persisted (JSON export, URL state), so they keep the names of
 * the v5 `markers` sheet they were first taken from. `ANNOTATION_ICON_SPRITES`
 * maps each one to the sprite that draws it today.
 *
 * Order matters: the first entry is the codec carry-forward default and the
 * icon picker default for new annotations.
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

/**
 * Namespaced sprite id (`<sheet>:<name>`) for each annotation icon. See:
 *   https://tiles.versatiles.org/assets/sprites/extras.json
 *   https://tiles.versatiles.org/assets/sprites/icons.json
 */
export const ANNOTATION_ICON_SPRITES: Record<AnnotationIcon, string> = {
	'symbol-marker': 'extras:pin-teardrop',
	'symbol-marker_outline': 'extras:pin-teardrop_outline',
	'symbol-circle': 'extras:shape-circle',
	'symbol-circle_outline': 'extras:shape-circle_outline',
	'symbol-star': 'extras:shape-star',
	'symbol-star_outline': 'extras:shape-star_outline',
	'symbol-arrow': 'extras:symbol-arrow',
	'symbol-arrow1': 'extras:symbol-arrow2',
	'symbol-arrow2': 'extras:symbol-arrow3',
	'icon-home': 'icons:house',
	'icon-mountain': 'icons:mountain',
	'icon-information': 'base:transport-information'
};

export function isAnnotationIcon(value: unknown): value is AnnotationIcon {
	return typeof value === 'string' && (ANNOTATION_ICONS as readonly string[]).includes(value);
}

/**
 * Per-icon rotation offset (degrees, clockwise) applied on top of the user's
 * `rotation`. Arrows ship as right-pointing sprites; +90° puts the user's
 * `rotation = 0` at "arrow points down" (south) — the natural default when
 * a label sits below the marker pointing toward something at the geo point.
 * Other icons use 0 since they're rotation-symmetric or don't have a natural
 * orientation. The same offset is applied to icon previews in the dropdown.
 */
export const ANNOTATION_ICON_ROTATION_OFFSETS: Record<AnnotationIcon, number> = {
	'symbol-marker': 0,
	'symbol-marker_outline': 0,
	'symbol-circle': 0,
	'symbol-circle_outline': 0,
	'symbol-star': 0,
	'symbol-star_outline': 0,
	'symbol-arrow': 90,
	'symbol-arrow1': 90,
	'symbol-arrow2': 90,
	'icon-home': 0,
	'icon-mountain': 0,
	'icon-information': 0
};

/**
 * Per-icon `icon-offset` (px) used with `icon-anchor: 'center'` on the symbol
 * layer. Each value places the icon's intended visual pivot exactly on the
 * geographic point and makes `icon-rotate` rotate around that pivot — marker
 * tips stay planted, arrow tips stay glued to the location, etc.
 */
export const ANNOTATION_ICON_OFFSETS: Record<AnnotationIcon, [number, number]> = {
	'symbol-marker': [0, -14],
	'symbol-marker_outline': [0, -14],
	'symbol-circle': [0, 0],
	'symbol-circle_outline': [0, 0],
	'symbol-star': [0, -1],
	'symbol-star_outline': [0, -1],
	'symbol-arrow': [-10, 0],
	'symbol-arrow1': [-9, 0],
	'symbol-arrow2': [-9, 0],
	'icon-home': [0, 0],
	'icon-mountain': [0, 0],
	'icon-information': [0, 0]
};

export const DEFAULT_ANNOTATION_ICON: AnnotationIcon = 'symbol-marker';
// Red reads as a marker on every basemap we ship (light colourful, dark
// satellite, satellite + overlay) — white was nearly invisible on the
// colourful style, which made freshly-pinned markers easy to lose.
export const DEFAULT_ANNOTATION_COLOR = '#cc0000';
// Near-black text reads on the colourful basemap; the auto-flipped halo
// (white here, black when the label is light) keeps it legible on satellite.
export const DEFAULT_ANNOTATION_LABEL_COLOR = '#111111';
// Halo geometry. The defaults reproduce what the editor used to render
// before halo was per-annotation: a 1.5-px halo with the auto-flipped colour
// for labels, and no halo at all for icons. Both can be overridden.
export const DEFAULT_LABEL_HALO_WIDTH = 1.5;
export const DEFAULT_ICON_HALO_WIDTH = 0;
export const DEFAULT_ICON_HALO_COLOR = '#ffffff';

/**
 * Animation-wide multiplier on annotation icon and label size. The map also
 * auto-scales annotations by container width (so a 4K render gets bigger
 * markers than a 480p embed); this factor stacks on top of that.
 */
export const DEFAULT_ANNOTATION_SCALE = 1;

/**
 * Layer groups of the OSM map that can be switched off one by one (the
 * top-level groups of `@versatiles/style`'s `layers` option).
 *
 * Pinned in code because the URL codec stores the hidden groups as a
 * bitmask with one bit per position in this list: only ever append, never
 * reorder or remove. A unit test compares the list with what the installed
 * `@versatiles/style` offers.
 */
export const MAP_LAYER_GROUPS = [
	'land',
	'water',
	'roads',
	'transit',
	'buildings',
	'sites',
	'airport',
	'boundaries',
	'labels',
	'pois',
	'markings'
] as const;
export type MapLayerGroup = (typeof MAP_LAYER_GROUPS)[number];

export function isMapLayerGroup(value: unknown): value is MapLayerGroup {
	return typeof value === 'string' && (MAP_LAYER_GROUPS as readonly string[]).includes(value);
}

/** Label and tooltip of each group in the editor's layer list. */
export const MAP_LAYER_GROUP_LABELS: Record<MapLayerGroup, [label: string, title: string]> = {
	land: ['Land cover', 'Forests, grass, farmland, residential and industrial areas, glaciers'],
	water: ['Water', 'Ocean, lakes, rivers, piers'],
	roads: ['Roads', 'Motorways, streets, tracks, paths and steps'],
	transit: ['Transit', 'Railways, cable cars, ferries, stations and stops'],
	buildings: ['Buildings', 'Building footprints'],
	sites: ['Sites', 'Schools, hospitals, parking, sports and construction sites'],
	airport: ['Airports', 'Runways and taxiways'],
	boundaries: ['Boundaries', 'Country and state borders'],
	labels: ['Names', 'Names of places, streets, waters, countries, and house numbers'],
	pois: ['POIs', 'Symbols for points of interest'],
	markings: ['Markings', 'One-way arrows on roads']
};

/**
 * The groups the OSM overlay on `satellite` draws. The others (land cover,
 * water, …) are filled areas that would hide the imagery, so the overlay
 * has none of them and switching them does nothing there.
 */
export const SATELLITE_OVERLAY_LAYER_GROUPS: readonly MapLayerGroup[] = [
	'roads',
	'transit',
	'boundaries',
	'labels',
	'pois',
	'markings'
];

/**
 * The groups the `labels` master switch of the OSM map hides on its own
 * (it also hides the stop symbols of `transit`).
 */
export const LABEL_SWITCH_LAYER_GROUPS: readonly MapLayerGroup[] = ['labels', 'pois', 'markings'];

/** Filter to known groups, drop duplicates, and sort into `MAP_LAYER_GROUPS` order. */
export function normalizeLayerGroups(groups: readonly unknown[]): MapLayerGroup[] {
	return MAP_LAYER_GROUPS.filter((g) => groups.includes(g));
}

/**
 * Where the light comes from. It shades the walls of 3D buildings and the
 * hillshade of the terrain; a flat map without either looks the same under
 * any sun.
 */
export interface Sun {
	/** Compass direction the light comes from, in degrees clockwise from north (0–359). */
	direction: number;
	/** Height above the horizon in degrees (0 = on the horizon, 90 = overhead). */
	altitude: number;
}

/** What the "Sun" switch starts with: a mid-afternoon sun in the south-west. */
export const DEFAULT_SUN: Sun = { direction: 210, altitude: 60 };

/**
 * Whole degrees, direction wrapped into 0–359 and altitude clamped to 0–90 —
 * the resolution the URL codec stores. `undefined` for anything that is not
 * a pair of finite numbers.
 */
export function normalizeSun(value: unknown): Sun | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const { direction, altitude } = value as Record<string, unknown>;
	if (typeof direction !== 'number' || !Number.isFinite(direction)) return undefined;
	if (typeof altitude !== 'number' || !Number.isFinite(altitude)) return undefined;
	return {
		direction: ((Math.round(direction) % 360) + 360) % 360,
		altitude: Math.min(90, Math.max(0, Math.round(altitude)))
	};
}

/**
 * How the earth is drawn. Pinned and append-only: the URL codec stores the
 * index. `globe` is MapLibre's globe, which turns into Mercator as you zoom
 * in (fully from zoom 12), so close-up shots look the same in both.
 */
export const MAP_PROJECTIONS = ['mercator', 'globe'] as const;
export type MapProjection = (typeof MAP_PROJECTIONS)[number];
export const DEFAULT_MAP_PROJECTION: MapProjection = 'mercator';
export const MAP_PROJECTION_LABELS: Record<MapProjection, string> = {
	mercator: 'Mercator',
	globe: 'Globe'
};

export function isMapProjection(value: unknown): value is MapProjection {
	return typeof value === 'string' && (MAP_PROJECTIONS as readonly string[]).includes(value);
}

/**
 * Web Mercator ends here. The camera centre stays inside ±this latitude on
 * the globe too: it is what the URL codec can store, and MapLibre sizes the
 * globe by the Mercator scale at the centre, which has no meaning past it.
 */
export const MAX_CAMERA_LATITUDE = 85.051129;

/**
 * The point of the frame the camera is built around, as fractions of its
 * width and height from the top-left corner. A keyframe's position sits
 * there, and zoom, rotation and tilt pivot around it. The default is the
 * middle of the frame.
 */
export interface ScreenAnchor {
	x: number;
	y: number;
}

export const DEFAULT_SCREEN_ANCHOR: ScreenAnchor = { x: 0.5, y: 0.5 };

export function isDefaultScreenAnchor(anchor: ScreenAnchor): boolean {
	return anchor.x === DEFAULT_SCREEN_ANCHOR.x && anchor.y === DEFAULT_SCREEN_ANCHOR.y;
}

/**
 * Whole percent inside the frame — the resolution the URL codec stores.
 * `undefined` for anything that is not a pair of finite numbers.
 */
export function normalizeScreenAnchor(value: unknown): ScreenAnchor | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const { x, y } = value as Record<string, unknown>;
	if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
	if (typeof y !== 'number' || !Number.isFinite(y)) return undefined;
	const percent = (v: number) => Math.min(100, Math.max(0, Math.round(v * 100))) / 100;
	return { x: percent(x), y: percent(y) };
}

/**
 * The anchor as MapLibre padding for a map of the given size: padding moves
 * the map's centre point to the middle of what it leaves free, so pad one
 * side per axis until that middle is the anchor.
 */
export function screenAnchorPadding(
	anchor: ScreenAnchor,
	width: number,
	height: number
): { top: number; right: number; bottom: number; left: number } {
	const dx = (2 * anchor.x - 1) * width;
	const dy = (2 * anchor.y - 1) * height;
	return {
		left: Math.max(0, dx),
		right: Math.max(0, -dx),
		top: Math.max(0, dy),
		bottom: Math.max(0, -dy)
	};
}

export const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
	colorful: 'OSM',
	satellite: 'Satellite'
};

export const DEFAULT_STYLE: MapStyleId = 'colorful';
export const DEFAULT_LABELS = true;
export const DEFAULT_TERRAIN = false;
export const DEFAULT_SKY = false;

/**
 * Animation-level defaults — the fields that aren't per-keyframe or
 * per-annotation. Used by `createEmptyAnimation`, the JSON validator, and
 * the URL-state decoder so a single edit here covers every fallback site.
 * The named `DEFAULT_*` constants above stay as the source-of-truth values;
 * this object just bundles them for callers that want to spread or look up
 * by key.
 */
export const ANIMATION_DEFAULTS: {
	style: MapStyleId;
	labels: boolean;
	terrain: boolean;
	sky: boolean;
	annotationScale: number;
	aspectRatio: AspectRatio;
} = {
	style: DEFAULT_STYLE,
	labels: DEFAULT_LABELS,
	terrain: DEFAULT_TERRAIN,
	sky: DEFAULT_SKY,
	annotationScale: DEFAULT_ANNOTATION_SCALE,
	aspectRatio: DEFAULT_ASPECT_RATIO
};

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
	 * Travel style of the move that starts at this keyframe — see
	 * `PATH_STYLES`. Only used on a stop whose move goes straight to the next
	 * stop; ignored on waypoints, on moves through waypoints and on the last
	 * keyframe.
	 */
	path?: PathStyle;
	/**
	 * A stop (the default) is a view the camera comes to rest on. A waypoint
	 * is one it flies through: it shapes the route and never causes a pause.
	 * The keyframes from one stop to the next form one move. A waypoint as
	 * first or last keyframe makes the animation start or end in motion.
	 */
	waypoint?: boolean;
	/**
	 * Seconds the camera rests on this stop: it arrives at `t` and leaves at
	 * `t + hold`. Unset means it leaves at once. Waypoints have no hold.
	 */
	hold?: number;
	/**
	 * How gently the camera arrives at this stop (`easeIn`) and leaves it
	 * (`easeOut`): from 0, abruptly and at full speed, to 1, very gradually.
	 * Unset means the default of the move in question — see `DEFAULT_EASE`.
	 * Waypoints have neither.
	 */
	easeIn?: number;
	easeOut?: number;
}

/** The two sides of a stop that ease: arriving at it and leaving it. */
export type EaseSide = 'easeIn' | 'easeOut';

/**
 * The easing of a stop that sets none. A move straight from stop to stop
 * eases more than the curve of a move through waypoints, which only has to
 * come to rest at its two ends — and comes to rest by itself, the way a
 * strength of a third does.
 */
export const DEFAULT_EASE = { direct: 0.65, curve: 1 / 3 } as const;

/** The smallest step of an easing strength. */
export const EASE_RESOLUTION = 0.01;

/** An easing strength within 0…1, on the grid of `EASE_RESOLUTION`. */
export function snapEase(ease: number): number {
	const steps = Math.round(1 / EASE_RESOLUTION);
	return Math.round(Math.max(0, Math.min(1, ease)) * steps) / steps;
}

/**
 * The smallest step of time in an animation, in seconds. Keyframe times and
 * holds, and the show/hide times of markers, all lie on this grid, so the
 * timeline reads as clean decimals ("3.27 s") and two keyframes are never
 * closer than one step.
 */
export const TIME_RESOLUTION = 0.01;

/** Round a time in seconds to the grid of `TIME_RESOLUTION`. */
export function snapTime(t: number): number {
	// Dividing by the number of steps per second gives clean decimals, where
	// multiplying by the step leaves floating-point dust (57 × 0.01 ≠ 0.57).
	const stepsPerSecond = Math.round(1 / TIME_RESOLUTION);
	return Math.round(t * stepsPerSecond) / stepsPerSecond;
}

/**
 * Keyframes as an animation holds them: sorted by time, every time and hold
 * on the grid of `TIME_RESOLUTION`, and each keyframe at least one step
 * after the one before it has left. Anything loaded from a file or a link
 * goes through this, so times written by hand or by an older version end up
 * on the grid too.
 */
export function snapKeyframeTimes(keyframes: readonly Keyframe[]): Keyframe[] {
	let earliest = 0;
	return [...keyframes]
		.sort((a, b) => a.t - b.t)
		.map((kf) => {
			const out: Keyframe = { ...kf, t: Math.max(earliest, snapTime(Math.max(0, kf.t))) };
			const hold = snapTime(holdOf(kf));
			if (hold > 0) out.hold = hold;
			else delete out.hold;
			earliest = snapTime(out.t + hold + TIME_RESOLUTION);
			return out;
		});
}

/** How long the camera rests on a keyframe, in seconds — 0 for a waypoint. */
export function holdOf(kf: Keyframe): number {
	return kf.waypoint ? 0 : Math.max(0, kf.hold ?? 0);
}

/** When the camera leaves a keyframe: its time plus its hold. */
export function departureOf(kf: Keyframe): number {
	return kf.t + holdOf(kf);
}

export type CameraState = Omit<Keyframe, 't' | 'path' | EaseSide>;

export interface Annotation {
	lng: number;
	lat: number;
	/**
	 * Sprite id. Optional: when omitted, the renderer resolves it via the
	 * per-animation `defaultAnnotation`, falling back to the hardcoded
	 * `DEFAULT_ANNOTATION_ICON`. Every style field is optional for the same
	 * reason — see `resolveAnnotation` in `animation.svelte.ts`.
	 */
	icon?: AnnotationIcon;
	/**
	 * Icon colour. Any CSS hex; canonical wire form is `#RRGGBB`. Optional —
	 * resolved like `icon`.
	 */
	iconColor?: string;
	/**
	 * Label text colour. Default `DEFAULT_ANNOTATION_LABEL_COLOR` (near-black);
	 * the halo auto-flips to the contrasting brightness so the label stays
	 * legible on any basemap.
	 */
	labelColor?: string;
	/**
	 * Label halo (text outline). When undefined, MapStage auto-picks a colour
	 * with the contrasting brightness of `labelColor`. Width default 1.5 px.
	 */
	labelHaloColor?: string;
	labelHaloWidth?: number;
	/**
	 * Icon halo (icon outline). Both default to "off" (width 0). Set the width
	 * to give the icon a contrasting outline; default colour is white.
	 */
	iconHaloColor?: string;
	iconHaloWidth?: number;
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
	/**
	 * Glyph font for the label, drawn from the VersaTiles tileserver's bundled
	 * fonts. Default `noto_sans_bold`. See `ANNOTATION_LABEL_FONTS`.
	 */
	labelFont?: AnnotationLabelFont;
}

export const DEFAULT_ANNOTATION_ICON_SIZE = 1;
export const DEFAULT_ANNOTATION_LABEL_SIZE = 1;

/**
 * Style-only subset of `Annotation`: how a marker looks, without where it
 * sits (lng/lat), what it says (label), how it's rotated, or when it's
 * visible (visibleFrom/visibleUntil/fadeIn/fadeOut). This is what
 * `Animation.defaultAnnotation` carries — a per-animation template applied
 * to brand-new markers — and what the JSON validator returns for that block.
 *
 * Keep in sync with `ANNOTATION_FIELD_DEFAULTS` (every key in this Pick
 * should also have a baseline value there) and with the `FIELD_SPECS` table
 * in `url_state/annotation_codec.ts` for any field that round-trips through
 * the wire codec.
 */
/**
 * Runtime list of every `AnnotationStyle` key. Used by the JSON validator
 * (and anywhere else that needs to enumerate style fields) to keep the
 * `defaultAnnotation` block free of non-style data — visibility windows,
 * fade timings, rotation, label text, position — which should never appear
 * in a per-animation template. Keep in sync with the `Pick` below.
 */
export const ANNOTATION_STYLE_KEYS = [
	'icon',
	'iconColor',
	'iconSize',
	'iconHaloColor',
	'iconHaloWidth',
	'labelColor',
	'labelSize',
	'labelPosition',
	'labelDistance',
	'labelFont',
	'labelHaloColor',
	'labelHaloWidth'
] as const;

export type AnnotationStyle = Pick<
	Annotation,
	| 'icon'
	| 'iconColor'
	| 'iconSize'
	| 'iconHaloColor'
	| 'iconHaloWidth'
	| 'labelColor'
	| 'labelSize'
	| 'labelPosition'
	| 'labelDistance'
	| 'labelFont'
	| 'labelHaloColor'
	| 'labelHaloWidth'
>;

export * from './fonts';

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

/**
 * Single source of truth for per-annotation field defaults. Each `DEFAULT_*`
 * named export above is a re-spelling of one entry here; new code should
 * prefer `ANNOTATION_FIELD_DEFAULTS[key]` so adding a future field is a
 * one-row table edit.
 *
 * `labelHaloColor` is intentionally `undefined` — its baseline is "auto-flip
 * from labelColor", computed at render time, not a literal hex.
 */
export const ANNOTATION_FIELD_DEFAULTS = {
	icon: DEFAULT_ANNOTATION_ICON,
	iconColor: DEFAULT_ANNOTATION_COLOR,
	iconSize: DEFAULT_ANNOTATION_ICON_SIZE,
	iconHaloColor: DEFAULT_ICON_HALO_COLOR,
	iconHaloWidth: DEFAULT_ICON_HALO_WIDTH,
	labelColor: DEFAULT_ANNOTATION_LABEL_COLOR,
	labelSize: DEFAULT_ANNOTATION_LABEL_SIZE,
	labelPosition: DEFAULT_LABEL_POSITION,
	labelDistance: DEFAULT_LABEL_DISTANCE,
	labelFont: DEFAULT_ANNOTATION_LABEL_FONT,
	labelHaloColor: undefined as string | undefined,
	labelHaloWidth: DEFAULT_LABEL_HALO_WIDTH,
	rotation: 0
} as const satisfies Partial<Annotation>;

export interface Animation {
	version: number;
	style: MapStyleId;
	/**
	 * Colour theme of the OSM map, or of the OSM overlay on `satellite`.
	 * Unset means the style's own default — see `DEFAULT_MAP_THEMES`.
	 */
	theme?: MapTheme;
	/**
	 * For `colorful`: show / hide place names, road names, POIs, etc.
	 * For `satellite`: show the OSM overlay (roads + labels) on top of
	 * the imagery, or just the raw imagery on its own.
	 */
	labels: boolean;
	/**
	 * Layer groups switched off, in `MAP_LAYER_GROUPS` order. Unset or empty
	 * means every group is drawn. On `satellite` only the groups in
	 * `SATELLITE_OVERLAY_LAYER_GROUPS` have an effect.
	 */
	hiddenLayers?: MapLayerGroup[];
	/**
	 * Draw buildings as 3D blocks with their real heights instead of flat
	 * footprints. OSM map only — the satellite overlay has no buildings.
	 * Buildings appear from zoom 14, so that is where the blocks show up.
	 */
	buildings3d?: boolean;
	/**
	 * Position of the sun. Unset means the map's standard lighting. Only 3D
	 * buildings and the terrain's hillshade react to it, and only on the OSM
	 * map — the satellite map's hillshade keeps the standard light.
	 */
	sun?: Sun;
	/** Unset means `mercator`. Also decides how the camera travels between keyframes. */
	projection?: MapProjection;
	terrain: boolean;
	/** Renders the maplibre atmospheric sky behind the horizon (visible at pitch). */
	sky: boolean;
	keyframes: Keyframe[];
	annotations: Annotation[];
	/** Multiplier for icon + label size. Defaults to 1. */
	annotationScale: number;
	/** Composition aspect ratio. Defaults to 16:9. */
	aspectRatio: AspectRatio;
	/** Unset means the middle of the frame — see `ScreenAnchor`. */
	anchor?: ScreenAnchor;
	/**
	 * Per-animation marker style defaults — fields set here become the
	 * baseline for new markers (+ Marker button) AND the codec's carry-forward
	 * starting point, so annotations matching the defaults emit nothing on
	 * the wire / in JSON. Position-specific fields (lng/lat/label/rotation)
	 * and time-specific fields (visibleFrom/visibleUntil/fadeIn/fadeOut)
	 * are intentionally excluded — see `AnnotationStyle`.
	 */
	defaultAnnotation: Partial<AnnotationStyle>;
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
		...ANIMATION_DEFAULTS,
		keyframes: [],
		annotations: [],
		defaultAnnotation: {}
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
