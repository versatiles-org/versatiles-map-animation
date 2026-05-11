import { describe, it, expect } from 'vitest';
import { decodeAnimation, encodeAnimation } from '.';
import { ASPECT_RATIOS, SCHEMA_VERSION, type Animation } from '../types';

const example: Animation = {
	version: SCHEMA_VERSION,
	style: 'colorful',
	labels: true,
	terrain: false,
	sky: false,
	keyframes: [
		{ t: 0, lng: 0, lat: 30, zoom: 1.5, pitch: 0, bearing: 0, roll: 0 },
		{ t: 3, lng: 13.405, lat: 52.52, zoom: 9, pitch: 60, bearing: 30, roll: 0 },
		{ t: 6, lng: 13.405, lat: 52.52, zoom: 14, pitch: 70, bearing: 120, roll: 0 }
	],
	annotations: [],
	annotationScale: 1,
	aspectRatio: '16:9',
	defaultAnnotation: {}
};

describe('encode/decode round-trip', () => {
	it('round-trips the full animation', () => {
		const encoded = encodeAnimation(example);
		const decoded = decodeAnimation(encoded);
		expect(decoded).not.toBeNull();
		expect(decoded?.keyframes.length).toBe(3);
		expect(decoded?.style).toBe('colorful');
		expect(decoded?.terrain).toBe(false);
		expect(decoded?.keyframes[2].lng).toBeCloseTo(13.405, 5);
		expect(decoded?.keyframes[2].lat).toBeCloseTo(52.52, 5);
	});

	it('round-trips style, labels, and terrain', () => {
		const decoded = decodeAnimation(
			encodeAnimation({ ...example, style: 'satellite', labels: false, terrain: true })
		);
		expect(decoded?.style).toBe('satellite');
		expect(decoded?.labels).toBe(false);
		expect(decoded?.terrain).toBe(true);
	});

	it('round-trips per-keyframe path', () => {
		const anim = {
			...example,
			keyframes: [
				{ ...example.keyframes[0] },
				{ ...example.keyframes[1], path: 'linear' as const },
				{ ...example.keyframes[2], path: 'linear' as const }
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		// Default 'arc' on kf0 is omitted from the wire and reconstructed as undefined.
		expect(decoded?.keyframes[0].path).toBeUndefined();
		expect(decoded?.keyframes[1].path).toBe('linear');
		// Carry-forward: kf2 had path='linear' explicitly; the encoder omitted
		// the field because it matched kf1, and the decoder inherits it.
		expect(decoded?.keyframes[2].path).toBe('linear');
	});

	it('explicit revert to arc on a later keyframe is preserved', () => {
		const anim = {
			...example,
			keyframes: [
				{ ...example.keyframes[0] },
				{ ...example.keyframes[1], path: 'linear' as const },
				{ ...example.keyframes[2] } // path undefined (= arc), overriding the prior linear
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.keyframes[1].path).toBe('linear');
		expect(decoded?.keyframes[2].path).toBeUndefined();
	});

	it('produces URL-safe characters only', () => {
		expect(encodeAnimation(example)).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('returns null on invalid base64', () => {
		expect(decodeAnimation('!!!not-valid!!!')).toBeNull();
	});

	it('returns null on an unknown format tag', () => {
		// 'bm90IGpzb24' decodes to "not json" — first byte 'n' = 0x6E, no codec.
		expect(decodeAnimation('bm90IGpzb24')).toBeNull();
	});
});

describe('annotations round-trip', () => {
	it('round-trips a simple marker', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{
					lng: 13.405,
					lat: 52.52,
					icon: 'symbol-marker',
					iconColor: '#ff8800',
					label: 'Berlin'
				}
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations.length).toBe(1);
		const a = decoded!.annotations[0];
		expect(a.lng).toBeCloseTo(13.405, 4);
		expect(a.lat).toBeCloseTo(52.52, 4);
		// `icon` was 'symbol-marker' = the hardcoded baseline, so it's omitted
		// from the decoded annotation — the renderer's `resolveAnnotation`
		// fills it back from `ANNOTATION_FIELD_DEFAULTS` (= 'symbol-marker').
		expect(a).not.toHaveProperty('icon');
		expect(a.iconColor).toBe('#ff8800');
		expect(a.label).toBe('Berlin');
		// Optional fields default to undefined when they match defaults.
		expect(a.rotation).toBeUndefined();
		expect(a.visibleFrom).toBeUndefined();
		expect(a.visibleUntil).toBeUndefined();
	});

	it('round-trips rotation and visibility window', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{
					lng: 7.1,
					lat: 46.1,
					icon: 'symbol-arrow',
					iconColor: '#00ff00',
					label: 'Bern',
					rotation: 90,
					visibleFrom: 1.5,
					visibleUntil: 4.25
				}
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		const a = decoded!.annotations[0];
		expect(a.rotation).toBeCloseTo(90, 0);
		expect(a.visibleFrom).toBeCloseTo(1.5, 3);
		expect(a.visibleUntil).toBeCloseTo(4.25, 3);
	});

	it('carry-forward shrinks repeated icon/color/label across annotations', () => {
		const single: Animation = {
			...example,
			annotations: [{ lng: 10, lat: 50, icon: 'symbol-marker', iconColor: '#aabbcc', label: 'A' }]
		};
		const many: Animation = {
			...example,
			annotations: [
				{ lng: 10, lat: 50, icon: 'symbol-marker', iconColor: '#aabbcc', label: 'A' },
				{ lng: 11, lat: 51, icon: 'symbol-marker', iconColor: '#aabbcc', label: 'A' },
				{ lng: 12, lat: 52, icon: 'symbol-marker', iconColor: '#aabbcc', label: 'A' }
			]
		};
		const singleLen = encodeAnimation(single).length;
		const manyLen = encodeAnimation(many).length;
		// Three annotations should not cost three times one — only positions change.
		expect(manyLen).toBeLessThan(singleLen * 2);
	});

	it('empty annotations decode to []', () => {
		const noAnn: Animation = { ...example, annotations: [] };
		const decoded = decodeAnimation(encodeAnimation(noAnn));
		expect(decoded?.annotations).toEqual([]);
	});

	it('accepts shorthand #rgb hex colour', () => {
		const anim: Animation = {
			...example,
			annotations: [{ lng: 0, lat: 0, icon: 'symbol-circle', iconColor: '#fa0', label: '' }]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].iconColor).toBe('#ffaa00');
	});

	it('round-trips unicode labels', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{ lng: 0, lat: 0, icon: 'symbol-marker', iconColor: '#ffffff', label: 'Köln 🦊' }
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].label).toBe('Köln 🦊');
	});
});

describe('annotationScale option', () => {
	const oneAnn: Animation = {
		...example,
		annotations: [{ lng: 0, lat: 0, icon: 'symbol-marker', iconColor: '#ffffff', label: 'A' }]
	};

	it('default scale (1) costs no extra bytes via the options mask', () => {
		// shouldEmit returns false when annotationScale === 1, so the option is
		// not encoded — the mask bit stays 0 and the field is omitted.
		const at1 = encodeAnimation({ ...oneAnn, annotationScale: 1 });
		const at1_5 = encodeAnimation({ ...oneAnn, annotationScale: 1.5 });
		expect(at1_5.length).toBeGreaterThan(at1.length);
	});

	it('non-default scale round-trips at 2-decimal precision', () => {
		const decoded = decodeAnimation(encodeAnimation({ ...oneAnn, annotationScale: 1.75 }));
		expect(decoded?.annotationScale).toBeCloseTo(1.75, 2);
		expect(decoded?.annotations.length).toBe(1);
	});

	it('default scale decodes back to 1', () => {
		const decoded = decodeAnimation(encodeAnimation({ ...example, annotationScale: 1 }));
		expect(decoded?.annotationScale).toBe(1);
	});
});

describe('per-annotation extras', () => {
	const ann = (extra: Partial<{ iconSize: number; labelSize: number }> = {}): Animation => ({
		...example,
		annotations: [
			{ lng: 0, lat: 0, icon: 'symbol-marker', iconColor: '#ffffff', label: 'A', ...extra }
		]
	});

	it('default sizes cost nothing extra', () => {
		const defaults = encodeAnimation(ann());
		const withSize = encodeAnimation(ann({ iconSize: 1.5 }));
		expect(withSize.length).toBeGreaterThan(defaults.length);
	});

	it('iconSize / labelSize round-trip', () => {
		const decoded = decodeAnimation(encodeAnimation(ann({ iconSize: 2, labelSize: 0.5 })));
		expect(decoded?.annotations[0].iconSize).toBeCloseTo(2, 2);
		expect(decoded?.annotations[0].labelSize).toBeCloseTo(0.5, 2);
	});

	it('annotationScale + iconSize combine correctly', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{ lng: 0, lat: 0, icon: 'symbol-marker', iconColor: '#fff', label: 'A', iconSize: 1.5 }
			],
			annotationScale: 1.25
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotationScale).toBeCloseTo(1.25, 2);
		expect(decoded?.annotations[0].iconSize).toBeCloseTo(1.5, 2);
	});

	it('halo overrides round-trip', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{
					lng: 0,
					lat: 0,
					icon: 'symbol-marker',
					iconColor: '#fff',
					label: 'H',
					labelHaloColor: '#ff0000',
					labelHaloWidth: 2.5,
					iconHaloColor: '#00ff00',
					iconHaloWidth: 1.2
				}
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		const a = decoded?.annotations[0];
		expect(a?.labelHaloColor).toBe('#ff0000');
		expect(a?.labelHaloWidth).toBeCloseTo(2.5, 1);
		expect(a?.iconHaloColor).toBe('#00ff00');
		expect(a?.iconHaloWidth).toBeCloseTo(1.2, 1);
	});

	it('halo override is present-only (does not carry forward)', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{
					lng: 0,
					lat: 0,
					icon: 'symbol-marker',
					iconColor: '#fff',
					label: 'A',
					labelHaloColor: '#f00'
				},
				{ lng: 1, lat: 1, icon: 'symbol-marker', iconColor: '#fff', label: 'B' }
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].labelHaloColor).toBe('#ff0000');
		expect(decoded?.annotations[1].labelHaloColor).toBeUndefined();
	});

	it('non-default labelColor / labelDistance / labelPosition round-trip', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{
					lng: 0,
					lat: 0,
					icon: 'symbol-marker',
					iconColor: '#fff',
					label: 'A',
					labelColor: '#ff0080',
					labelDistance: 2.7,
					labelPosition: 'right'
				}
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].labelColor).toBe('#ff0080');
		expect(decoded?.annotations[0].labelDistance).toBeCloseTo(2.7, 2);
		expect(decoded?.annotations[0].labelPosition).toBe('right');
	});

	it('explicit default labelPosition (bottom) costs nothing extra', () => {
		const noPos = encodeAnimation(ann());
		const explicitDefault = encodeAnimation({
			...example,
			annotations: [
				{
					lng: 0,
					lat: 0,
					icon: 'symbol-marker',
					iconColor: '#fff',
					label: 'A',
					labelPosition: 'bottom'
				}
			]
		});
		expect(explicitDefault.length).toBe(noPos.length);
	});

	it('labelFont round-trips and survives carry-forward', () => {
		const anim: Animation = {
			...example,
			annotations: [
				{
					lng: 0,
					lat: 0,
					icon: 'symbol-marker',
					iconColor: '#fff',
					label: 'A',
					labelFont: 'roboto_bold_italic'
				},
				// Same font on the next annotation: carry-forward should mean it's
				// not re-emitted (the encoded bytes barely grow).
				{
					lng: 1,
					lat: 1,
					icon: 'symbol-marker',
					iconColor: '#fff',
					label: 'B',
					labelFont: 'roboto_bold_italic'
				}
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].labelFont).toBe('roboto_bold_italic');
		expect(decoded?.annotations[1].labelFont).toBe('roboto_bold_italic');
	});

	it('default labelFont (noto_sans_bold) is omitted from the decoded annotation', () => {
		const anim: Animation = {
			...example,
			annotations: [{ lng: 0, lat: 0, icon: 'symbol-marker', iconColor: '#fff', label: 'A' }]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].labelFont).toBeUndefined();
	});
});

describe('aspectRatio option', () => {
	// The aspectRatio option costs 3 bits when present (7-value enum). At base64
	// granularity that often falls within an already-padded byte, so we don't
	// assert on encoded length here — just on round-trip.
	for (const ar of ASPECT_RATIOS) {
		it(`round-trips ${ar}`, () => {
			const decoded = decodeAnimation(encodeAnimation({ ...example, aspectRatio: ar }));
			expect(decoded?.aspectRatio).toBe(ar);
		});
	}

	it('default 16:9 decodes back even when omitted from the wire', () => {
		const decoded = decodeAnimation(encodeAnimation({ ...example, aspectRatio: '16:9' }));
		expect(decoded?.aspectRatio).toBe('16:9');
	});
});

describe('defaultAnnotation option', () => {
	it('round-trips every AnnotationStyle field', () => {
		const defaultAnnotation = {
			icon: 'symbol-star' as const,
			iconColor: '#ff8800',
			iconSize: 1.7,
			iconHaloColor: '#222222',
			iconHaloWidth: 0.5,
			labelColor: '#003366',
			labelSize: 1.3,
			labelPosition: 'right' as const,
			labelDistance: 2.1,
			labelFont: 'roboto_bold_italic' as const,
			labelHaloColor: '#ffffff',
			labelHaloWidth: 1.5
		};
		const decoded = decodeAnimation(encodeAnimation({ ...example, defaultAnnotation }));
		expect(decoded?.defaultAnnotation).toEqual(defaultAnnotation);
	});

	it('round-trips a partial defaultAnnotation (just the fields the user set)', () => {
		const decoded = decodeAnimation(
			encodeAnimation({
				...example,
				defaultAnnotation: { labelFont: 'lato_bold', labelHaloWidth: 2 }
			})
		);
		expect(decoded?.defaultAnnotation).toEqual({
			labelFont: 'lato_bold',
			labelHaloWidth: 2
		});
	});

	it('empty defaultAnnotation roundtrips as empty (option-mask bit not set)', () => {
		const decoded = decodeAnimation(encodeAnimation({ ...example, defaultAnnotation: {} }));
		expect(decoded?.defaultAnnotation).toEqual({});
	});

	it('omitting defaultAnnotation decodes back to empty (backwards-compatible)', () => {
		// Animations encoded before the defaultAnnotation feature shipped just
		// lack the option-mask bit; the decoder still has to produce `{}`.
		const decoded = decodeAnimation(encodeAnimation(example));
		expect(decoded?.defaultAnnotation).toEqual({});
	});

	it('per-annotation overrides still win over defaultAnnotation after round-trip', () => {
		// The renderer's `resolveAnnotation` does the merge; here we just
		// confirm both layers come back intact.
		const decoded = decodeAnimation(
			encodeAnimation({
				...example,
				annotations: [
					{
						lng: 1,
						lat: 2,
						icon: 'symbol-marker',
						iconColor: '#aabbcc',
						label: 'override'
					}
				],
				defaultAnnotation: { iconColor: '#ffffff' }
			})
		);
		expect(decoded?.annotations[0].iconColor).toBe('#aabbcc');
		expect(decoded?.defaultAnnotation.iconColor).toBe('#ffffff');
	});
});
