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
	]
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

	it('falls back to defaults for unknown style', () => {
		const decoded = decodeAnimation(encodeAnimation({ ...example, style: 'eclipse' as never }));
		expect(decoded?.style).toBe('colorful');
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
