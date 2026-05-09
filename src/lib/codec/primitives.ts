/**
 * Primitive codecs — single-value reads/writes that don't take other codecs.
 */

import type { Codec } from './core';

export const bool: Codec<boolean> = {
	encode: (v, w) => w.writeBits(v ? 1 : 0, 1),
	decode: (r) => r.readBits(1) === 1
};

export function uint(bits: number): Codec<number> {
	if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
		throw new Error(`uint: bits=${bits} out of range 1..32`);
	}
	const max = bits === 32 ? 0xffffffff : (1 << bits) - 1;
	return {
		encode: (v, w) => {
			if (!Number.isInteger(v) || v < 0 || v > max) {
				throw new Error(`uint(${bits}): value ${v} out of range 0..${max}`);
			}
			w.writeBits(v, bits);
		},
		decode: (r) => r.readBits(bits)
	};
}

export function sint(bits: number): Codec<number> {
	if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
		throw new Error(`sint: bits=${bits} out of range 1..32`);
	}
	const max = bits === 32 ? 0x7fffffff : (1 << (bits - 1)) - 1;
	const min = bits === 32 ? -0x80000000 : -(1 << (bits - 1));
	const signBit = 1 << (bits - 1);
	const widthMask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
	return {
		encode: (v, w) => {
			if (!Number.isInteger(v) || v < min || v > max) {
				throw new Error(`sint(${bits}): value ${v} out of range ${min}..${max}`);
			}
			// Two's complement: writeBits already takes the low `bits` bits.
			w.writeBits(v, bits);
		},
		decode: (r) => {
			const u = r.readBits(bits);
			// Sign-extend if the top bit is set.
			return u & signBit ? u | ~widthMask : u;
		}
	};
}

/**
 * Variable-length unsigned integer. Each chunk is 5 bits: 4 payload + 1
 * continuation. Compact for small values: 0..15 → 5 bits; 16..255 → 10 bits.
 *
 * Uses arithmetic ops (not bitwise) so values can exceed 32 bits (up to
 * Number.MAX_SAFE_INTEGER).
 */
export const vuint: Codec<number> = {
	encode: (value, w) => {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error(`vuint: ${value} is not a non-negative integer`);
		}
		let v = value;
		do {
			const chunk = v % 16;
			v = Math.floor(v / 16);
			w.writeBits(v ? chunk | 0x10 : chunk, 5);
		} while (v);
	},
	decode: (r) => {
		let out = 0;
		let scale = 1;
		while (true) {
			const b = r.readBits(5);
			out += (b & 0xf) * scale;
			if (!(b & 0x10)) return out;
			scale *= 16;
			if (scale > Number.MAX_SAFE_INTEGER) throw new Error('vuint: overflow');
		}
	}
};

/**
 * Variable-length signed integer. Zig-zag mapping (0 → 0, -1 → 1, 1 → 2, …)
 * onto `vuint`. Cheap for values close to zero (the common case for deltas).
 */
export const vsint: Codec<number> = {
	encode: (value, w) => {
		if (!Number.isInteger(value)) throw new Error(`vsint: ${value} is not an integer`);
		const zz = value >= 0 ? value * 2 : -value * 2 - 1;
		vuint.encode(zz, w);
	},
	decode: (r) => {
		const u = vuint.decode(r);
		return u % 2 === 0 ? u / 2 : -((u + 1) / 2);
	}
};

/** Unsigned fixed-point: `Math.round(v * scale)` stored as `uint(bits)`. */
export function ufixed(bits: number, scale: number): Codec<number> {
	const inner = uint(bits);
	return {
		encode: (v, w) => inner.encode(Math.round(v * scale), w),
		decode: (r) => inner.decode(r) / scale
	};
}

/** Signed fixed-point: `Math.round(v * scale)` stored as `sint(bits)`. */
export function fixed(bits: number, scale: number): Codec<number> {
	const inner = sint(bits);
	return {
		encode: (v, w) => inner.encode(Math.round(v * scale), w),
		decode: (r) => inner.decode(r) / scale
	};
}

/**
 * A length-prefixed UTF-8 string. Cheap for short strings (5 bits length +
 * 8 bits per byte); use sparingly — strings are the worst offender for URL
 * size in our schema.
 */
export const string: Codec<string> = {
	encode: (s, w) => {
		const bytes = new TextEncoder().encode(s);
		vuint.encode(bytes.length, w);
		for (const b of bytes) w.writeBits(b, 8);
	},
	decode: (r) => {
		const len = vuint.decode(r);
		const bytes = new Uint8Array(len);
		for (let i = 0; i < len; i++) bytes[i] = r.readBits(8);
		return new TextDecoder().decode(bytes);
	}
};

/** A string union codec. Costs `⌈log₂(values.length)⌉` bits. */
export function enumOf<const T extends readonly [string, ...string[]]>(
	values: T
): Codec<T[number]> {
	if (values.length === 1) {
		const only = values[0];
		return { encode: () => {}, decode: () => only };
	}
	const bits = Math.ceil(Math.log2(values.length));
	const inner = uint(bits);
	return {
		encode: (v, w) => {
			const idx = values.indexOf(v);
			if (idx === -1) throw new Error(`enumOf: unknown value '${v}'`);
			inner.encode(idx, w);
		},
		decode: (r) => {
			const idx = inner.decode(r);
			if (idx >= values.length) throw new Error(`enumOf: invalid index ${idx}`);
			return values[idx] as T[number];
		}
	};
}
