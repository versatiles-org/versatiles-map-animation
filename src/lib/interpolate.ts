import { cameraOf, type CameraState, type Keyframe } from './types';

/** Standard cubic ease-in-out on [0, 1]. */
export function easeInOut(t: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerp(a: number, b: number, alpha: number): number {
	return a + (b - a) * alpha;
}

/** Interpolate an angle in degrees taking the shortest path. Result normalized to (-180, 180]. */
export function lerpAngle(a: number, b: number, alpha: number): number {
	const delta = ((((b - a + 180) % 360) + 360) % 360) - 180;
	const raw = a + delta * alpha;
	return ((((raw + 180) % 360) + 360) % 360) - 180;
}

export function interpolateKeyframes(kfA: Keyframe, kfB: Keyframe, alpha: number): CameraState {
	const eased = easeInOut(alpha);
	return {
		lng: lerp(kfA.lng, kfB.lng, eased),
		lat: lerp(kfA.lat, kfB.lat, eased),
		zoom: lerp(kfA.zoom, kfB.zoom, eased),
		pitch: lerp(kfA.pitch, kfB.pitch, eased),
		bearing: lerpAngle(kfA.bearing, kfB.bearing, eased),
		roll: lerpAngle(kfA.roll, kfB.roll, eased)
	};
}

/**
 * Sample camera state at time t (seconds) from a keyframe array sorted by t.
 * Returns null if the array is empty. Holds the first/last keyframe outside
 * the defined range (US-defined "hold last frame" behavior).
 */
export function sampleAt(keyframes: Keyframe[], t: number): CameraState | null {
	if (keyframes.length === 0) return null;
	if (keyframes.length === 1 || t <= keyframes[0].t) return cameraOf(keyframes[0]);
	const last = keyframes[keyframes.length - 1];
	if (t >= last.t) return cameraOf(last);
	for (let i = 0; i < keyframes.length - 1; i++) {
		const a = keyframes[i];
		const b = keyframes[i + 1];
		if (t >= a.t && t <= b.t) {
			const span = b.t - a.t;
			const alpha = span > 0 ? (t - a.t) / span : 0;
			return interpolateKeyframes(a, b, alpha);
		}
	}
	return cameraOf(last);
}
