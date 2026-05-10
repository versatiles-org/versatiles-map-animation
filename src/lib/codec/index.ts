/**
 * Tiny, dependency-free, bit-level binary codec library. Re-exports every
 * piece of the public API so callers can `import { ... } from '$lib/codec'`
 * without caring how the internals are split across files.
 *
 * Topology:
 *   core        — BitReader / BitWriter / Codec / pack / unpack
 *   base64      — base64-url byte ↔ string helpers
 *   primitives  — bool / uint / sint / ufixed / fixed / vuint / vsint /
 *                 stringCodec / enumOf
 *   combinators — optional / array / struct
 *   inspect     — bit-cost tree + formatter for debugging URL size
 */

export * from './core';
export * from './base64';
export * from './primitives';
export * from './combinators';
export * from './inspect';
