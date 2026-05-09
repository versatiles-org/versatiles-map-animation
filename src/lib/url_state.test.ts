import { describe, it, expect } from 'vitest';
import { decodeAnimation, encodeAnimation } from './url_state';
import { SCHEMA_VERSION, type Animation } from './types';

const example: Animation = {
	version: SCHEMA_VERSION,
	style: 'colorful',
	terrain: false,
	keyframes: [
		{ t: 0, lng: 0, lat: 30, zoom: 1.5, pitch: 0, bearing: 0, roll: 0 },
		{ t: 3, lng: 13.405, lat: 52.52, zoom: 9, pitch: 60, bearing: 30, roll: 0 },
		{ t: 6, lng: 13.405, lat: 52.52, zoom: 14, pitch: 70, bearing: 120, roll: 0 }
	],
	annotations: [],
	annotationScale: 1
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

	it('round-trips style and terrain', () => {
		const decoded = decodeAnimation(
			encodeAnimation({ ...example, style: 'satellite-overlay', terrain: true })
		);
		expect(decoded?.style).toBe('satellite-overlay');
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
					color: '#ff8800',
					label: 'Berlin'
				}
			]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations.length).toBe(1);
		const a = decoded!.annotations[0];
		expect(a.lng).toBeCloseTo(13.405, 4);
		expect(a.lat).toBeCloseTo(52.52, 4);
		expect(a.icon).toBe('symbol-marker');
		expect(a.color).toBe('#ff8800');
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
					color: '#00ff00',
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
			annotations: [{ lng: 10, lat: 50, icon: 'symbol-marker', color: '#aabbcc', label: 'A' }]
		};
		const many: Animation = {
			...example,
			annotations: [
				{ lng: 10, lat: 50, icon: 'symbol-marker', color: '#aabbcc', label: 'A' },
				{ lng: 11, lat: 51, icon: 'symbol-marker', color: '#aabbcc', label: 'A' },
				{ lng: 12, lat: 52, icon: 'symbol-marker', color: '#aabbcc', label: 'A' }
			]
		};
		const singleLen = encodeAnimation(single).length;
		const manyLen = encodeAnimation(many).length;
		// Three annotations should not cost three times one — only positions change.
		expect(manyLen).toBeLessThan(singleLen * 2);
	});

	it('legacy V1-encoded URLs still decode (with empty annotations)', () => {
		// Encode an animation without annotations — should still emit V1 tag —
		// then verify decode produces an empty annotations array.
		const noAnn: Animation = { ...example, annotations: [] };
		const encoded = encodeAnimation(noAnn);
		const decoded = decodeAnimation(encoded);
		expect(decoded?.annotations).toEqual([]);
	});

	it('accepts shorthand #rgb hex colour', () => {
		const anim: Animation = {
			...example,
			annotations: [{ lng: 0, lat: 0, icon: 'symbol-circle', color: '#fa0', label: '' }]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].color).toBe('#ffaa00');
	});

	it('does not emit V2 tag when annotations are empty', () => {
		// V1 is byte-for-byte stable for older share links — guard against
		// accidentally bumping every existing URL to a longer V2 encoding.
		const noAnn = encodeAnimation({ ...example, annotations: [] });
		const withAnn = encodeAnimation({
			...example,
			annotations: [{ lng: 0, lat: 0, icon: 'symbol-marker', color: '#ffffff', label: '' }]
		});
		expect(withAnn.length).toBeGreaterThan(noAnn.length);
	});

	it('round-trips unicode labels', () => {
		const anim: Animation = {
			...example,
			annotations: [{ lng: 0, lat: 0, icon: 'symbol-marker', color: '#ffffff', label: 'Köln 🦊' }]
		};
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(decoded?.annotations[0].label).toBe('Köln 🦊');
	});
});

describe('annotationScale (V3)', () => {
	const oneAnn: Animation = {
		...example,
		annotations: [{ lng: 0, lat: 0, icon: 'symbol-marker', color: '#ffffff', label: 'A' }]
	};

	it('default scale stays in V2 (no extra bytes for byte-stable share URLs)', () => {
		const v2 = encodeAnimation({ ...oneAnn, annotationScale: 1 });
		const v3 = encodeAnimation({ ...oneAnn, annotationScale: 1.5 });
		// V3 carries an extra annotationScale field, so it must be longer than V2.
		expect(v3.length).toBeGreaterThan(v2.length);
	});

	it('non-default scale switches to V3 and round-trips', () => {
		const decoded = decodeAnimation(encodeAnimation({ ...oneAnn, annotationScale: 1.75 }));
		expect(decoded?.annotationScale).toBeCloseTo(1.75, 2);
		expect(decoded?.annotations.length).toBe(1);
	});

	it('two-decimal scale precision is preserved', () => {
		const decoded = decodeAnimation(encodeAnimation({ ...oneAnn, annotationScale: 0.55 }));
		expect(decoded?.annotationScale).toBeCloseTo(0.55, 2);
	});

	it('V1 + V2 decode default scale 1', () => {
		// No annotations → V1 path; decoded animation gets default scale.
		const v1Decoded = decodeAnimation(encodeAnimation({ ...example, annotationScale: 1 }));
		expect(v1Decoded?.annotationScale).toBe(1);
		// Annotations + default scale → V2 path; decoded animation gets default scale.
		const v2Decoded = decodeAnimation(encodeAnimation({ ...oneAnn, annotationScale: 1 }));
		expect(v2Decoded?.annotationScale).toBe(1);
	});
});
