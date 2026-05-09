import { describe, it, expect } from 'vitest';
import { getAnnotationOpacity, isAnnotationVisible } from './animation.svelte';
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

describe('getAnnotationOpacity', () => {
	it('returns 1 for an always-visible annotation', () => {
		expect(getAnnotationOpacity(base, 0)).toBe(1);
		expect(getAnnotationOpacity(base, 999)).toBe(1);
	});

	it('hard cuts when fadeIn / fadeOut are 0', () => {
		const a: Annotation = { ...base, visibleFrom: 2, visibleUntil: 5 };
		expect(getAnnotationOpacity(a, 1.99)).toBe(0);
		expect(getAnnotationOpacity(a, 2)).toBe(1);
		expect(getAnnotationOpacity(a, 5)).toBe(0);
	});

	it('linear ramp during fade-in (ends at full opacity at visibleFrom)', () => {
		const a: Annotation = { ...base, visibleFrom: 2, fadeIn: 1 };
		expect(getAnnotationOpacity(a, 0)).toBe(0);
		expect(getAnnotationOpacity(a, 1)).toBeCloseTo(0, 5);
		expect(getAnnotationOpacity(a, 1.5)).toBeCloseTo(0.5, 5);
		expect(getAnnotationOpacity(a, 2)).toBe(1);
		expect(getAnnotationOpacity(a, 3)).toBe(1);
	});

	it('linear ramp during fade-out (starts at full opacity at visibleUntil)', () => {
		const a: Annotation = { ...base, visibleUntil: 5, fadeOut: 2 };
		expect(getAnnotationOpacity(a, 4.99)).toBe(1);
		expect(getAnnotationOpacity(a, 5)).toBeCloseTo(1, 5);
		expect(getAnnotationOpacity(a, 6)).toBeCloseTo(0.5, 5);
		expect(getAnnotationOpacity(a, 7)).toBeCloseTo(0, 5);
		expect(getAnnotationOpacity(a, 7.01)).toBe(0);
	});

	it('handles fade-in + fade-out together', () => {
		const a: Annotation = {
			...base,
			visibleFrom: 2,
			visibleUntil: 5,
			fadeIn: 1,
			fadeOut: 1
		};
		expect(getAnnotationOpacity(a, 0.99)).toBe(0);
		expect(getAnnotationOpacity(a, 1.5)).toBeCloseTo(0.5, 5);
		expect(getAnnotationOpacity(a, 2.5)).toBe(1);
		expect(getAnnotationOpacity(a, 5.5)).toBeCloseTo(0.5, 5);
		expect(getAnnotationOpacity(a, 6.01)).toBe(0);
	});

	it('ignores fade-in when visibleFrom is undefined', () => {
		const a: Annotation = { ...base, fadeIn: 5, visibleUntil: 5 };
		expect(getAnnotationOpacity(a, 0)).toBe(1);
	});
});
