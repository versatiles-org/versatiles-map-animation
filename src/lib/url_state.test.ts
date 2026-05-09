import { describe, it, expect } from 'vitest';
import { decodeAnimation, encodeAnimation, fromCompact, toCompact } from './url_state';
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
	annotations: []
};

describe('toCompact', () => {
	it('omits fields equal to defaults on the first keyframe', () => {
		const c = toCompact(example);
		// kf0 has lng=0, pitch=0, bearing=0, roll=0, t=0 — all defaults.
		// lat=30 and zoom=1.5 should remain.
		expect(c.keyframes[0]).toEqual({ lat: 30, zoom: 1.5 });
	});

	it('omits fields that match the previous keyframe', () => {
		const c = toCompact(example);
		// kf2 inherits lng/lat from kf1, and roll from kf0/kf1 (all 0).
		expect(c.keyframes[2]).toEqual({ t: 6, zoom: 14, pitch: 70, bearing: 120 });
	});

	it('omits style when it equals the default ("colorful")', () => {
		const c = toCompact(example);
		expect(c.style).toBeUndefined();
	});

	it('keeps style when it differs from the default', () => {
		const c = toCompact({ ...example, style: 'satellite' });
		expect(c.style).toBe('satellite');
	});

	it('omits terrain when it equals the default (false)', () => {
		const c = toCompact(example);
		expect(c.terrain).toBeUndefined();
	});

	it('keeps terrain when enabled', () => {
		const c = toCompact({ ...example, terrain: true });
		expect(c.terrain).toBe(true);
	});
});

describe('fromCompact', () => {
	it('carries fields forward from the previous keyframe', () => {
		const restored = fromCompact({
			version: SCHEMA_VERSION,
			keyframes: [
				{ t: 0, lng: 13.4, lat: 52.5, zoom: 10, pitch: 60 },
				{ t: 3, zoom: 14 } // inherits lng, lat, pitch from kf0
			]
		});
		expect(restored.keyframes[1]).toEqual({
			t: 3,
			lng: 13.4,
			lat: 52.5,
			zoom: 14,
			pitch: 60,
			bearing: 0,
			roll: 0
		});
	});

	it('uses 0 for fields missing from the first keyframe', () => {
		const restored = fromCompact({
			version: SCHEMA_VERSION,
			keyframes: [{ lng: 13.4, lat: 52.5, zoom: 10 }]
		});
		expect(restored.keyframes[0]).toEqual({
			t: 0,
			lng: 13.4,
			lat: 52.5,
			zoom: 10,
			pitch: 0,
			bearing: 0,
			roll: 0
		});
	});

	it('throws on invalid field type', () => {
		expect(() =>
			fromCompact({
				version: SCHEMA_VERSION,
				keyframes: [{ t: 'not a number', lng: 0, lat: 0, zoom: 0 }]
			})
		).toThrow(/invalid "t"/);
	});

	it('throws on missing version', () => {
		expect(() => fromCompact({ keyframes: [] })).toThrow(/version/);
	});

	it('rejects future schema versions', () => {
		expect(() => fromCompact({ version: SCHEMA_VERSION + 1, keyframes: [] })).toThrow(/newer/);
	});
});

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

	it('decodes legacy JSON-base64 hashes (backward compatibility)', () => {
		// What a hash from before the binary codec existed looks like.
		const legacyJson = JSON.stringify({
			version: 1,
			style: 'satellite',
			terrain: true,
			keyframes: [
				{ t: 0, lng: 12.3, lat: 50.6, zoom: 4, pitch: 0, bearing: 0, roll: 0 },
				{ t: 3, lng: 7.1, lat: 46.1, zoom: 12.9, pitch: 0, bearing: 0, roll: 0 }
			]
		});
		const legacyB64 = btoa(legacyJson)
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replaceAll('=', '');
		const decoded = decodeAnimation(legacyB64);
		expect(decoded?.style).toBe('satellite');
		expect(decoded?.terrain).toBe(true);
		expect(decoded?.keyframes.length).toBe(2);
		expect(decoded?.keyframes[1].lng).toBeCloseTo(7.1, 5);
	});

	it('falls back to defaults for unknown style in legacy JSON form', () => {
		// Build a legacy JSON+base64 hash with an unknown style and verify the
		// decoder reads it as the default. New encodes are binary and reject
		// unknown enums at encode time; this only exercises the fallback path.
		const legacyJson = JSON.stringify({ version: 1, style: 'eclipse', keyframes: [] });
		const legacyB64 = btoa(legacyJson)
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replaceAll('=', '');
		expect(decodeAnimation(legacyB64)?.style).toBe('colorful');
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

	it('compacted form is shorter than naive form', () => {
		const compactJson = JSON.stringify(toCompact(example));
		const naiveJson = JSON.stringify(example);
		expect(compactJson.length).toBeLessThan(naiveJson.length * 0.7);
	});

	it('returns null on invalid base64', () => {
		expect(decodeAnimation('!!!not-valid!!!')).toBeNull();
	});

	it('returns null on valid base64 but invalid JSON', () => {
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
