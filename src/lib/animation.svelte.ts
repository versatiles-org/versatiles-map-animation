import { sampleAt } from './interpolate';
import {
	cameraOf,
	createEmptyAnimation,
	DEFAULT_ANNOTATION_SCALE,
	DEFAULT_ASPECT_RATIO,
	DEFAULT_INITIAL_VIEW,
	DEFAULT_LABELS,
	DEFAULT_SKY,
	DEFAULT_STYLE,
	DEFAULT_TERRAIN,
	SCHEMA_VERSION
} from './types';
import type {
	Animation,
	Annotation,
	AspectRatio,
	CameraState,
	Keyframe,
	MapStyleId,
	PathStyle
} from './types';

const MIN_TIME_GAP = 0.01;

/** Return a new array with `arr[idx]` replaced by `value`. */
function replaceAt<T>(arr: T[], idx: number, value: T): T[] {
	return [...arr.slice(0, idx), value, ...arr.slice(idx + 1)];
}

/**
 * Renumber a selection index after deleting array element `deletedIdx`:
 * the deleted item itself ⇒ no selection; later items shift down by one;
 * earlier items are unaffected. Returns the new index (or null).
 */
function adjustIndexAfterDelete(sel: number | null, deletedIdx: number): number | null {
	if (sel === null) return null;
	if (sel === deletedIdx) return null;
	if (sel > deletedIdx) return sel - 1;
	return sel;
}

/**
 * Continuous opacity at time `t`. Inside the visibility window the opacity is
 * 1; outside it's 0; within `fadeIn` seconds before `visibleFrom` it ramps 0→1,
 * within `fadeOut` seconds after `visibleUntil` it ramps 1→0. Missing bounds
 * mean "from the start" / "always": with no `visibleFrom`, the corresponding
 * fade-in is moot (the annotation is already on screen); same for fade-out.
 *
 * Bounds are half-open at the upper end so an annotation with
 * `visibleUntil = 5` and `fadeOut = 0` is gone exactly at `t = 5`, matching
 * how keyframes treat the end of an interval.
 */
export function getAnnotationOpacity(ann: Annotation, t: number): number {
	const from = ann.visibleFrom;
	const until = ann.visibleUntil;
	const fadeIn = Math.max(0, ann.fadeIn ?? 0);
	const fadeOut = Math.max(0, ann.fadeOut ?? 0);
	if (from !== undefined) {
		if (t < from - fadeIn) return 0;
		if (t < from) return fadeIn === 0 ? 0 : (t - (from - fadeIn)) / fadeIn;
	}
	if (until !== undefined) {
		if (fadeOut === 0) {
			if (t >= until) return 0;
		} else {
			if (t >= until + fadeOut) return 0;
			if (t >= until) return 1 - (t - until) / fadeOut;
		}
	}
	return 1;
}

/**
 * Backwards-compatible boolean check used in places that just want "is this
 * annotation on screen at all?" (e.g., per-frame setFeatureState skips work
 * for fully-hidden annotations).
 */
export function isAnnotationVisible(ann: Annotation, t: number): boolean {
	return getAnnotationOpacity(ann, t) > 0;
}

export class AnimationStore {
	keyframes = $state<Keyframe[]>([]);
	annotations = $state<Annotation[]>([]);
	currentTime = $state(0);
	isPlaying = $state(false);
	/**
	 * True while the user is actively scrubbing the timeline playhead or
	 * dragging a keyframe. Like `isPlaying`, it signals "the user is watching
	 * the animation move", which the editor uses to suppress edit-mode chrome
	 * (e.g., the annotation opacity floor) so the on-screen result matches
	 * what the rendered video would show.
	 */
	isScrubbing = $state(false);
	selectedIndex = $state<number | null>(null);
	selectedAnnotationIndex = $state<number | null>(null);
	style = $state<MapStyleId>(DEFAULT_STYLE);
	labels = $state(DEFAULT_LABELS);
	terrain = $state(DEFAULT_TERRAIN);
	sky = $state(DEFAULT_SKY);
	annotationScale = $state(DEFAULT_ANNOTATION_SCALE);
	aspectRatio = $state<AspectRatio>(DEFAULT_ASPECT_RATIO);
	/** Live camera state from the map; not part of the saved animation. */
	liveCamera = $state<CameraState>({ ...DEFAULT_INITIAL_VIEW });

	totalDuration = $derived(
		this.keyframes.length > 0 ? this.keyframes[this.keyframes.length - 1].t : 0
	);
	selectedKeyframe = $derived(
		this.selectedIndex !== null ? (this.keyframes[this.selectedIndex] ?? null) : null
	);
	selectedAnnotation = $derived(
		this.selectedAnnotationIndex !== null
			? (this.annotations[this.selectedAnnotationIndex] ?? null)
			: null
	);
	sampledCamera = $derived(sampleAt(this.keyframes, this.currentTime));
	/**
	 * Annotations whose visibility window contains `currentTime`. Used by
	 * MapStage to drive the symbol-layer feature state per frame, and by the
	 * renderer to decide which markers to draw.
	 */
	sampledAnnotations = $derived(
		this.annotations.filter((a) => isAnnotationVisible(a, this.currentTime))
	);

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
		this.keyframes = replaceAt(this.keyframes, this.selectedIndex, { ...kf, ...cam });
	}

	deleteAt(index: number): void {
		if (index < 0 || index >= this.keyframes.length) return;
		this.keyframes = this.keyframes.filter((_, i) => i !== index);
		this.selectedIndex = adjustIndexAfterDelete(this.selectedIndex, index);
	}

	/** Set the trajectory style used to reach this keyframe from the previous one. */
	setKeyframePath(index: number, path: PathStyle): void {
		if (index < 0 || index >= this.keyframes.length) return;
		const kf = this.keyframes[index];
		if (!kf) return;
		const updated: Keyframe = { ...kf };
		if (path === 'arc') delete updated.path;
		else updated.path = path;
		this.keyframes = replaceAt(this.keyframes, index, updated);
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
		this.keyframes = replaceAt(this.keyframes, index, { ...this.keyframes[index], t: clamped });
	}

	selectAt(index: number): void {
		if (index < 0 || index >= this.keyframes.length) return;
		this.selectedIndex = index;
		this.selectedAnnotationIndex = null;
		this.currentTime = this.keyframes[index].t;
	}

	clearSelection(): void {
		this.selectedIndex = null;
	}

	// -------------------------------------------------------------------------
	// Annotations
	// -------------------------------------------------------------------------

	addAnnotation(ann: Annotation): void {
		this.annotations = [...this.annotations, { ...ann }];
		this.selectedAnnotationIndex = this.annotations.length - 1;
		this.selectedIndex = null;
	}

	updateAnnotation(index: number, patch: Partial<Annotation>): void {
		if (index < 0 || index >= this.annotations.length) return;
		const updated: Annotation = { ...this.annotations[index], ...patch };
		// Drop optional fields that were explicitly set to undefined so the
		// JSON/URL round-trip stays stable (don't emit "rotation: undefined").
		for (const key of ['rotation', 'visibleFrom', 'visibleUntil'] as const) {
			if (patch[key] === undefined && key in patch) delete updated[key];
		}
		this.annotations = replaceAt(this.annotations, index, updated);
	}

	deleteAnnotation(index: number): void {
		if (index < 0 || index >= this.annotations.length) return;
		this.annotations = this.annotations.filter((_, i) => i !== index);
		this.selectedAnnotationIndex = adjustIndexAfterDelete(this.selectedAnnotationIndex, index);
	}

	selectAnnotation(index: number): void {
		if (index < 0 || index >= this.annotations.length) return;
		this.selectedAnnotationIndex = index;
		this.selectedIndex = null;
	}

	clearAnnotationSelection(): void {
		this.selectedAnnotationIndex = null;
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
		this.annotations = (anim.annotations ?? []).map((a) => ({ ...a }));
		this.style = anim.style ?? DEFAULT_STYLE;
		this.labels = anim.labels ?? DEFAULT_LABELS;
		this.terrain = anim.terrain ?? DEFAULT_TERRAIN;
		this.sky = anim.sky ?? DEFAULT_SKY;
		this.annotationScale = anim.annotationScale ?? DEFAULT_ANNOTATION_SCALE;
		this.aspectRatio = anim.aspectRatio ?? DEFAULT_ASPECT_RATIO;
		this.selectedIndex = null;
		this.selectedAnnotationIndex = null;
		this.currentTime = 0;
		this.isPlaying = false;
	}

	toAnimation(): Animation {
		return {
			version: SCHEMA_VERSION,
			style: this.style,
			labels: this.labels,
			terrain: this.terrain,
			sky: this.sky,
			keyframes: this.keyframes.map((kf) => ({ ...kf })),
			annotations: this.annotations.map((a) => ({ ...a })),
			annotationScale: this.annotationScale,
			aspectRatio: this.aspectRatio
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
