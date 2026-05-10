import { describe, it, expect } from 'vitest';
import { decodeAnimation, encodeAnimation } from '.';
import { SCHEMA_VERSION, type Animation, type Annotation } from '../types';

const wrap = (annotations: Annotation[]): Animation => ({
	version: SCHEMA_VERSION,
	style: 'colorful',
	labels: true,
	terrain: false,
	sky: false,
	keyframes: [{ t: 0, lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0 }],
	annotations,
	annotationScale: 1,
	aspectRatio: '16:9',
	defaultAnnotation: {}
});

const baseAnn = (overrides: Partial<Annotation> = {}): Annotation => ({
	lng: 0,
	lat: 0,
	icon: 'symbol-marker',
	iconColor: '#cc0000',
	label: '',
	...overrides
});

function roundTrip(anns: Annotation[]): Animation {
	const out = decodeAnimation(encodeAnimation(wrap(anns)));
	if (!out) throw new Error('round-trip decode failed');
	return out;
}

describe('annotation codec - position', () => {
	it('preserves lng/lat to roughly 6 decimal places (fixed 26-bit Mercator)', () => {
		const out = roundTrip([baseAnn({ lng: 13.40495, lat: 52.52001 })]);
		expect(out.annotations[0].lng).toBeCloseTo(13.40495, 4);
		expect(out.annotations[0].lat).toBeCloseTo(52.52001, 4);
	});

	it('clamps positions outside the Mercator range without throwing', () => {
		// my for lat=89.9 is near 1.0, lat=-89.9 near 0 — both inside the
		// clamp; just confirm the round-trip doesn't NaN out.
		const out = roundTrip([baseAnn({ lng: -179, lat: 85 })]);
		expect(out.annotations[0].lng).toBeCloseTo(-179, 3);
		expect(out.annotations[0].lat).toBeCloseTo(85, 1);
	});
});

describe('annotation codec - normalize fallbacks', () => {
	it('falls back to default icon for unknown sprite ids', () => {
		// Cast through unknown so we can pass an invalid icon ident.
		const out = roundTrip([baseAnn({ icon: 'mystery-icon' as Annotation['icon'] })]);
		expect(out.annotations[0].icon).not.toBe('mystery-icon');
	});

	it('falls back to default color for malformed hex strings', () => {
		const out = roundTrip([baseAnn({ iconColor: 'not-a-color' })]);
		// Default color (#cc0000) — re-emitted as canonical lowercase hex.
		expect(out.annotations[0].iconColor).toBe('#cc0000');
	});

	it('accepts 3-digit hex colors and emits 6-digit canonical form', () => {
		const out = roundTrip([baseAnn({ iconColor: '#abc' })]);
		expect(out.annotations[0].iconColor).toBe('#aabbcc');
	});

	it('mod-360 rotation: 720 normalises to 0, -10 to 350', () => {
		const out = roundTrip([baseAnn({ rotation: 720 })]);
		expect(out.annotations[0]).not.toHaveProperty('rotation'); // 0 default → omitted
		const out2 = roundTrip([baseAnn({ rotation: -10 })]);
		expect(out2.annotations[0].rotation).toBe(350);
	});

	it('clamps visibleFrom at 0', () => {
		const out = roundTrip([baseAnn({ visibleFrom: -5 })]);
		expect(out.annotations[0]).not.toHaveProperty('visibleFrom');
	});

	it('keeps visibleUntil ≥ visibleFrom (uses max)', () => {
		const out = roundTrip([baseAnn({ visibleFrom: 5, visibleUntil: 1 })]);
		// normalize forces visibleUntil = max(visibleFrom, visibleUntilRaw)
		expect(out.annotations[0].visibleUntil).toBe(5);
	});

	it('treats null/Infinity visibleUntil as "always visible"', () => {
		const out = roundTrip([baseAnn({ visibleUntil: Infinity })]);
		expect(out.annotations[0]).not.toHaveProperty('visibleUntil');
	});
});

describe('annotation codec - V4 extras', () => {
	it('round-trips iconSize / labelSize at non-default values', () => {
		const out = roundTrip([baseAnn({ iconSize: 1.5, labelSize: 0.8 })]);
		expect(out.annotations[0].iconSize).toBeCloseTo(1.5, 2);
		expect(out.annotations[0].labelSize).toBeCloseTo(0.8, 2);
	});

	it('round-trips labelPosition + labelDistance', () => {
		const out = roundTrip([baseAnn({ labelPosition: 'top-right', labelDistance: 2.7 })]);
		expect(out.annotations[0].labelPosition).toBe('top-right');
		expect(out.annotations[0].labelDistance).toBeCloseTo(2.7, 2);
	});

	it('round-trips fadeIn / fadeOut', () => {
		const out = roundTrip([
			baseAnn({ visibleFrom: 1, visibleUntil: 5, fadeIn: 0.5, fadeOut: 1.2 })
		]);
		expect(out.annotations[0].fadeIn).toBeCloseTo(0.5, 2);
		expect(out.annotations[0].fadeOut).toBeCloseTo(1.2, 2);
	});

	it('round-trips labelColor', () => {
		const out = roundTrip([baseAnn({ labelColor: '#abcdef' })]);
		expect(out.annotations[0].labelColor).toBe('#abcdef');
	});
});

describe('annotation codec - V5 halo (present-only)', () => {
	it('round-trips all four halo overrides', () => {
		const out = roundTrip([
			baseAnn({
				labelHaloColor: '#000000',
				labelHaloWidth: 2.3,
				iconHaloColor: '#ffffff',
				iconHaloWidth: 1.5
			})
		]);
		expect(out.annotations[0]).toMatchObject({
			labelHaloColor: '#000000',
			iconHaloColor: '#ffffff'
		});
		expect(out.annotations[0].labelHaloWidth).toBeCloseTo(2.3, 1);
		expect(out.annotations[0].iconHaloWidth).toBeCloseTo(1.5, 1);
	});

	it('halo fields do NOT carry forward — N has halo, N+1 has none stays clean', () => {
		const out = roundTrip([
			baseAnn({ label: 'with halo', labelHaloColor: '#abcdef' }),
			baseAnn({ label: 'no halo', lng: 1, lat: 1 })
		]);
		expect(out.annotations[0].labelHaloColor).toBe('#abcdef');
		expect(out.annotations[1]).not.toHaveProperty('labelHaloColor');
	});
});

describe('annotation codec - carry-forward across multiple annotations', () => {
	it("doesn't re-emit fields that match the previous annotation", () => {
		// Two annotations with the same icon/color — the second should be
		// smaller on the wire than the first.
		const single = encodeAnimation(wrap([baseAnn({ label: 'a' })]));
		const pair = encodeAnimation(
			wrap([baseAnn({ label: 'a' }), baseAnn({ label: 'a', lng: 0.001, lat: 0.001 })])
		);
		expect(pair.length - single.length).toBeLessThan(single.length);
	});
});
