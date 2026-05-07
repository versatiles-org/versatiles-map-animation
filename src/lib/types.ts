export const SCHEMA_VERSION = 1;

export const DEFAULT_STYLE = 'colorful';

export interface Keyframe {
	/** seconds, absolute, monotonically increasing */
	t: number;
	lng: number;
	lat: number;
	zoom: number;
	/** 0..85 degrees */
	pitch: number;
	/** -180..180 degrees */
	bearing: number;
	/** -180..180 degrees */
	roll: number;
}

export type CameraState = Omit<Keyframe, 't'>;

export interface Animation {
	version: number;
	style: string;
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
