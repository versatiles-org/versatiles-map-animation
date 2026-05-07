export const SCHEMA_VERSION = 1;

export const MAP_STYLE_IDS = ['colorful', 'satellite', 'satellite-overlay'] as const;
export type MapStyleId = (typeof MAP_STYLE_IDS)[number];

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
}

export type CameraState = Omit<Keyframe, 't'>;

export interface Animation {
	version: number;
	style: MapStyleId;
	terrain: boolean;
	keyframes: Keyframe[];
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
		keyframes: []
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
