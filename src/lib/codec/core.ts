/**
 * Bit-stream substrate + the `Codec<T>` interface that every codec implements.
 *
 * Codecs are values that know how to read and write a TypeScript type from a
 * bit stream. They compose: `struct({...})`, `array(...)`, `optional(...)`.
 * The codec's static type matches the value it encodes, so the schema *is*
 * the type.
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

/**
 * Optional tracing hook called by `BitWriter.frame()` so that `inspect()` can
 * build a tree of "where the bits went". Set to `undefined` (the default) for
 * production use — the per-call overhead is then a single null-check.
 */
export interface Inspector {
	enter(label: string, bit: number): void;
	exit(bit: number): void;
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

	/**
	 * Run `fn` with this writer wrapped in an inspector frame named `label`.
	 * Codecs use this to attribute their bit cost to a tree node when an
	 * inspector is attached; with no inspector it's just `fn()`.
	 */
	frame<T>(label: string, fn: () => T): T {
		const ins = this.inspector;
		if (!ins) return fn();
		ins.enter(label, this.total);
		try {
			return fn();
		} finally {
			ins.exit(this.total);
		}
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
