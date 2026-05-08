/**
 * Tiny, dependency-free, bit-level binary codec library.
 *
 * Codecs are values that know how to read and write a TypeScript type from a
 * bit stream. They compose: `struct({...})`, `array(...)`, `optional(...)`,
 * `deltaArray(...)`. The codec's static type matches the value it encodes,
 * so the schema *is* the type.
 *
 *   const Frame = struct({
 *     t: vuint,
 *     lng: fixed(29, 1e6),
 *     lat: fixed(28, 1e6),
 *     active: bool
 *   });
 *   // Frame is Codec<{ t: number; lng: number; lat: number; active: boolean }>
 *
 *   const bytes = pack(Frame, value);
 *   const back  = unpack(Frame, bytes);
 *
 * All numeric primitives are bit-aligned (no padding to bytes), so a `bool`
 * costs 1 bit, a 3-option `enumOf` costs 2 bits, and a struct of 8 booleans
 * costs 1 byte total. The final byte of the encoded stream is zero-padded.
 * The schema, not a length header, tells the decoder where to stop.
 */

// ---------------------------------------------------------------------------
// Bit stream substrate
// ---------------------------------------------------------------------------

/**
 * Optional hook that combinators call around each sub-codec's encode, so that
 * `inspect()` can build a tree of "where the bits went". Set to `undefined`
 * (the default) for production use — the per-call overhead is then a single
 * `?.` check.
 */
export interface Inspector {
	enter(label: string, bit: number): void;
	exit(label: string, bit: number): void;
}

export class BitWriter {
	private bytes: number[] = [];
	private cur = 0; // partial byte being filled, low bits valid
	private nbits = 0; // number of bits currently in `cur`, 0..7
	private total = 0; // total bits written

	/** Optional tracing hook used by `inspect()`. */
	inspector?: Inspector;

	/** Number of bits written so far (not counting the trailing pad in finish()). */
	totalBits(): number {
		return this.total;
	}

	/** Write the low `n` bits of `value` to the stream, MSB-first. */
	writeBits(value: number, n: number): void {
		if (n === 0) return;
		if (!Number.isInteger(n) || n < 1 || n > 32) {
			throw new Error(`BitWriter.writeBits: n=${n} out of range 1..32`);
		}
		// Mask `value` to the low n bits (unsigned).
		const mask = n === 32 ? 0xffffffff : ((1 << n) - 1) >>> 0;
		let v = (value >>> 0) & mask;
		let remain = n;
		while (remain > 0) {
			const space = 8 - this.nbits;
			const take = Math.min(space, remain);
			// Extract the top `take` bits of the remaining value.
			const topBits = (v >>> (remain - take)) & ((1 << take) - 1);
			this.cur = ((this.cur << take) & 0xff) | topBits;
			this.nbits += take;
			if (this.nbits === 8) {
				this.bytes.push(this.cur);
				this.cur = 0;
				this.nbits = 0;
			}
			remain -= take;
			// Drop the bits we already emitted from `v`.
			v = remain > 0 ? v & ((1 << remain) - 1) : 0;
		}
		this.total += n;
	}

	/** Pad to a byte boundary with zeros and return the encoded bytes. */
	finish(): Uint8Array {
		if (this.nbits > 0) {
			this.bytes.push((this.cur << (8 - this.nbits)) & 0xff);
			this.cur = 0;
			this.nbits = 0;
		}
		return Uint8Array.from(this.bytes);
	}
}

export class BitReader {
	private bit = 0;
	constructor(private readonly bytes: Uint8Array) {}

	/** Read `n` bits (MSB-first) and return them as an unsigned number. */
	readBits(n: number): number {
		if (n === 0) return 0;
		if (!Number.isInteger(n) || n < 1 || n > 32) {
			throw new Error(`BitReader.readBits: n=${n} out of range 1..32`);
		}
		let result = 0;
		let remain = n;
		while (remain > 0) {
			const byteIdx = this.bit >>> 3;
			const bitIdx = this.bit & 7;
			if (byteIdx >= this.bytes.length) {
				throw new Error('BitReader: out of bytes');
			}
			const space = 8 - bitIdx;
			const take = Math.min(space, remain);
			const byte = this.bytes[byteIdx];
			const shift = space - take;
			const chunk = (byte >>> shift) & ((1 << take) - 1);
			// Multiplication keeps us in safe-integer land for n=32 (uses up to 2^40).
			result = result * (1 << take) + chunk;
			this.bit += take;
			remain -= take;
		}
		return result;
	}

	/** Bits remaining in the buffer (not necessarily meaningful — could be padding). */
	remaining(): number {
		return this.bytes.length * 8 - this.bit;
	}
}

// ---------------------------------------------------------------------------
// Codec interface and runners
// ---------------------------------------------------------------------------

export interface Codec<T> {
	encode(value: T, w: BitWriter): void;
	decode(r: BitReader): T;
}

/** Extract the value type from a codec. */
export type TypeOf<C> = C extends Codec<infer T> ? T : never;

export function pack<T>(codec: Codec<T>, value: T): Uint8Array {
	const w = new BitWriter();
	codec.encode(value, w);
	return w.finish();
}

export function unpack<T>(codec: Codec<T>, bytes: Uint8Array): T {
	const r = new BitReader(bytes);
	return codec.decode(r);
}

// ---------------------------------------------------------------------------
// Base64-URL helpers (URL-safe, no padding)
// ---------------------------------------------------------------------------

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlToBytes(s: string): Uint8Array {
	const pad = (4 - (s.length % 4)) % 4;
	const padded = s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(pad);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function packBase64Url<T>(codec: Codec<T>, value: T): string {
	return bytesToBase64Url(pack(codec, value));
}

export function unpackBase64Url<T>(codec: Codec<T>, s: string): T {
	return unpack(codec, base64UrlToBytes(s));
}

// ---------------------------------------------------------------------------
// Primitive codecs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/** Wraps a codec to allow `undefined`. Costs 1 bit when present. */
export function optional<T>(inner: Codec<T>): Codec<T | undefined> {
	return {
		encode: (v, w) => {
			if (v === undefined) {
				w.writeBits(0, 1);
			} else {
				w.writeBits(1, 1);
				inner.encode(v, w);
			}
		},
		decode: (r) => (r.readBits(1) === 1 ? inner.decode(r) : undefined)
	};
}

/** A list of `T` prefixed with its length (default `vuint`). */
export function array<T>(inner: Codec<T>, lengthCodec: Codec<number> = vuint): Codec<T[]> {
	return {
		encode: (arr, w) => {
			w.inspector?.enter('[length]', w.totalBits());
			lengthCodec.encode(arr.length, w);
			w.inspector?.exit('[length]', w.totalBits());
			for (let i = 0; i < arr.length; i++) {
				w.inspector?.enter(`[${i}]`, w.totalBits());
				inner.encode(arr[i], w);
				w.inspector?.exit(`[${i}]`, w.totalBits());
			}
		},
		decode: (r) => {
			const len = lengthCodec.decode(r);
			const out: T[] = [];
			for (let i = 0; i < len; i++) out.push(inner.decode(r));
			return out;
		}
	};
}

/** A struct: fields encoded in declaration order. The value type is inferred. */
export function struct<S extends Record<string, Codec<unknown>>>(
	shape: S
): Codec<{ [K in keyof S]: S[K] extends Codec<infer V> ? V : never }> {
	const keys = Object.keys(shape) as (keyof S)[];
	type Out = { [K in keyof S]: S[K] extends Codec<infer V> ? V : never };
	return {
		encode: (value, w) => {
			for (const k of keys) {
				const ins = w.inspector;
				if (ins) ins.enter(String(k), w.totalBits());
				shape[k].encode((value as Out)[k], w);
				if (ins) ins.exit(String(k), w.totalBits());
			}
		},
		decode: (r) => {
			const out = {} as Out;
			for (const k of keys) (out as Record<string, unknown>)[k as string] = shape[k].decode(r);
			return out;
		}
	};
}

/**
 * Carry-forward array: each element is a struct, encoded as an
 * N-bit presence bitmask plus only the fields whose values differ from the
 * previous element (or `defaults` for the first). Saves dramatic space when
 * adjacent items share most fields.
 */
export function deltaArray<S extends Record<string, Codec<unknown>>>(
	shape: S,
	defaults: { [K in keyof S]: S[K] extends Codec<infer V> ? V : never },
	lengthCodec: Codec<number> = vuint
): Codec<Array<{ [K in keyof S]: S[K] extends Codec<infer V> ? V : never }>> {
	const keys = Object.keys(shape) as (keyof S)[];
	if (keys.length < 1 || keys.length > 32) {
		throw new Error(`deltaArray: shape must have 1..32 fields, got ${keys.length}`);
	}
	const maskBits = keys.length;
	type Item = { [K in keyof S]: S[K] extends Codec<infer V> ? V : never };
	return {
		encode: (arr, w) => {
			const ins = w.inspector;
			if (ins) ins.enter('[length]', w.totalBits());
			lengthCodec.encode(arr.length, w);
			if (ins) ins.exit('[length]', w.totalBits());
			let prev: Item = { ...defaults };
			for (let idx = 0; idx < arr.length; idx++) {
				const item = arr[idx];
				if (ins) ins.enter(`[${idx}]`, w.totalBits());
				let mask = 0;
				for (let i = 0; i < keys.length; i++) {
					if (item[keys[i]] !== prev[keys[i]]) mask |= 1 << i;
				}
				if (ins) ins.enter('[mask]', w.totalBits());
				w.writeBits(mask, maskBits);
				if (ins) ins.exit('[mask]', w.totalBits());
				for (let i = 0; i < keys.length; i++) {
					if (mask & (1 << i)) {
						const k = keys[i];
						if (ins) ins.enter(String(k), w.totalBits());
						shape[k].encode(item[k], w);
						if (ins) ins.exit(String(k), w.totalBits());
					}
				}
				if (ins) ins.exit(`[${idx}]`, w.totalBits());
				prev = { ...prev, ...item };
			}
		},
		decode: (r) => {
			const len = lengthCodec.decode(r);
			const out: Item[] = [];
			let prev: Item = { ...defaults };
			for (let i = 0; i < len; i++) {
				const mask = r.readBits(maskBits);
				const item: Item = { ...prev };
				for (let j = 0; j < keys.length; j++) {
					if (mask & (1 << j)) {
						(item as Record<string, unknown>)[keys[j] as string] = shape[keys[j]].decode(r);
					}
				}
				out.push(item);
				prev = item;
			}
			return out;
		}
	};
}

// ---------------------------------------------------------------------------
// Inspector — "where do the bits go?"
// ---------------------------------------------------------------------------

/** A node in the bit-cost tree returned by `inspect()`. */
export interface InspectionNode {
	label: string;
	bits: number;
	children: InspectionNode[];
}

/**
 * Encode `value` with `codec` and return a tree describing how many bits each
 * sub-codec contributed. Useful for debugging URL-hash size: drop the result
 * into `formatInspection()` to see a tree of "lat: 28 bits, zoom: 20 bits…".
 *
 * Combinators (struct/array/deltaArray) emit one tree node per field or
 * element. Primitive codecs are leaves attributed to their parent.
 */
export function inspect<T>(codec: Codec<T>, value: T): InspectionNode {
	type Pending = InspectionNode & { _start: number };
	const root: Pending = { label: 'root', bits: 0, children: [], _start: 0 };
	const stack: Pending[] = [root];
	const w = new BitWriter();
	w.inspector = {
		enter(label, bit) {
			const node: Pending = { label, bits: 0, children: [], _start: bit };
			stack[stack.length - 1].children.push(node);
			stack.push(node);
		},
		exit(_label, bit) {
			const node = stack.pop();
			if (node) node.bits = bit - node._start;
		}
	};
	codec.encode(value, w);
	root.bits = w.totalBits();
	const strip = (n: Pending): InspectionNode => ({
		label: n.label,
		bits: n.bits,
		children: n.children.map((c) => strip(c as Pending))
	});
	return strip(root);
}

/** Pretty-print an inspection tree as an indented, branched layout. */
export function formatInspection(node: InspectionNode): string {
	const lines: string[] = [];
	const fmt = (b: number) => `${b} bit${b === 1 ? '' : 's'} (${(b / 8).toFixed(1)} B)`;
	const recurse = (n: InspectionNode, prefix: string, isLast: boolean, isRoot: boolean) => {
		if (isRoot) {
			lines.push(`${n.label}: ${fmt(n.bits)}`);
		} else {
			lines.push(`${prefix}${isLast ? '└── ' : '├── '}${n.label}: ${fmt(n.bits)}`);
		}
		const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
		for (let i = 0; i < n.children.length; i++) {
			recurse(n.children[i], childPrefix, i === n.children.length - 1, false);
		}
	};
	recurse(node, '', true, true);
	return lines.join('\n');
}
