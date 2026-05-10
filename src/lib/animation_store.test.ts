import { describe, it, expect } from 'vitest';
import { AnimationStore } from './animation.svelte';
import type { Annotation, CameraState } from './types';

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

	it('setKeyframeTime clamps to neighbor + MIN_TIME_GAP', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam()); // t=0
		s.addKeyframeFromCamera(cam(1, 0)); // t=1
		s.addKeyframeFromCamera(cam(2, 0)); // t=2
		// Try to push middle past the right neighbor.
		s.setKeyframeTime(1, 999);
		expect(s.keyframes[1].t).toBeLessThan(2);
		// Try to drag below the left neighbor.
		s.setKeyframeTime(1, -10);
		expect(s.keyframes[1].t).toBeGreaterThan(0);
	});

	it('setKeyframeTime ignores out-of-range index', () => {
		const s = new AnimationStore();
		s.addKeyframeFromCamera(cam());
		s.setKeyframeTime(99, 5);
		expect(s.keyframes[0].t).toBe(0);
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
	it('addAnnotation applies the per-animation defaultAnnotation under caller fields', () => {
		const s = new AnimationStore();
		s.defaultAnnotation = {
			labelFont: 'roboto_bold_italic',
			labelHaloWidth: 2.5
		};
		s.addAnnotation(ann({ label: 'X' }));
		// Caller-provided fields (label, lng, lat, etc.) win; default-only
		// fields (font, halo width) are inherited from store.defaultAnnotation.
		const a = s.annotations[0];
		expect(a.label).toBe('X');
		expect(a.labelFont).toBe('roboto_bold_italic');
		expect(a.labelHaloWidth).toBe(2.5);
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
