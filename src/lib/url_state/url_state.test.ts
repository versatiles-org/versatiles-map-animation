import { describe, it, expect } from 'vitest';
import { decodeAnimation, encodeAnimation } from '.';
import { base64UrlToBytes } from '../codec';
import {
	ASPECT_RATIOS,
	MAP_LAYER_GROUPS,
	MAP_PROJECTIONS,
	MAP_THEMES,
	PATH_STYLES,
	SCHEMA_VERSION,
	type Animation
} from '../types';

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

describe('format versions', () => {
	// Hashes written by the V1 encoder (tag 0x01), before V2 existed.
	const V1_FLAT = 'ARQQdjw4mITU_TcBxiYQAAA';
	const V1_FLAT_4_3 = 'ARQQdjw4mITU_TcBxiYQASA';
	const V1_ANNOTATED =
		'ARsh_gMZEhN5cto_FxU4_nxc8ElyItRDWKrf5vcNbkjCoYZkG3dzf8vMXZkjkdJxFvP-CAr6_CcKfrZ9wD2QAAKTW9udCBCbGFuY8bXp_1Dp-PDsgAACgAA';

	it('writes the V2 format tag', () => {
		expect(base64UrlToBytes(encodeAnimation(example))[0]).toBe(0x02);
	});

	it('still decodes V1 hashes', () => {
		const flat = decodeAnimation(V1_FLAT);
		expect(flat?.keyframes.length).toBe(2);
		expect(flat?.aspectRatio).toBe('16:9');
		expect(decodeAnimation(V1_FLAT_4_3)?.aspectRatio).toBe('4:3');

		const annotated = decodeAnimation(V1_ANNOTATED);
		expect(annotated?.keyframes.length).toBe(4);
		expect(annotated?.annotations.length).toBe(1);
	});

	it('re-encodes a V1 hash as V2 without changing the animation', () => {
		for (const hash of [V1_FLAT, V1_FLAT_4_3, V1_ANNOTATED]) {
			const fromV1 = decodeAnimation(hash)!;
			const reencoded = encodeAnimation(fromV1);
			expect(base64UrlToBytes(hash)[0]).toBe(0x01);
			expect(base64UrlToBytes(reencoded)[0]).toBe(0x02);
			expect(decodeAnimation(reencoded)).toEqual(fromV1);
		}
	});

	it('keeps the linear path of a V1 keyframe', () => {
		// V1 stores `path` in 1 bit, V2 in 2 — the value must survive both.
		const withPath: Animation = {
			...example,
			keyframes: example.keyframes.map((kf, i) => (i === 0 ? { ...kf, path: 'linear' } : kf))
		};
		const decoded = decodeAnimation(encodeAnimation(withPath));
		expect(decoded?.keyframes[0].path).toBe('linear');
		expect(decoded?.keyframes[1].path).toBeUndefined();
	});

	it('rejects an unknown format tag', () => {
		expect(decodeAnimation('AxQQdjw4mITU_TcBxiYQAAA')).toBeNull();
	});
});

describe('theme option', () => {
	it('adds nothing to the payload while unset', () => {
		const decoded = decodeAnimation(encodeAnimation(example));
		expect(decoded).not.toBeNull();
		expect(decoded && 'theme' in decoded).toBe(false);
	});

	it('round-trips every theme', () => {
		for (const theme of MAP_THEMES) {
			expect(decodeAnimation(encodeAnimation({ ...example, theme }))?.theme).toBe(theme);
		}
	});

	it('keeps an explicit theme that equals the style default', () => {
		// `colorful` on satellite is a real choice (the default there is gray).
		const decoded = decodeAnimation(
			encodeAnimation({ ...example, style: 'satellite', theme: 'colorful' })
		);
		expect(decoded?.theme).toBe('colorful');
	});
});

describe('hiddenLayers option', () => {
	it('adds nothing to the payload while no group is hidden', () => {
		const plain = encodeAnimation(example);
		expect(encodeAnimation({ ...example, hiddenLayers: [] })).toBe(plain);
		expect(decodeAnimation(plain)).not.toHaveProperty('hiddenLayers');
	});

	it('round-trips every single group and all groups together', () => {
		for (const group of MAP_LAYER_GROUPS) {
			const decoded = decodeAnimation(encodeAnimation({ ...example, hiddenLayers: [group] }));
			expect(decoded?.hiddenLayers).toEqual([group]);
		}
		const all = decodeAnimation(
			encodeAnimation({ ...example, hiddenLayers: [...MAP_LAYER_GROUPS] })
		);
		expect(all?.hiddenLayers).toEqual([...MAP_LAYER_GROUPS]);
	});

	it('returns the groups in canonical order', () => {
		const decoded = decodeAnimation(
			encodeAnimation({ ...example, hiddenLayers: ['pois', 'land', 'roads'] })
		);
		expect(decoded?.hiddenLayers).toEqual(['land', 'roads', 'pois']);
	});

	it('combines with the theme option', () => {
		const decoded = decodeAnimation(
			encodeAnimation({ ...example, theme: 'toner', hiddenLayers: ['buildings'] })
		);
		expect(decoded?.theme).toBe('toner');
		expect(decoded?.hiddenLayers).toEqual(['buildings']);
	});
});

describe('buildings3d option', () => {
	it('costs no payload: on is one mask bit, off is nothing', () => {
		const plain = encodeAnimation(example);
		expect(encodeAnimation({ ...example, buildings3d: false })).toBe(plain);
		expect(encodeAnimation({ ...example, buildings3d: true }).length).toBe(plain.length);
		expect(decodeAnimation(plain)).not.toHaveProperty('buildings3d');
	});

	it('round-trips, also next to other options', () => {
		expect(decodeAnimation(encodeAnimation({ ...example, buildings3d: true }))?.buildings3d).toBe(
			true
		);
		const decoded = decodeAnimation(
			encodeAnimation({ ...example, buildings3d: true, theme: 'gray', hiddenLayers: ['pois'] })
		);
		expect(decoded?.buildings3d).toBe(true);
		expect(decoded?.theme).toBe('gray');
		expect(decoded?.hiddenLayers).toEqual(['pois']);
	});
});

describe('sun option', () => {
	it('costs two bytes when set and nothing when unset', () => {
		const plain = base64UrlToBytes(encodeAnimation(example));
		const lit = base64UrlToBytes(
			encodeAnimation({ ...example, sun: { direction: 0, altitude: 0 } })
		);
		expect(lit.length).toBe(plain.length + 2);
		expect(decodeAnimation(encodeAnimation(example))).not.toHaveProperty('sun');
	});

	it('round-trips the whole range, also next to other options', () => {
		for (const sun of [
			{ direction: 0, altitude: 0 },
			{ direction: 359, altitude: 90 },
			{ direction: 210, altitude: 60 }
		]) {
			expect(decodeAnimation(encodeAnimation({ ...example, sun }))?.sun).toEqual(sun);
		}
		const decoded = decodeAnimation(
			encodeAnimation({
				...example,
				sun: { direction: 135, altitude: 20 },
				buildings3d: true,
				theme: 'gray'
			})
		);
		expect(decoded?.sun).toEqual({ direction: 135, altitude: 20 });
		expect(decoded?.buildings3d).toBe(true);
		expect(decoded?.theme).toBe('gray');
	});

	it('stores whole degrees inside the valid ranges', () => {
		const decoded = decodeAnimation(
			encodeAnimation({ ...example, sun: { direction: -90.4, altitude: 120 } })
		);
		expect(decoded?.sun).toEqual({ direction: 270, altitude: 90 });
	});
});

describe('projection option', () => {
	it('costs nothing for Mercator and no extra byte for the globe', () => {
		const plain = encodeAnimation(example);
		expect(encodeAnimation({ ...example, projection: 'mercator' })).toBe(plain);
		expect(decodeAnimation(plain)).not.toHaveProperty('projection');
		const globe = encodeAnimation({ ...example, projection: 'globe' });
		expect(globe).not.toBe(plain);
		expect(base64UrlToBytes(globe).length).toBeLessThanOrEqual(base64UrlToBytes(plain).length + 1);
	});

	it('round-trips, also next to other options', () => {
		expect(decodeAnimation(encodeAnimation({ ...example, projection: 'globe' }))?.projection).toBe(
			'globe'
		);
		const decoded = decodeAnimation(
			encodeAnimation({
				...example,
				projection: 'globe',
				sun: { direction: 135, altitude: 20 },
				hiddenLayers: ['pois']
			})
		);
		expect(decoded?.projection).toBe('globe');
		expect(decoded?.sun).toEqual({ direction: 135, altitude: 20 });
		expect(decoded?.hiddenLayers).toEqual(['pois']);
	});

	it('stores the index into MAP_PROJECTIONS, so the list is append-only', () => {
		expect(MAP_PROJECTIONS).toEqual(['mercator', 'globe']);
	});
});

describe('anchor option', () => {
	it('costs nothing in the middle of the frame and two bytes elsewhere', () => {
		const plain = encodeAnimation(example);
		expect(encodeAnimation({ ...example, anchor: { x: 0.5, y: 0.5 } })).toBe(plain);
		expect(decodeAnimation(plain)).not.toHaveProperty('anchor');
		const moved = encodeAnimation({ ...example, anchor: { x: 0.25, y: 0.7 } });
		expect(base64UrlToBytes(moved).length).toBe(base64UrlToBytes(plain).length + 2);
	});

	it('round-trips the whole frame in whole percent', () => {
		for (const anchor of [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0.25, y: 0.7 },
			{ x: 0.5, y: 0.07 }
		]) {
			expect(decodeAnimation(encodeAnimation({ ...example, anchor }))?.anchor).toEqual(anchor);
		}
		expect(
			decodeAnimation(encodeAnimation({ ...example, anchor: { x: 0.333, y: 1.4 } }))?.anchor
		).toEqual({ x: 0.33, y: 1 });
	});

	it('round-trips next to other options', () => {
		const decoded = decodeAnimation(
			encodeAnimation({
				...example,
				anchor: { x: 0.25, y: 0.7 },
				projection: 'globe',
				aspectRatio: '1:1'
			})
		);
		expect(decoded?.anchor).toEqual({ x: 0.25, y: 0.7 });
		expect(decoded?.projection).toBe('globe');
		expect(decoded?.aspectRatio).toBe('1:1');
	});
});

describe('waypoints', () => {
	const flight = (waypoints: boolean[]): Animation => ({
		...example,
		keyframes: waypoints.map((waypoint, i) => ({
			t: i,
			lng: 10 + i,
			lat: 50,
			zoom: 8,
			pitch: 0,
			bearing: 0,
			roll: 0,
			...(waypoint && { waypoint })
		}))
	});

	it('cost nothing when every keyframe is a stop, and one bit per keyframe otherwise', () => {
		const stops = base64UrlToBytes(encodeAnimation(flight([false, false, false, false])));
		const mixed = base64UrlToBytes(encodeAnimation(flight([false, true, true, false])));
		expect(mixed.length).toBeLessThanOrEqual(stops.length + 1);
		for (const kf of decodeAnimation(encodeAnimation(flight([false, false])))!.keyframes) {
			expect(kf).not.toHaveProperty('waypoint');
		}
	});

	it('round-trip in any position, also first and last', () => {
		for (const flags of [
			[false, true, true, false],
			[true, false, false, true],
			[true, true, true, true],
			[false, true, false, true, false, true, false, true, false, true]
		]) {
			const decoded = decodeAnimation(encodeAnimation(flight(flags)));
			expect(decoded?.keyframes.map((k) => k.waypoint === true)).toEqual(flags);
		}
	});

	it('round-trip next to the travel style and other options', () => {
		const anim = flight([false, true, false]);
		anim.keyframes[2].path = 'linear';
		const decoded = decodeAnimation(encodeAnimation({ ...anim, projection: 'globe' }));
		expect(decoded?.keyframes.map((k) => k.waypoint === true)).toEqual([false, true, false]);
		expect(decoded?.keyframes[2].path).toBe('linear');
		expect(decoded?.projection).toBe('globe');
	});
});

describe('holds', () => {
	const flight = (holds: number[], waypoints: number[] = []): Animation => ({
		...example,
		keyframes: holds.map((hold, i) => ({
			t: i * 10,
			lng: 10 + i,
			lat: 50,
			zoom: 8,
			pitch: 0,
			bearing: 0,
			roll: 0,
			...(hold > 0 && { hold }),
			...(waypoints.includes(i) && { waypoint: true })
		}))
	});

	it('cost nothing when no stop holds', () => {
		const plain = flight([0, 0, 0]);
		const explicitZero = { ...plain, keyframes: plain.keyframes.map((k) => ({ ...k, hold: 0 })) };
		expect(encodeAnimation(explicitZero)).toBe(encodeAnimation(plain));
		expect(encodeAnimation(flight([0, 2, 0])).length).toBeGreaterThan(
			encodeAnimation(plain).length
		);
		for (const kf of decodeAnimation(encodeAnimation(flight([0, 0, 0])))!.keyframes) {
			expect(kf).not.toHaveProperty('hold');
		}
	});

	it('round-trip to the millisecond, in any position', () => {
		for (const holds of [
			[2, 0, 0],
			[0, 1.5, 0],
			[0, 0, 3.25],
			[0.01, 7.777, 120]
		]) {
			const decoded = decodeAnimation(encodeAnimation(flight(holds)));
			expect(decoded?.keyframes.map((k) => k.hold ?? 0)).toEqual(holds);
		}
	});

	it('round-trip next to waypoints, and never end up on one', () => {
		const decoded = decodeAnimation(encodeAnimation(flight([2, 5, 0, 1], [1])));
		expect(decoded?.keyframes.map((k) => k.hold ?? 0)).toEqual([2, 0, 0, 1]);
		expect(decoded?.keyframes.map((k) => k.waypoint === true)).toEqual([false, true, false, false]);
	});
});

describe('eases', () => {
	type Ease = [number | undefined, number | undefined];
	const flight = (eases: Ease[], waypoints: number[] = []): Animation => ({
		...example,
		keyframes: eases.map(([easeIn, easeOut], i) => ({
			t: i * 10,
			lng: 10 + i,
			lat: 50,
			zoom: 8,
			pitch: 0,
			bearing: 0,
			roll: 0,
			...(easeIn !== undefined && { easeIn }),
			...(easeOut !== undefined && { easeOut }),
			...(waypoints.includes(i) && { waypoint: true })
		}))
	});
	const none: Ease = [undefined, undefined];
	const easesOf = (anim: Animation | null) => anim?.keyframes.map((k) => [k.easeIn, k.easeOut]);

	it('cost nothing when no stop sets one', () => {
		const plain = encodeAnimation(flight([none, none, none]));
		expect(encodeAnimation({ ...example, keyframes: flight([none, none, none]).keyframes })).toBe(
			plain
		);
		expect(encodeAnimation(flight([none, [0.5, undefined], none])).length).toBeGreaterThan(
			plain.length
		);
		for (const kf of decodeAnimation(plain)!.keyframes) {
			expect(kf).not.toHaveProperty('easeIn');
			expect(kf).not.toHaveProperty('easeOut');
		}
	});

	it('round-trip to the percent, each side on its own, 0 included', () => {
		for (const eases of [
			[[undefined, 0], none, [1, undefined]],
			[none, [0.33, 0.65], none],
			[
				[0.05, 0.95],
				[0, 0],
				[1, 1]
			]
		] as Ease[][]) {
			expect(easesOf(decodeAnimation(encodeAnimation(flight(eases))))).toEqual(eases);
		}
		expect(easesOf(decodeAnimation(encodeAnimation(flight([[0.337, 2], none]))))).toEqual([
			[0.34, 1],
			none
		]);
	});

	it('round-trip next to waypoints and holds, and never end up on a waypoint', () => {
		const anim = flight(
			[
				[undefined, 0.2],
				[0.5, 0.5],
				[0.8, undefined]
			],
			[1]
		);
		anim.keyframes[2].hold = 2;
		const decoded = decodeAnimation(encodeAnimation(anim));
		expect(easesOf(decoded)).toEqual([[undefined, 0.2], none, [0.8, undefined]]);
		expect(decoded?.keyframes.map((k) => k.waypoint === true)).toEqual([false, true, false]);
		expect(decoded?.keyframes[2].hold).toBe(2);
	});
});

describe('legacy spline path', () => {
	// Links written while `spline` was a path style, four keyframes each.
	const ALL_SPLINE = 'AhQkdTA4mHYp_W49h0-_RLrmZhcRVP4afjw8y1ENueLHIAfwvcPKErqKcancNU1YAAAA';
	const FIRST_SPLINE = 'AhQkdTA4mHYp_W69h0-_RLrmZhcRVD-Gn48PMtRDbnixyAH8L3DyhK6inGp3DVNWAAAA';

	it('a keyframe between two spline segments becomes a waypoint', () => {
		const decoded = decodeAnimation(ALL_SPLINE);
		expect(decoded?.keyframes.map((k) => k.waypoint === true)).toEqual([false, true, true, false]);
		expect(decoded?.keyframes.every((k) => k.path === 'linear')).toBe(true);
	});

	it('a lone spline segment becomes a Stay-low move between two stops', () => {
		const decoded = decodeAnimation(FIRST_SPLINE);
		expect(decoded?.keyframes.map((k) => k.waypoint === true)).toEqual([
			false,
			false,
			false,
			false
		]);
		expect(decoded?.keyframes.map((k) => k.path ?? 'arc')).toEqual(['linear', 'arc', 'arc', 'arc']);
	});

	it('is never written again', () => {
		const reencoded = decodeAnimation(encodeAnimation(decodeAnimation(ALL_SPLINE)!));
		expect(reencoded).toEqual(decodeAnimation(ALL_SPLINE));
		expect(PATH_STYLES).toEqual(['arc', 'linear']);
	});
});
