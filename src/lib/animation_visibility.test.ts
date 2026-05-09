import { describe, it, expect } from 'vitest';
import { isAnnotationVisible } from './animation.svelte';
import type { Annotation } from './types';

const base: Annotation = {
	lng: 0,
	lat: 0,
	icon: 'symbol-marker',
	color: '#ffffff',
	label: ''
};

describe('isAnnotationVisible', () => {
	it('always-visible annotation is visible at any time', () => {
		expect(isAnnotationVisible(base, 0)).toBe(true);
		expect(isAnnotationVisible(base, 1000)).toBe(true);
	});

	it('respects visibleFrom (closed lower bound)', () => {
		const a: Annotation = { ...base, visibleFrom: 2 };
		expect(isAnnotationVisible(a, 1.99)).toBe(false);
		expect(isAnnotationVisible(a, 2)).toBe(true);
		expect(isAnnotationVisible(a, 5)).toBe(true);
	});

	it('respects visibleUntil (open upper bound)', () => {
		const a: Annotation = { ...base, visibleUntil: 5 };
		expect(isAnnotationVisible(a, 0)).toBe(true);
		expect(isAnnotationVisible(a, 4.99)).toBe(true);
		// Half-open at the top: at exactly visibleUntil the annotation is gone.
		// Matches how keyframes treat the next keyframe's timestamp.
		expect(isAnnotationVisible(a, 5)).toBe(false);
	});

	it('respects both bounds together', () => {
		const a: Annotation = { ...base, visibleFrom: 1, visibleUntil: 3 };
		expect(isAnnotationVisible(a, 0.5)).toBe(false);
		expect(isAnnotationVisible(a, 1)).toBe(true);
		expect(isAnnotationVisible(a, 2)).toBe(true);
		expect(isAnnotationVisible(a, 3)).toBe(false);
	});

	it('zero-length window (from == until) is never visible', () => {
		const a: Annotation = { ...base, visibleFrom: 2, visibleUntil: 2 };
		expect(isAnnotationVisible(a, 2)).toBe(false);
	});
});
