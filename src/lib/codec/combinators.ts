/**
 * Combinator codecs — wrap one or more inner codecs into a structured codec
 * (optional, array, struct).
 */

import type { Codec } from './core';
import { vuint } from './primitives';

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
			w.frame('[length]', () => lengthCodec.encode(arr.length, w));
			for (let i = 0; i < arr.length; i++) {
				w.frame(`[${i}]`, () => inner.encode(arr[i], w));
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
				w.frame(String(k), () => shape[k].encode((value as Out)[k], w));
			}
		},
		decode: (r) => {
			const out = {} as Out;
			for (const k of keys) (out as Record<string, unknown>)[k as string] = shape[k].decode(r);
			return out;
		}
	};
}
