import { describe, it, expect } from 'vitest';
import {
	BitReader,
	BitWriter,
	array,
	base64UrlToBytes,
	bool,
	bytesToBase64Url,
	deltaArray,
	enumOf,
	fixed,
	optional,
	pack,
	packBase64Url,
	sint,
	string,
	struct,
	type Codec,
	ufixed,
	uint,
	unpack,
	unpackBase64Url,
	vsint,
	vuint
} from '.';

describe('BitWriter / BitReader', () => {
	it('round-trips non-byte-aligned widths', () => {
		const w = new BitWriter();
		w.writeBits(0b1, 1);
		w.writeBits(0b101, 3);
		w.writeBits(0b00, 2);
		w.writeBits(0b11111111, 8);
		w.writeBits(0b0000_0011, 6); // value is 3, in 6 bits = 000011
		const bytes = w.finish();
		const r = new BitReader(bytes);
		expect(r.readBits(1)).toBe(1);
		expect(r.readBits(3)).toBe(0b101);
		expect(r.readBits(2)).toBe(0b00);
		expect(r.readBits(8)).toBe(0b11111111);
		expect(r.readBits(6)).toBe(3);
	});

	it('handles writes that span byte boundaries', () => {
		const w = new BitWriter();
		w.writeBits(0b101, 3);
		w.writeBits(0xfffe, 16);
		const bytes = w.finish();
		const r = new BitReader(bytes);
		expect(r.readBits(3)).toBe(0b101);
		expect(r.readBits(16)).toBe(0xfffe);
	});

	it('handles 32-bit values', () => {
		const w = new BitWriter();
		w.writeBits(0xdeadbeef, 32);
		const bytes = w.finish();
		const r = new BitReader(bytes);
		expect(r.readBits(32)).toBe(0xdeadbeef);
	});

	it('throws when reading past end', () => {
		const r = new BitReader(new Uint8Array([0xff]));
		r.readBits(8);
		expect(() => r.readBits(1)).toThrow(/out of bytes/);
	});

	it('rejects out-of-range bit counts', () => {
		const w = new BitWriter();
		expect(() => w.writeBits(0, 33)).toThrow();
		expect(() => w.writeBits(0, -1)).toThrow();
	});
});

describe('uint', () => {
	it('round-trips values within range', () => {
		expect(unpack(uint(8), pack(uint(8), 42))).toBe(42);
		expect(unpack(uint(1), pack(uint(1), 1))).toBe(1);
		expect(unpack(uint(20), pack(uint(20), 1_000_000))).toBe(1_000_000);
	});
	it('rejects out-of-range values on encode', () => {
		expect(() => pack(uint(4), 16)).toThrow(/out of range/);
		expect(() => pack(uint(8), -1)).toThrow(/out of range/);
		expect(() => pack(uint(8), 1.5)).toThrow(/out of range/);
	});
	it('uses exactly the requested bits (no padding)', () => {
		const w = new BitWriter();
		uint(3).encode(0b101, w);
		uint(3).encode(0b010, w);
		uint(2).encode(0b11, w);
		// 101 010 11 = 1010 1011 → one byte 0xAB
		expect(Array.from(w.finish())).toEqual([0xab]);
	});
});

describe('sint', () => {
	it('round-trips signed values across full range', () => {
		const c = sint(8);
		for (const v of [-128, -1, 0, 1, 127]) {
			expect(unpack(c, pack(c, v))).toBe(v);
		}
	});
	it('round-trips at 32-bit edges', () => {
		const c = sint(32);
		for (const v of [-0x80000000, -1, 0, 1, 0x7fffffff]) {
			expect(unpack(c, pack(c, v))).toBe(v);
		}
	});
	it('rejects out-of-range values', () => {
		expect(() => pack(sint(8), 128)).toThrow();
		expect(() => pack(sint(8), -129)).toThrow();
	});
});

describe('vuint', () => {
	it('round-trips small values cheaply', () => {
		// 0..15 → 5 bits, 16..255 → 10 bits.
		expect(unpack(vuint, pack(vuint, 0))).toBe(0);
		expect(unpack(vuint, pack(vuint, 15))).toBe(15);
		expect(unpack(vuint, pack(vuint, 16))).toBe(16);
		expect(unpack(vuint, pack(vuint, 255))).toBe(255);
		expect(unpack(vuint, pack(vuint, 1_000_000))).toBe(1_000_000);
	});
	it('uses 5 bits for values < 16', () => {
		const w = new BitWriter();
		vuint.encode(7, w);
		expect(w.finish().length).toBe(1); // padded to 1 byte
	});
	it('rejects negative or non-integer values', () => {
		expect(() => pack(vuint, -1)).toThrow();
		expect(() => pack(vuint, 1.5)).toThrow();
	});
});

describe('vsint', () => {
	it('round-trips small signed values cheaply', () => {
		for (const v of [0, -1, 1, -7, 7, -1000, 1000, -100_000, 100_000]) {
			expect(unpack(vsint, pack(vsint, v))).toBe(v);
		}
	});
	it('handles values larger than int32', () => {
		for (const v of [-(2 ** 33), 2 ** 33, -(2 ** 40), 2 ** 40]) {
			expect(unpack(vsint, pack(vsint, v))).toBe(v);
		}
	});
	it('uses 5 bits for 0', () => {
		const w = new BitWriter();
		vsint.encode(0, w);
		expect(w.finish().length).toBe(1);
	});
});

describe('fixed / ufixed', () => {
	it('round-trips signed fixed-point at expected precision', () => {
		const lng = fixed(29, 1e6);
		const v = 13.405123;
		const back = unpack(lng, pack(lng, v));
		expect(back).toBeCloseTo(v, 5);
	});
	it('handles negatives', () => {
		const c = fixed(28, 1e6);
		expect(unpack(c, pack(c, -89.999999))).toBeCloseTo(-89.999999, 5);
	});
	it('ufixed stays unsigned', () => {
		const zoom = ufixed(20, 1e4);
		expect(unpack(zoom, pack(zoom, 13.3164))).toBeCloseTo(13.3164, 3);
		expect(() => pack(zoom, -1)).toThrow();
	});
});

describe('bool', () => {
	it('costs 1 bit and round-trips', () => {
		const w = new BitWriter();
		bool.encode(true, w);
		bool.encode(false, w);
		bool.encode(true, w);
		const bytes = w.finish();
		expect(bytes.length).toBe(1);
		const r = new BitReader(bytes);
		expect(r.readBits(1)).toBe(1);
		expect(r.readBits(1)).toBe(0);
		expect(r.readBits(1)).toBe(1);
	});
});

describe('enumOf', () => {
	it('uses ⌈log₂(n)⌉ bits', () => {
		const c = enumOf(['a', 'b', 'c']); // 2 bits
		const w = new BitWriter();
		c.encode('c', w);
		// 2 bits used, padded to byte: 'c' is index 2 = 0b10, then 6 zero pad → 0b10000000
		expect(w.finish()[0]).toBe(0b10000000);
	});
	it('round-trips', () => {
		const c = enumOf(['arc', 'linear']);
		expect(unpack(c, pack(c, 'arc'))).toBe('arc');
		expect(unpack(c, pack(c, 'linear'))).toBe('linear');
	});
	it('single-value enum costs zero bits', () => {
		const c = enumOf(['only']);
		const bytes = pack(c, 'only');
		expect(bytes.length).toBe(0);
		expect(unpack(c, bytes)).toBe('only');
	});
	it('rejects unknown values', () => {
		const c = enumOf(['a', 'b']);
		expect(() => pack(c, 'c' as never)).toThrow();
	});
});

describe('optional', () => {
	it('encodes a present value as 1 + payload', () => {
		const c = optional(uint(8));
		expect(unpack(c, pack(c, 42))).toBe(42);
	});
	it('encodes undefined as a single bit', () => {
		const c = optional(uint(8));
		const w = new BitWriter();
		c.encode(undefined, w);
		expect(w.finish().length).toBe(1); // 1 bit padded
		expect(unpack(c, pack(c, undefined))).toBeUndefined();
	});
});

describe('array', () => {
	it('round-trips with implicit vuint length', () => {
		const c = array(uint(8));
		expect(unpack(c, pack(c, [1, 2, 3, 4]))).toEqual([1, 2, 3, 4]);
		expect(unpack(c, pack(c, []))).toEqual([]);
	});
	it('honours a custom length codec', () => {
		const c = array(bool, uint(3)); // up to 7 items
		expect(unpack(c, pack(c, [true, false, true]))).toEqual([true, false, true]);
	});
});

describe('struct', () => {
	it('round-trips and infers the value type', () => {
		const Point = struct({ x: fixed(20, 1000), y: fixed(20, 1000), tag: bool });
		const v = { x: 13.405, y: 52.52, tag: true };
		const back = unpack(Point, pack(Point, v));
		expect(back.tag).toBe(true);
		expect(back.x).toBeCloseTo(13.405, 2);
		expect(back.y).toBeCloseTo(52.52, 2);
	});
	it('encodes fields in declaration order', () => {
		const A = struct({ a: bool, b: bool });
		const B = struct({ b: bool, a: bool });
		// Same values, different order ⇒ different bytes.
		const ba = pack(A, { a: true, b: false }); // 1 0
		const bb = pack(B, { a: true, b: false }); // 0 1
		expect(ba[0]).not.toBe(bb[0]);
	});
});

describe('deltaArray', () => {
	const Frame = deltaArray(
		{
			t: vuint,
			x: uint(8),
			y: uint(8),
			tag: bool
		},
		{ t: 0, x: 0, y: 0, tag: false }
	);

	it('round-trips when every element changes everything', () => {
		const arr = [
			{ t: 1, x: 10, y: 20, tag: true },
			{ t: 2, x: 30, y: 40, tag: false }
		];
		expect(unpack(Frame, pack(Frame, arr))).toEqual(arr);
	});

	it('omits unchanged fields on the wire', () => {
		// Compare a 10-frame "all identical" series vs a 10-frame "all-different
		// every step" series. The identical run encodes only one field-bearing
		// frame (the rest are mask-only); the different run carries every field.
		const seed = { t: 5, x: 10, y: 20, tag: true };
		const same = Array.from({ length: 10 }, () => ({ ...seed }));
		const diff = Array.from({ length: 10 }, (_, i) => ({
			t: i + 1,
			x: (i * 7) & 0xff,
			y: (i * 13) & 0xff,
			tag: i % 2 === 0
		}));
		expect(pack(Frame, same).length).toBeLessThan(pack(Frame, diff).length);
		expect(unpack(Frame, pack(Frame, same))).toEqual(same);
		expect(unpack(Frame, pack(Frame, diff))).toEqual(diff);
	});

	it('first element is compared against defaults', () => {
		const arr = [
			{ t: 0, x: 0, y: 0, tag: false }, // matches defaults entirely → mask=0, no fields
			{ t: 0, x: 0, y: 0, tag: false }
		];
		// Length (vuint=5 bits) + 2× mask(4 bits) = 13 bits → 2 bytes.
		expect(pack(Frame, arr).length).toBe(2);
		expect(unpack(Frame, pack(Frame, arr))).toEqual(arr);
	});

	it('round-trips an empty array', () => {
		expect(unpack(Frame, pack(Frame, []))).toEqual([]);
	});
});

describe('string', () => {
	it('round-trips ascii', () => {
		expect(unpack(string, pack(string, 'hello world'))).toBe('hello world');
	});
	it('round-trips unicode (multi-byte UTF-8)', () => {
		expect(unpack(string, pack(string, 'Köln 🦊 北京'))).toBe('Köln 🦊 北京');
	});
	it('round-trips the empty string', () => {
		expect(unpack(string, pack(string, ''))).toBe('');
	});
	it('survives byte-misalignment when nested in a struct', () => {
		const c = struct({ a: bool, s: string, b: uint(3) });
		const value = { a: true, s: 'mid', b: 5 };
		expect(unpack(c, pack(c, value))).toEqual(value);
	});
});

describe('base64-url helpers', () => {
	it('round-trip arbitrary bytes', () => {
		const bytes = new Uint8Array([0, 1, 2, 0xff, 0x80]);
		expect(Array.from(base64UrlToBytes(bytes64(bytes)))).toEqual(Array.from(bytes));
	});
	it('produces URL-safe characters only', () => {
		const s = packBase64Url(uint(32), 0xfff_ffff);
		expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
	});
	it('packBase64Url round-trips', () => {
		const c: Codec<{ a: number; b: boolean }> = struct({ a: uint(16), b: bool });
		const s = packBase64Url(c, { a: 12345, b: true });
		expect(unpackBase64Url(c, s)).toEqual({ a: 12345, b: true });
	});

	function bytes64(b: Uint8Array): string {
		return bytesToBase64Url(b);
	}
});

describe('end-to-end animation-shaped schema', () => {
	const Animation = struct({
		version: uint(4),
		style: enumOf(['colorful', 'satellite', 'satellite-overlay']),
		terrain: bool,
		keyframes: deltaArray(
			{
				t: vuint,
				lng: fixed(29, 1e6),
				lat: fixed(28, 1e6),
				zoom: ufixed(20, 1e4),
				pitch: ufixed(14, 100),
				bearing: fixed(16, 100),
				roll: fixed(16, 100),
				path: enumOf(['arc', 'linear'])
			},
			{ t: 0, lng: 0, lat: 0, zoom: 0, pitch: 0, bearing: 0, roll: 0, path: 'arc' }
		)
	});

	it('round-trips a four-keyframe animation', () => {
		const value = {
			version: 1,
			style: 'satellite' as const,
			terrain: true,
			keyframes: [
				{
					t: 0,
					lng: 12.3019,
					lat: 50.6553,
					zoom: 4.4629,
					pitch: 0,
					bearing: 0,
					roll: 0,
					path: 'arc' as const
				},
				{
					t: 2134,
					lng: 7.0812,
					lat: 46.1179,
					zoom: 12.896,
					pitch: 0,
					bearing: 0,
					roll: 0,
					path: 'arc' as const
				},
				{
					t: 3979,
					lng: 7.142,
					lat: 46.1406,
					zoom: 13.3164,
					pitch: 70.5,
					bearing: 51.62,
					roll: 0,
					path: 'arc' as const
				},
				{
					t: 6009,
					lng: 7.2269,
					lat: 46.2038,
					zoom: 13.6893,
					pitch: 73,
					bearing: 10.02,
					roll: 0,
					path: 'arc' as const
				}
			]
		};
		const s = packBase64Url(Animation, value);
		const back = unpackBase64Url(Animation, s);
		expect(back.version).toBe(1);
		expect(back.style).toBe('satellite');
		expect(back.terrain).toBe(true);
		expect(back.keyframes.length).toBe(4);
		expect(back.keyframes[1].lng).toBeCloseTo(7.0812, 4);
		expect(back.keyframes[3].pitch).toBeCloseTo(73, 1);
		expect(back.keyframes[2].bearing).toBeCloseTo(51.62, 1);
		expect(back.keyframes[0].path).toBe('arc');
	});

	it('produces a substantially smaller URL than the JSON form', () => {
		const value = {
			version: 1,
			style: 'satellite' as const,
			terrain: true,
			keyframes: [
				{
					t: 0,
					lng: 12.3019,
					lat: 50.6553,
					zoom: 4.4629,
					pitch: 0,
					bearing: 0,
					roll: 0,
					path: 'arc' as const
				},
				{
					t: 2134,
					lng: 7.0812,
					lat: 46.1179,
					zoom: 12.896,
					pitch: 0,
					bearing: 0,
					roll: 0,
					path: 'arc' as const
				},
				{
					t: 3979,
					lng: 7.142,
					lat: 46.1406,
					zoom: 13.3164,
					pitch: 70.5,
					bearing: 51.62,
					roll: 0,
					path: 'arc' as const
				},
				{
					t: 6009,
					lng: 7.2269,
					lat: 46.2038,
					zoom: 13.6893,
					pitch: 73,
					bearing: 10.02,
					roll: 0,
					path: 'arc' as const
				}
			]
		};
		const compactJson = JSON.stringify(value);
		const binary = packBase64Url(Animation, value);
		// Aim: at least 3× smaller than minified JSON. Don't make this brittle —
		// just sanity-check that we're not regressing.
		expect(binary.length * 3).toBeLessThan(compactJson.length);
	});
});
