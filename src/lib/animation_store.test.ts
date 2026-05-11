import { describe, it, expect } from 'vitest';
import { AnimationStore, resolveAnnotation } from './animation.svelte';
import {
	DEFAULT_ANNOTATION_ICON,
	DEFAULT_ANNOTATION_LABEL_FONT,
	DEFAULT_LABEL_DISTANCE,
	type Annotation,
	type CameraState
} from './types';

const cam = (lng = 0, lat = 0): CameraState => ({
	lng,
	lat,
	zoom: 4,
	pitch: 0,
	bearing: 0,
	roll: 0
});

const ann = (overrides: Partial<Annotation> = {}): Annotation => ({
	lng: 0,
	lat: 0,
	icon: 'symbol-marker',
	iconColor: '#cc0000',
	label: '',
	...overrides
});

describe('AnimationStore - construction', () => {
	it('starts empty', () => {
		const s = new AnimationStore();
		expect(s.keyframes).toEqual([]);
		expect(s.annotations).toEqual([]);
		expect(s.totalDuration).toBe(0);
		expect(s.selectedKeyframe).toBeNull();
		expect(s.selectedAnnotation).toBeNull();
	});
});

describe('AnimationStore - keyframe CRUD', () => {
	it('addKeyframeFromCamera at t=0 inserts and selects', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam(1, 2));
		expect(s.keyframes).toHaveLength(1);
		expect(s.selectedIndex).toBe(0);
		expect(s.keyframes[0]).toMatchObject({ t: 0, lng: 1, lat: 2 });
	});

	it('two consecutive adds at t=0 push the second forward by 1s', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(5, 5));
		expect(s.keyframes).toHaveLength(2);
		expect(s.keyframes[1].t).toBe(1);
		expect(s.totalDuration).toBe(1);
	});

	it('addKeyframeFromCamera inserts in order when playhead is between keyframes', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam()); // t=0
		s.addKeyframeFromCamera(cam(1, 0)); // t=1
		s.currentTime = 0.5;
		s.addKeyframeFromCamera(cam(0.5, 0));
		// Expect the new one at index 1 (between 0 and 1).
		expect(s.keyframes.map((k) => k.t)).toEqual([0, 0.5, 1]);
		expect(s.selectedIndex).toBe(1);
	});

	it('updateSelectedFromCamera mutates only the selected keyframe', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam(0, 0));
		s.addKeyframeFromCamera(cam(1, 1));
		s.selectedIndex = 0;
		s.updateSelectedFromCamera(cam(9, 9));
		expect(s.keyframes[0]).toMatchObject({ lng: 9, lat: 9 });
		expect(s.keyframes[1]).toMatchObject({ lng: 1, lat: 1 });
	});

	it('updateSelectedFromCamera is a no-op with no selection', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.selectedIndex = null;
		s.updateSelectedFromCamera(cam(9, 9));
		expect(s.keyframes[0]).toMatchObject({ lng: 0, lat: 0 });
	});

	it('setKeyframePath toggles the path field; "arc" deletes it', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.setKeyframePath(0, 'linear');
		expect(s.keyframes[0].path).toBe('linear');
		s.setKeyframePath(0, 'arc');
		expect(s.keyframes[0]).not.toHaveProperty('path');
	});

	it('setKeyframeTime clamps t to ≥ 0', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam()); // t=0
		s.addKeyframeFromCamera(cam(1, 0)); // t=1
		// Trying to drag below 0 → clamps to 0. The existing keyframe at 0 is
		// then nudged forward to keep them distinguishable.
		s.setKeyframeTime(1, -10);
		expect(s.keyframes.every((k) => k.t >= 0)).toBe(true);
	});

	it('setKeyframeTime ignores out-of-range index', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.setKeyframeTime(99, 5);
		expect(s.keyframes[0].t).toBe(0);
	});

	it('setKeyframeTime past a neighbor reorders the array and follows the selection', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam(0, 0)); // t=0
		s.addKeyframeFromCamera(cam(1, 0)); // t=1, lng=1 — uniquely identifies this kf
		s.addKeyframeFromCamera(cam(2, 0)); // t=2
		s.selectAt(1); // select the middle keyframe (lng=1)
		s.setKeyframeTime(1, 5); // push past the t=2 neighbor
		// Array is re-sorted; the moved keyframe is now last.
		expect(s.keyframes.map((k) => k.t)).toEqual([0, 2, 5]);
		// Identify the moved keyframe by its lng (1), which survived the move.
		expect(s.keyframes[2].lng).toBe(1);
		// Selection follows the moved keyframe to its new index.
		expect(s.selectedIndex).toBe(2);
	});

	it('setKeyframeTime nudges to avoid colliding with another keyframe', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(1, 0)); // t=1
		// Try to set the first keyframe to exactly t=1; should nudge forward.
		s.setKeyframeTime(0, 1);
		const times = s.keyframes.map((k) => k.t).sort((a, b) => a - b);
		expect(times[1] - times[0]).toBeGreaterThanOrEqual(0.01);
	});

	it('setKeyframeTime shifts a neighboring selection when the moved keyframe crosses over it', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam(0, 0)); // t=0
		s.addKeyframeFromCamera(cam(1, 0)); // t=1
		s.addKeyframeFromCamera(cam(2, 0)); // t=2
		s.selectAt(2); // select the last keyframe
		// Move keyframe 0 past keyframe 1 → array becomes [kf1, kf0, kf2].
		s.setKeyframeTime(0, 1.5);
		expect(s.keyframes[2].t).toBe(2);
		// Selection on the last keyframe is unchanged in identity but its
		// index shifted from 2 to… still 2, because the moved kf landed at
		// idx 1 (not past selection).
		expect(s.selectedIndex).toBe(2);
	});

	it('deleteAt removes the keyframe and clears selection if it was selected', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(1, 0));
		s.selectedIndex = 0;
		s.deleteAt(0);
		expect(s.keyframes).toHaveLength(1);
		expect(s.selectedIndex).toBeNull();
	});

	it('deleteAt shifts selection down for items after the deleted one', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(1, 0));
		s.addKeyframeFromCamera(cam(2, 0));
		s.selectedIndex = 2;
		s.deleteAt(0);
		expect(s.selectedIndex).toBe(1);
	});

	it('deleteAt leaves earlier selection unchanged', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(1, 0));
		s.addKeyframeFromCamera(cam(2, 0));
		s.selectedIndex = 0;
		s.deleteAt(2);
		expect(s.selectedIndex).toBe(0);
	});

	it('deleteAt ignores out-of-range index', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.deleteAt(99);
		expect(s.keyframes).toHaveLength(1);
	});
});

describe('AnimationStore - annotation CRUD', () => {
	it('addAnnotation stores the annotation thin — no default-spread', () => {
		const s = new AnimationStore();
		s.defaultAnnotation = {
			labelFont: 'roboto_bold_italic',
			labelHaloWidth: 2.5
		};
		s.addAnnotation(ann({ label: 'X' }));
		// Annotation stores only what the caller supplied. Per-animation
		// defaults are NOT baked in at creation; the renderer (and any
		// consumer that calls `resolveAnnotation`) pulls them in dynamically.
		const a = s.annotations[0];
		expect(a.label).toBe('X');
		expect(a).not.toHaveProperty('labelFont');
		expect(a).not.toHaveProperty('labelHaloWidth');
		// …but the resolved view does see the defaults.
		const resolved = resolveAnnotation(a, s.defaultAnnotation);
		expect(resolved.labelFont).toBe('roboto_bold_italic');
		expect(resolved.labelHaloWidth).toBe(2.5);
	});

	it('addAnnotation accepts a position-only annotation (no style fields)', () => {
		const s = new AnimationStore();
		s.addAnnotation({ lng: 1, lat: 2, label: '' });
		const a = s.annotations[0];
		// Pin button passes only position + label; icon/iconColor are
		// optional and absent on the raw annotation.
		expect(a).not.toHaveProperty('icon');
		expect(a).not.toHaveProperty('iconColor');
		// Resolver fills them in from the hardcoded baseline.
		const resolved = resolveAnnotation(a, s.defaultAnnotation);
		expect(resolved.icon).toBeDefined();
		expect(resolved.iconColor).toBeDefined();
	});

	it('addAnnotation appends, selects it, and clears keyframe selection', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.selectedIndex = 0;
		s.addAnnotation(ann({ lng: 5 }));
		expect(s.annotations).toHaveLength(1);
		expect(s.selectedAnnotationIndex).toBe(0);
		expect(s.selectedIndex).toBeNull();
	});

	it('updateAnnotation merges patch with existing fields', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ label: 'a', rotation: 30 }));
		s.updateAnnotation(0, { label: 'b' });
		expect(s.annotations[0].label).toBe('b');
		expect(s.annotations[0].rotation).toBe(30);
	});

	it('updateAnnotation deletes optional fields explicitly set to undefined', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ rotation: 30, visibleFrom: 1, visibleUntil: 5 }));
		s.updateAnnotation(0, { rotation: undefined, visibleFrom: undefined });
		expect(s.annotations[0]).not.toHaveProperty('rotation');
		expect(s.annotations[0]).not.toHaveProperty('visibleFrom');
		// visibleUntil wasn't touched
		expect(s.annotations[0].visibleUntil).toBe(5);
	});

	it('updateAnnotation deletes any optional field set to undefined (generic)', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ iconSize: 1.5, labelFont: 'roboto_bold', labelHaloWidth: 2 }));
		s.updateAnnotation(0, {
			iconSize: undefined,
			labelFont: undefined,
			labelHaloWidth: undefined
		});
		expect(s.annotations[0]).not.toHaveProperty('iconSize');
		expect(s.annotations[0]).not.toHaveProperty('labelFont');
		expect(s.annotations[0]).not.toHaveProperty('labelHaloWidth');
	});

	it('updateAnnotation ignores out-of-range index', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann());
		s.updateAnnotation(99, { label: 'no' });
		expect(s.annotations[0].label).toBe('');
	});

	it('deleteAnnotation cascades selection like deleteAt', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ label: 'a' }));
		s.addAnnotation(ann({ label: 'b' }));
		s.addAnnotation(ann({ label: 'c' }));
		s.selectedAnnotationIndex = 2;
		s.deleteAnnotation(0);
		expect(s.selectedAnnotationIndex).toBe(1);
		expect(s.annotations.map((a) => a.label)).toEqual(['b', 'c']);
	});

	it('deleteAnnotation clears selection if the selected one was deleted', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann());
		s.selectedAnnotationIndex = 0;
		s.deleteAnnotation(0);
		expect(s.selectedAnnotationIndex).toBeNull();
	});

	it('selectAt clears annotation selection; selectAnnotation clears keyframe selection', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addAnnotation(ann());
		s.selectAt(0);
		expect(s.selectedAnnotationIndex).toBeNull();
		expect(s.selectedIndex).toBe(0);
		s.selectAnnotation(0);
		expect(s.selectedIndex).toBeNull();
		expect(s.selectedAnnotationIndex).toBe(0);
	});

	it('duplicateAnnotation inserts a clone after the source and selects it', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ label: 'a', lng: 10, lat: 20, iconColor: '#f00' }));
		s.duplicateAnnotation(0);
		expect(s.annotations).toHaveLength(2);
		expect(s.annotations[1].label).toBe('a');
		expect(s.annotations[1].iconColor).toBe('#f00');
		// Slight position offset so the clone is visible.
		expect(s.annotations[1].lng).toBeCloseTo(10.001, 5);
		expect(s.annotations[1].lat).toBeCloseTo(20.001, 5);
		expect(s.selectedAnnotationIndex).toBe(1);
	});

	it('duplicateAnnotation ignores out-of-range indexes', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann());
		s.duplicateAnnotation(99);
		expect(s.annotations).toHaveLength(1);
	});

	it('reorderAnnotation moves an item and follows the selection', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ label: 'a' }));
		s.addAnnotation(ann({ label: 'b' }));
		s.addAnnotation(ann({ label: 'c' }));
		s.selectedAnnotationIndex = 0; // selecting 'a'
		// Move 'a' to slot 3 (i.e. end of array)
		s.reorderAnnotation(0, 3);
		expect(s.annotations.map((a) => a.label)).toEqual(['b', 'c', 'a']);
		expect(s.selectedAnnotationIndex).toBe(2);
	});

	it('reorderAnnotation: dragging later → earlier shifts items right', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ label: 'a' }));
		s.addAnnotation(ann({ label: 'b' }));
		s.addAnnotation(ann({ label: 'c' }));
		s.selectedAnnotationIndex = 0; // 'a' selected
		// Move 'c' (idx 2) to slot 0 (insert at front)
		s.reorderAnnotation(2, 0);
		expect(s.annotations.map((a) => a.label)).toEqual(['c', 'a', 'b']);
		// 'a' shifted right → was 0, now 1
		expect(s.selectedAnnotationIndex).toBe(1);
	});

	it('reorderAnnotation is a no-op when from === to', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ label: 'a' }));
		s.addAnnotation(ann({ label: 'b' }));
		s.reorderAnnotation(1, 1);
		expect(s.annotations.map((a) => a.label)).toEqual(['a', 'b']);
	});

	it('reorderAnnotation ignores out-of-range indexes', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ label: 'a' }));
		s.addAnnotation(ann({ label: 'b' }));
		s.reorderAnnotation(0, 99);
		s.reorderAnnotation(99, 0);
		expect(s.annotations.map((a) => a.label)).toEqual(['a', 'b']);
	});

	it('sampledAnnotations only returns visible ones', () => {
		const s = new AnimationStore();
		s.addAnnotation(ann({ visibleFrom: 0, visibleUntil: 2, label: 'early' }));
		s.addAnnotation(ann({ visibleFrom: 5, visibleUntil: 10, label: 'late' }));
		s.currentTime = 1;
		expect(s.sampledAnnotations.map((a) => a.label)).toEqual(['early']);
		s.currentTime = 6;
		expect(s.sampledAnnotations.map((a) => a.label)).toEqual(['late']);
	});
});

describe('resolveAnnotation', () => {
	it('fills missing fields from the per-animation defaults', () => {
		const out = resolveAnnotation(ann({ label: 'X' }), {
			labelFont: 'roboto_bold_italic',
			labelDistance: 3
		});
		expect(out.labelFont).toBe('roboto_bold_italic');
		expect(out.labelDistance).toBe(3);
	});

	it('per-annotation overrides win over per-animation defaults', () => {
		const out = resolveAnnotation(ann({ labelFont: 'lato_bold' }), {
			labelFont: 'roboto_bold_italic'
		});
		expect(out.labelFont).toBe('lato_bold');
	});

	it('fields absent from both layers fall back to hardcoded baseline', () => {
		const out = resolveAnnotation(ann(), {});
		expect(out.icon).toBe(DEFAULT_ANNOTATION_ICON);
		expect(out.labelFont).toBe(DEFAULT_ANNOTATION_LABEL_FONT);
		expect(out.labelDistance).toBe(DEFAULT_LABEL_DISTANCE);
	});

	it('explicit undefined on the annotation falls through to defaults', () => {
		// Mirrors what the per-annotation editor's "reset to default" does:
		// `updateAnnotation` deletes keys whose patch value is undefined,
		// but the resolver should treat an explicit-undefined the same way.
		const raw = { ...ann(), labelFont: undefined } as Annotation;
		const out = resolveAnnotation(raw, { labelFont: 'roboto_bold' });
		expect(out.labelFont).toBe('roboto_bold');
	});
});

describe('AnimationStore - playback', () => {
	it('togglePlay does nothing with fewer than 2 keyframes', () => {
		const s = new AnimationStore();
		s.togglePlay();
		expect(s.isPlaying).toBe(false);
		s.addKeyframeFromCamera(cam());
		s.togglePlay();
		expect(s.isPlaying).toBe(false);
	});

	it('play restarts to t=0 if currently parked at the end', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(1, 0));
		s.currentTime = s.totalDuration;
		s.play();
		expect(s.currentTime).toBe(0);
		expect(s.isPlaying).toBe(true);
	});

	it('pause sets isPlaying false', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(1, 0));
		s.play();
		s.pause();
		expect(s.isPlaying).toBe(false);
	});

	it('restart resets currentTime and stops', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addKeyframeFromCamera(cam(1, 0));
		s.play();
		s.currentTime = 0.5;
		s.restart();
		expect(s.currentTime).toBe(0);
		expect(s.isPlaying).toBe(false);
	});

	it('seekTo clamps below 0 but not above', () => {
		const s = new AnimationStore();
		s.seekTo(-1);
		expect(s.currentTime).toBe(0);
		s.seekTo(999);
		expect(s.currentTime).toBe(999);
	});
});

describe('AnimationStore - load/serialise', () => {
	it('loadFromAnimation sorts keyframes and resets selection', () => {
		const s = new AnimationStore();
		s.selectedIndex = 5;
		s.loadFromAnimation({
			version: 1,
			style: 'colorful',
			labels: false,
			terrain: true,
			sky: false,
			keyframes: [
				{ t: 2, lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0 },
				{ t: 0, lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0 }
			],
			annotations: [],
			annotationScale: 1,
			aspectRatio: '16:9',
			defaultAnnotation: {}
		});
		expect(s.keyframes.map((k) => k.t)).toEqual([0, 2]);
		expect(s.terrain).toBe(true);
		expect(s.selectedIndex).toBeNull();
	});

	it('toAnimation round-trips through loadFromAnimation', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam(1, 2));
		s.addAnnotation(ann({ label: 'x' }));
		const out = s.toAnimation();
		const s2 = new AnimationStore();
		s2.loadFromAnimation(out);
		expect(s2.keyframes).toEqual(s.keyframes);
		expect(s2.annotations).toEqual(s.annotations);
	});

	it('reset returns the store to an empty state', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.addAnnotation(ann());
		s.reset();
		expect(s.keyframes).toEqual([]);
		expect(s.annotations).toEqual([]);
	});

	it('cameraAtKeyframe returns camera or null', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam(3, 4));
		expect(s.cameraAtKeyframe(0)).toMatchObject({ lng: 3, lat: 4 });
		expect(s.cameraAtKeyframe(99)).toBeNull();
	});
});
