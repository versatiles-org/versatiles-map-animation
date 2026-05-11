import { describe, it, expect } from 'vitest';
import { validateAnimation } from './json_io';
import { DEFAULT_ANNOTATION_SCALE, DEFAULT_LABELS, DEFAULT_SKY, DEFAULT_TERRAIN } from './types';

const minimalAnim = {
	version: 1,
	style: 'colorful',
	labels: true,
	terrain: false,
	sky: false,
	keyframes: [{ t: 0, lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0 }],
	annotations: [],
	annotationScale: 1
};

describe('validateAnimation - happy path', () => {
	it('accepts a minimal animation', () => {
		const a = validateAnimation(minimalAnim);
		expect(a.style).toBe('colorful');
		expect(a.keyframes).toHaveLength(1);
		expect(a.annotations).toEqual([]);
	});

	it('preserves all keyframe fields', () => {
		const a = validateAnimation({
			...minimalAnim,
			keyframes: [
				{
					t: 1.5,
					lng: 10.2,
					lat: -3.4,
					zoom: 8.1,
					pitch: 60,
					bearing: 90,
					roll: 5,
					path: 'linear'
				}
			]
		});
		expect(a.keyframes[0]).toEqual({
			t: 1.5,
			lng: 10.2,
			lat: -3.4,
			zoom: 8.1,
			pitch: 60,
			bearing: 90,
			roll: 5,
			path: 'linear'
		});
	});

	it('drops invalid path values silently (not in PathStyle enum)', () => {
		const a = validateAnimation({
			...minimalAnim,
			keyframes: [{ t: 0, lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0, path: 'nope' }]
		});
		expect(a.keyframes[0]).not.toHaveProperty('path');
	});
});

describe('validateAnimation - missing/optional top-level fields', () => {
	it('falls back to defaults when style/labels/terrain/sky are absent', () => {
		const a = validateAnimation({
			version: 1,
			keyframes: [{ t: 0, lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0 }]
		});
		expect(a.labels).toBe(DEFAULT_LABELS);
		expect(a.terrain).toBe(DEFAULT_TERRAIN);
		expect(a.sky).toBe(DEFAULT_SKY);
	});

	it('falls back to default annotationScale when missing or invalid', () => {
		const a = validateAnimation({ ...minimalAnim, annotationScale: undefined });
		expect(a.annotationScale).toBe(DEFAULT_ANNOTATION_SCALE);
		const b = validateAnimation({ ...minimalAnim, annotationScale: 'big' });
		expect(b.annotationScale).toBe(DEFAULT_ANNOTATION_SCALE);
	});

	it('clamps annotationScale to a positive minimum', () => {
		const a = validateAnimation({ ...minimalAnim, annotationScale: 0.001 });
		expect(a.annotationScale).toBeGreaterThanOrEqual(0.01);
	});

	it('treats missing annotations as []', () => {
		const a = validateAnimation({ ...minimalAnim, annotations: undefined });
		expect(a.annotations).toEqual([]);
	});
});

describe('validateAnimation - error paths', () => {
	it('rejects non-objects', () => {
		expect(() => validateAnimation(null)).toThrow(/not an object/);
		expect(() => validateAnimation(42)).toThrow(/not an object/);
		expect(() => validateAnimation('string')).toThrow(/not an object/);
	});

	it('rejects missing version', () => {
		expect(() => validateAnimation({ ...minimalAnim, version: undefined })).toThrow(/version/);
		expect(() => validateAnimation({ ...minimalAnim, version: 'one' })).toThrow(/version/);
	});

	it('rejects newer schema versions', () => {
		expect(() => validateAnimation({ ...minimalAnim, version: 999 })).toThrow(/newer version/);
	});

	it('rejects when keyframes is missing or not an array', () => {
		expect(() => validateAnimation({ ...minimalAnim, keyframes: undefined })).toThrow(/keyframes/);
		expect(() => validateAnimation({ ...minimalAnim, keyframes: 'not an array' })).toThrow(
			/keyframes/
		);
	});

	it('rejects non-object keyframe entries', () => {
		expect(() => validateAnimation({ ...minimalAnim, keyframes: [null] })).toThrow(/Keyframe 0/);
		expect(() => validateAnimation({ ...minimalAnim, keyframes: [42] })).toThrow(/Keyframe 0/);
	});

	it('rejects keyframes missing required numeric fields', () => {
		expect(() =>
			validateAnimation({
				...minimalAnim,
				keyframes: [{ lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0 }] // no `t`
			})
		).toThrow(/Keyframe 0.*"t"/);
	});

	it('rejects keyframes with non-finite numeric fields', () => {
		expect(() =>
			validateAnimation({
				...minimalAnim,
				keyframes: [{ t: NaN, lng: 0, lat: 0, zoom: 4, pitch: 0, bearing: 0, roll: 0 }]
			})
		).toThrow(/Keyframe 0.*"t"/);
	});
});

describe('validateAnnotation (via validateAnimation)', () => {
	const minimalAnn = { lng: 1, lat: 2, icon: 'symbol-marker', iconColor: '#ff0000', label: 'Hi' };

	it('accepts a minimal annotation and preserves required fields', () => {
		const a = validateAnimation({ ...minimalAnim, annotations: [minimalAnn] });
		expect(a.annotations[0]).toMatchObject(minimalAnn);
	});

	it('accepts the legacy "color" key and maps it to iconColor', () => {
		const a = validateAnimation({
			...minimalAnim,
			annotations: [{ lng: 1, lat: 2, icon: 'symbol-marker', color: '#00ff00', label: 'X' }]
		});
		expect(a.annotations[0].iconColor).toBe('#00ff00');
	});

	it('leaves icon/iconColor undefined when missing — the renderer resolves them from defaultAnnotation', () => {
		// Regression: validateAnnotation used to bake in DEFAULT_ANNOTATION_ICON
		// and DEFAULT_ANNOTATION_COLOR for any annotation missing those fields.
		// That clobbered the per-animation `defaultAnnotation` so a JSON with
		// `defaultAnnotation.iconColor = '#ffffff'` would still render markers
		// red (the hardcoded baseline) instead of white.
		const a = validateAnimation({
			...minimalAnim,
			annotations: [{ lng: 1, lat: 2, label: 'just-position-and-label' }],
			defaultAnnotation: { iconColor: '#ffffff', icon: 'symbol-arrow1' }
		});
		expect(a.annotations[0]).not.toHaveProperty('icon');
		expect(a.annotations[0]).not.toHaveProperty('iconColor');
		// And the defaults survive validation so the renderer can fall back.
		expect(a.defaultAnnotation.icon).toBe('symbol-arrow1');
		expect(a.defaultAnnotation.iconColor).toBe('#ffffff');
	});

	it('drops invalid icon values silently (and lets defaultAnnotation take over)', () => {
		const a = validateAnimation({
			...minimalAnim,
			annotations: [{ ...minimalAnn, icon: 'mystery' }]
		});
		expect(a.annotations[0]).not.toHaveProperty('icon');
	});

	it('drops invalid iconColor types silently', () => {
		const a = validateAnimation({
			...minimalAnim,
			annotations: [{ lng: 1, lat: 2, label: 'X', iconColor: 12345 }]
		});
		expect(a.annotations[0]).not.toHaveProperty('iconColor');
	});

	it('preserves rotation/visibleFrom/visibleUntil when valid', () => {
		const a = validateAnimation({
			...minimalAnim,
			annotations: [{ ...minimalAnn, rotation: 45, visibleFrom: 1, visibleUntil: 5 }]
		});
		expect(a.annotations[0].rotation).toBe(45);
		expect(a.annotations[0].visibleFrom).toBe(1);
		expect(a.annotations[0].visibleUntil).toBe(5);
	});

	it('rejects annotations with non-finite numeric fields', () => {
		expect(() =>
			validateAnimation({
				...minimalAnim,
				annotations: [{ ...minimalAnn, lng: Infinity }]
			})
		).toThrow(/Annotation 0.*"lng"/);
	});

	it('rejects optional numeric fields with wrong type', () => {
		expect(() =>
			validateAnimation({
				...minimalAnim,
				annotations: [{ ...minimalAnn, fadeIn: 'soon' }]
			})
		).toThrow(/Annotation 0.*"fadeIn"/);
	});

	it('preserves halo overrides via FIELD_SPECS', () => {
		const a = validateAnimation({
			...minimalAnim,
			annotations: [
				{
					...minimalAnn,
					labelHaloColor: '#abcdef',
					labelHaloWidth: 2,
					iconHaloColor: '#123456',
					iconHaloWidth: 1.5
				}
			]
		});
		expect(a.annotations[0]).toMatchObject({
			labelHaloColor: '#abcdef',
			labelHaloWidth: 2,
			iconHaloColor: '#123456',
			iconHaloWidth: 1.5
		});
	});

	it('clamps halo widths at 0', () => {
		const a = validateAnimation({
			...minimalAnim,
			annotations: [{ ...minimalAnn, labelHaloWidth: -3 }]
		});
		expect(a.annotations[0].labelHaloWidth).toBe(0);
	});

	it('preserves valid labelPosition and rejects unknown values', () => {
		const a = validateAnimation({
			...minimalAnim,
			annotations: [{ ...minimalAnn, labelPosition: 'left' }]
		});
		expect(a.annotations[0].labelPosition).toBe('left');
		const b = validateAnimation({
			...minimalAnim,
			annotations: [{ ...minimalAnn, labelPosition: 'oblique' }]
		});
		expect(b.annotations[0].labelPosition).toBeUndefined();
	});

	it('rejects non-object annotation entries', () => {
		expect(() => validateAnimation({ ...minimalAnim, annotations: [null] })).toThrow(
			/Annotation 0/
		);
	});
});

describe('validateAnimation - defaultAnnotation round-trip', () => {
	it('preserves every AnnotationStyle field through the validator', () => {
		const a = validateAnimation({
			...minimalAnim,
			defaultAnnotation: {
				icon: 'symbol-star',
				iconColor: '#ff8800',
				iconSize: 1.7,
				iconHaloColor: '#222222',
				iconHaloWidth: 0.5,
				labelColor: '#003366',
				labelSize: 1.3,
				labelPosition: 'right',
				labelDistance: 2.1,
				labelFont: 'roboto_bold_italic',
				labelHaloColor: '#ffffff',
				labelHaloWidth: 1.5
			}
		});
		expect(a.defaultAnnotation).toEqual({
			icon: 'symbol-star',
			iconColor: '#ff8800',
			iconSize: 1.7,
			iconHaloColor: '#222222',
			iconHaloWidth: 0.5,
			labelColor: '#003366',
			labelSize: 1.3,
			labelPosition: 'right',
			labelDistance: 2.1,
			labelFont: 'roboto_bold_italic',
			labelHaloColor: '#ffffff',
			labelHaloWidth: 1.5
		});
	});

	it('treats a missing defaultAnnotation block as empty', () => {
		const a = validateAnimation(minimalAnim);
		expect(a.defaultAnnotation).toEqual({});
	});

	it('accepts the legacy "color" key inside defaultAnnotation and maps it to iconColor', () => {
		const a = validateAnimation({
			...minimalAnim,
			defaultAnnotation: { color: '#00ff00' }
		});
		expect(a.defaultAnnotation.iconColor).toBe('#00ff00');
	});

	it('drops invalid icon / labelPosition values silently (matches per-annotation behaviour)', () => {
		const a = validateAnimation({
			...minimalAnim,
			defaultAnnotation: { icon: 'mystery', labelPosition: 'oblique' }
		});
		expect(a.defaultAnnotation).not.toHaveProperty('icon');
		expect(a.defaultAnnotation).not.toHaveProperty('labelPosition');
	});

	it('drops invalid font names silently', () => {
		const a = validateAnimation({
			...minimalAnim,
			defaultAnnotation: { labelFont: 'comic_sans_ms' }
		});
		expect(a.defaultAnnotation).not.toHaveProperty('labelFont');
	});

	it('strips non-AnnotationStyle fields (visibility/timing fields, rotation, label text)', () => {
		// `defaultAnnotation` is a per-animation STYLE template — visibility
		// windows, fade timings, label text, and rotation don't belong in it.
		// The validator should drop them even if a malformed file includes them.
		const a = validateAnimation({
			...minimalAnim,
			defaultAnnotation: {
				labelFont: 'roboto_bold',
				visibleFrom: 2,
				visibleUntil: 8,
				fadeIn: 1,
				fadeOut: 1,
				rotation: 45,
				label: 'should-not-survive',
				lng: 99,
				lat: 99
			}
		});
		// The legitimate style field survives:
		expect(a.defaultAnnotation.labelFont).toBe('roboto_bold');
		// Everything else is dropped:
		for (const key of [
			'visibleFrom',
			'visibleUntil',
			'fadeIn',
			'fadeOut',
			'rotation',
			'label',
			'lng',
			'lat'
		]) {
			expect(a.defaultAnnotation, `defaultAnnotation should not carry "${key}"`).not.toHaveProperty(
				key
			);
		}
	});
});
