import { sampleAt } from './interpolate';
import {
	ANIMATION_DEFAULTS,
	ANNOTATION_FIELD_DEFAULTS,
	cameraOf,
	createEmptyAnimation,
	DEFAULT_INITIAL_VIEW,
	SCHEMA_VERSION
} from './types';
import type {
	Animation,
	Annotation,
	AnnotationIcon,
	AnnotationStyle,
	AspectRatio,
	CameraState,
	Keyframe,
	MapStyleId,
	PathStyle
} from './types';

/**
 * An `Annotation` with the always-defaulted style fields (`icon`, `iconColor`)
 * narrowed to non-optional. Returned by `resolveAnnotation`, which guarantees
 * the merged result has both — the hardcoded `ANNOTATION_FIELD_DEFAULTS`
 * fills them in when neither the per-annotation override nor the per-animation
 * default provides one. Use this where you read style fields directly (the
 * renderer, the list/timeline preview swatches, the editor inputs).
 */
export type ResolvedAnnotation = Annotation & {
	icon: AnnotationIcon;
	iconColor: string;
};

const MIN_TIME_GAP = 0.01;

/** Snap a time value to the nearest centi-second (1/100 s). Keyframe `t`
 *  values are stored on this grid so the timeline reads as clean decimals
 *  ("3.27 s") rather than floating-point dust from drag math. */
function snapTime(t: number): number {
	return Math.round(t * 100) / 100;
}

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

/**
 * Resolve an annotation's style by merging the three layers of defaults in
 * the correct order:
 *
 *   `ANNOTATION_FIELD_DEFAULTS` (hardcoded baseline)
 *   ← `defaults` (per-animation template; `Animation.defaultAnnotation`)
 *   ← `ann` (per-annotation overrides)
 *
 * Used wherever code needs the "what this annotation actually looks like"
 * view — the renderer in `MapStage`, the annotation panel's display, etc.
 * Storage formats (URL codec, JSON) keep the unmerged form so per-animation
 * defaults can change without rewriting every annotation.
 *
 * Fields explicitly set to `undefined` on `ann` (or `defaults`) fall through
 * to the next layer, matching `updateAnnotation`'s delete-on-undefined
 * semantics — that's what lets the per-annotation reset button "clear an
 * override" rather than "snapshot the current default".
 */
export function resolveAnnotation(
	ann: Annotation,
	defaults: Partial<AnnotationStyle>
): ResolvedAnnotation {
	const out: Record<string, unknown> = { ...ANNOTATION_FIELD_DEFAULTS };
	for (const k in defaults) {
		const v = (defaults as unknown as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	for (const k in ann) {
		const v = (ann as unknown as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	return out as unknown as ResolvedAnnotation;
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
	style = $state<MapStyleId>(ANIMATION_DEFAULTS.style);
	labels = $state(ANIMATION_DEFAULTS.labels);
	terrain = $state(ANIMATION_DEFAULTS.terrain);
	sky = $state(ANIMATION_DEFAULTS.sky);
	annotationScale = $state<number>(ANIMATION_DEFAULTS.annotationScale);
	aspectRatio = $state<AspectRatio>(ANIMATION_DEFAULTS.aspectRatio);
	/**
	 * Per-animation marker style defaults. New markers start from these; the
	 * URL/JSON codec uses them as the carry-forward baseline so annotations
	 * matching the defaults emit no per-field bytes.
	 */
	defaultAnnotation = $state<Partial<AnnotationStyle>>({});
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
		let t = snapTime(this.currentTime);
		// If the playhead is parked on (or right next to) an existing keyframe,
		// fall back to appending after the last one — otherwise consecutive
		// clicks would all collide at the same time.
		const collides = this.keyframes.some((kf) => Math.abs(kf.t - t) < MIN_TIME_GAP);
		if (collides) {
			t = snapTime(this.keyframes[this.keyframes.length - 1].t + 1.0);
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

	/**
	 * Set a keyframe's time `t`. The keyframe is allowed to cross its
	 * neighbors — when it does, the array is re-sorted and `selectedIndex` is
	 * adjusted so the moved keyframe stays selected and surrounding
	 * selections track correctly. Only constraint: `t ≥ 0`, and if the new
	 * time collides with another keyframe within `MIN_TIME_GAP` it's
	 * nudged forward by that gap so every keyframe stays distinguishable.
	 *
	 * That lets the user drag a keyframe along the timeline past other
	 * keyframes to reorder the sequence, instead of being clamped to its
	 * starting slot.
	 */
	setKeyframeTime(index: number, t: number): void {
		if (index < 0 || index >= this.keyframes.length) return;
		// Snap to the 1/100s grid so dragged values land on clean centi-second
		// stops, then clamp to t ≥ 0.
		const moved: Keyframe = { ...this.keyframes[index], t: Math.max(0, snapTime(t)) };
		const others = this.keyframes.filter((_, i) => i !== index);
		// Nudge until no other keyframe is within MIN_TIME_GAP. MIN_TIME_GAP is
		// itself one grid step, so nudged values stay on the grid.
		while (others.some((o) => Math.abs(o.t - moved.t) < MIN_TIME_GAP)) {
			moved.t = snapTime(moved.t + MIN_TIME_GAP);
		}
		const sorted = [...others, moved].sort((a, b) => a.t - b.t);
		const newIndex = sorted.indexOf(moved);
		// Follow the moved keyframe with the selection (if it was selected),
		// and shift `selectedIndex` left/right when the moved keyframe crossed
		// over the currently-selected one.
		if (this.selectedIndex === index) {
			this.selectedIndex = newIndex;
		} else if (this.selectedIndex !== null) {
			const sel = this.selectedIndex;
			if (index < sel && newIndex >= sel) this.selectedIndex = sel - 1;
			else if (index > sel && newIndex <= sel) this.selectedIndex = sel + 1;
		}
		this.keyframes = sorted;
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
		// Store the annotation thin — only position/content fields the caller
		// supplied. Style fields stay undefined so the renderer resolves them
		// from `defaultAnnotation` (or the hardcoded baseline) via
		// `resolveAnnotation`. That way, flipping a per-animation default
		// after the marker exists automatically updates the marker.
		this.annotations = [...this.annotations, ann];
		this.selectedAnnotationIndex = this.annotations.length - 1;
		this.selectedIndex = null;
	}

	updateAnnotation(index: number, patch: Partial<Annotation>): void {
		if (index < 0 || index >= this.annotations.length) return;
		const updated: Annotation = { ...this.annotations[index], ...patch };
		// Patch values explicitly set to `undefined` are treated as
		// "remove this override" — delete the field so the JSON/URL stays
		// clean and renderers fall back to their defaults. Callers must
		// avoid passing `undefined` for truly-required fields (lng, lat,
		// icon, iconColor, label) — none of the editor handlers do.
		for (const key in patch) {
			if (patch[key as keyof Annotation] === undefined) {
				delete (updated as unknown as Record<string, unknown>)[key];
			}
		}
		this.annotations = replaceAt(this.annotations, index, updated);
	}

	deleteAnnotation(index: number): void {
		if (index < 0 || index >= this.annotations.length) return;
		this.annotations = this.annotations.filter((_, i) => i !== index);
		this.selectedAnnotationIndex = adjustIndexAfterDelete(this.selectedAnnotationIndex, index);
	}

	/**
	 * Clone an annotation, nudge the copy slightly so it's not stacked exactly
	 * on top of the original, insert it directly after, and select the clone.
	 * The offset is small in degrees but visible at typical zoom levels.
	 */
	duplicateAnnotation(index: number): void {
		if (index < 0 || index >= this.annotations.length) return;
		const original = this.annotations[index];
		const clone: Annotation = {
			...original,
			lng: original.lng + 0.001,
			lat: original.lat + 0.001
		};
		this.annotations = [
			...this.annotations.slice(0, index + 1),
			clone,
			...this.annotations.slice(index + 1)
		];
		this.selectedAnnotationIndex = index + 1;
	}

	/**
	 * Move the annotation at `from` to position `to`. `to` is interpreted as
	 * the destination slot in the *original* array (drop-target index from
	 * the drag-and-drop flow), so dropping on slot `arr.length` appends. The
	 * selection follows the moved item, and any selected item swept past by
	 * the shift gets its index adjusted accordingly.
	 */
	reorderAnnotation(from: number, to: number): void {
		if (from === to) return;
		if (from < 0 || from >= this.annotations.length) return;
		if (to < 0 || to > this.annotations.length) return;
		const arr = [...this.annotations];
		const [moved] = arr.splice(from, 1);
		// After removing the source, the destination index shifts left by 1
		// when the source was earlier in the array.
		const insertAt = to > from ? to - 1 : to;
		arr.splice(insertAt, 0, moved);
		this.annotations = arr;

		const sel = this.selectedAnnotationIndex;
		if (sel === null) return;
		if (sel === from) {
			this.selectedAnnotationIndex = insertAt;
		} else if (from < sel && sel <= insertAt) {
			// The selected item shifted left to fill the source's vacancy.
			this.selectedAnnotationIndex = sel - 1;
		} else if (insertAt <= sel && sel < from) {
			// The selected item shifted right to make room for the inserted item.
			this.selectedAnnotationIndex = sel + 1;
		}
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
		this.style = anim.style ?? ANIMATION_DEFAULTS.style;
		this.labels = anim.labels ?? ANIMATION_DEFAULTS.labels;
		this.terrain = anim.terrain ?? ANIMATION_DEFAULTS.terrain;
		this.sky = anim.sky ?? ANIMATION_DEFAULTS.sky;
		this.annotationScale = anim.annotationScale ?? ANIMATION_DEFAULTS.annotationScale;
		this.aspectRatio = anim.aspectRatio ?? ANIMATION_DEFAULTS.aspectRatio;
		this.defaultAnnotation = { ...(anim.defaultAnnotation ?? {}) };
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
			aspectRatio: this.aspectRatio,
			defaultAnnotation: { ...this.defaultAnnotation }
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
