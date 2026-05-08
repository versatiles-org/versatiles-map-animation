import { sampleAt } from './interpolate';
import {
	cameraOf,
	createEmptyAnimation,
	DEFAULT_INITIAL_VIEW,
	DEFAULT_STYLE,
	DEFAULT_TERRAIN,
	SCHEMA_VERSION
} from './types';
import type { Animation, CameraState, Keyframe, MapStyleId } from './types';

const MIN_TIME_GAP = 0.01;

export class AnimationStore {
	keyframes = $state<Keyframe[]>([]);
	currentTime = $state(0);
	isPlaying = $state(false);
	selectedIndex = $state<number | null>(null);
	style = $state<MapStyleId>(DEFAULT_STYLE);
	terrain = $state(DEFAULT_TERRAIN);
	/** Live camera state from the map; not part of the saved animation. */
	liveCamera = $state<CameraState>({ ...DEFAULT_INITIAL_VIEW });

	totalDuration = $derived(
		this.keyframes.length > 0 ? this.keyframes[this.keyframes.length - 1].t : 0
	);
	selectedKeyframe = $derived(
		this.selectedIndex !== null ? (this.keyframes[this.selectedIndex] ?? null) : null
	);
	sampledCamera = $derived(sampleAt(this.keyframes, this.currentTime));

	addKeyframeFromCamera(cam: CameraState): void {
		let t = this.currentTime;
		// If the playhead is parked on (or right next to) an existing keyframe,
		// fall back to appending after the last one — otherwise consecutive
		// clicks would all collide at the same time.
		const collides = this.keyframes.some((kf) => Math.abs(kf.t - t) < MIN_TIME_GAP);
		if (collides) {
			t = this.keyframes[this.keyframes.length - 1].t + 1.0;
		}
		const kf: Keyframe = { t, ...cam };
		const after = this.keyframes.findIndex((k) => k.t > t);
		const idx = after === -1 ? this.keyframes.length : after;
		this.keyframes = [...this.keyframes.slice(0, idx), kf, ...this.keyframes.slice(idx)];
		this.selectedIndex = idx;
		this.currentTime = t;
	}

	updateSelectedFromCamera(cam: CameraState): void {
		if (this.selectedIndex === null) return;
		const kf = this.keyframes[this.selectedIndex];
		if (!kf) return;
		const updated: Keyframe = { ...kf, ...cam };
		this.keyframes = [
			...this.keyframes.slice(0, this.selectedIndex),
			updated,
			...this.keyframes.slice(this.selectedIndex + 1)
		];
	}

	deleteAt(index: number): void {
		if (index < 0 || index >= this.keyframes.length) return;
		this.keyframes = this.keyframes.filter((_, i) => i !== index);
		if (this.selectedIndex === index) {
			this.selectedIndex = null;
		} else if (this.selectedIndex !== null && this.selectedIndex > index) {
			this.selectedIndex -= 1;
		}
	}

	/** Move a keyframe in time, clamped to a 0.01s buffer from neighbors. */
	setKeyframeTime(index: number, t: number): void {
		if (index < 0 || index >= this.keyframes.length) return;
		const minT = index > 0 ? this.keyframes[index - 1].t + MIN_TIME_GAP : 0;
		const maxT =
			index < this.keyframes.length - 1
				? this.keyframes[index + 1].t - MIN_TIME_GAP
				: Number.POSITIVE_INFINITY;
		const clamped = Math.max(minT, Math.min(maxT, t));
		const updated = { ...this.keyframes[index], t: clamped };
		this.keyframes = [
			...this.keyframes.slice(0, index),
			updated,
			...this.keyframes.slice(index + 1)
		];
	}

	selectAt(index: number): void {
		if (index < 0 || index >= this.keyframes.length) return;
		this.selectedIndex = index;
		this.currentTime = this.keyframes[index].t;
	}

	clearSelection(): void {
		this.selectedIndex = null;
	}

	seekTo(t: number): void {
		// No upper clamp: the user may scrub past the last keyframe to add a new
		// one there. sampleAt() holds the last keyframe's pose past the end.
		this.currentTime = Math.max(0, t);
	}

	play(): void {
		if (this.keyframes.length < 2) return;
		if (this.currentTime >= this.totalDuration) this.currentTime = 0;
		this.isPlaying = true;
	}

	pause(): void {
		this.isPlaying = false;
	}

	togglePlay(): void {
		if (this.isPlaying) this.pause();
		else this.play();
	}

	restart(): void {
		this.currentTime = 0;
		this.isPlaying = false;
	}

	loadFromAnimation(anim: Animation): void {
		this.keyframes = [...anim.keyframes].sort((a, b) => a.t - b.t);
		this.style = anim.style ?? DEFAULT_STYLE;
		this.terrain = anim.terrain ?? DEFAULT_TERRAIN;
		this.selectedIndex = null;
		this.currentTime = 0;
		this.isPlaying = false;
	}

	toAnimation(): Animation {
		return {
			version: SCHEMA_VERSION,
			style: this.style,
			terrain: this.terrain,
			keyframes: this.keyframes.map((kf) => ({ ...kf }))
		};
	}

	reset(): void {
		this.loadFromAnimation(createEmptyAnimation());
	}

	cameraAtKeyframe(index: number): CameraState | null {
		const kf = this.keyframes[index];
		return kf ? cameraOf(kf) : null;
	}
}
