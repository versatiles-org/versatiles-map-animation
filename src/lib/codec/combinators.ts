/**
 * Combinator codecs — wrap one or more inner codecs into a structured codec
 * (optional, array, struct, deltaArray).
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
