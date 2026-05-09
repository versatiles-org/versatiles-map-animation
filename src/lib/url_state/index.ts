/**
 * URL-hash state for the editor and viewer pages.
 *
 *   encodeAnimation(anim)        → base64-url string
 *   decodeAnimation(encoded)     → Animation | null
 *   readAnimationFromUrl()       → Animation | null   (parses window.location.hash)
 *   writeAnimationToUrl(anim)    → void               (replaceState)
 *   clearUrlHash()               → void
 *   inspectAnimation(anim)       → InspectionNode     (debug bit-cost tree)
 *
 * The on-the-wire format is a single tag byte followed by a struct chosen by
 * the smallest sufficient version (V1 keyframes-only, V2 adds annotations, V3
 * adds annotationScale). See ./animation_codec for the struct definitions.
 */

import { base64UrlToBytes, BitReader, BitWriter, bytesToBase64Url, inspect } from '../codec';
import type { InspectionNode } from '../codec';
import { DEFAULT_ANNOTATION_SCALE, SCHEMA_VERSION } from '../types';
import type { Animation } from '../types';
import {
	AnimationCodecV1,
	AnimationCodecV2,
	AnimationCodecV3,
	AnimationCodecV4,
	FORMAT_TAG_BINARY_V1,
	FORMAT_TAG_BINARY_V2,
	FORMAT_TAG_BINARY_V3,
	FORMAT_TAG_BINARY_V4
} from './animation_codec';
import { denormalizeAnnotation, normalizeAnnotation } from './annotation_codec';
import { denormalizeKeyframe, normalizeKeyframe } from './keyframe_codec';

const HASH_KEY = 'kf';
const STORAGE_KEY = 'versatiles-map-animation';

/**
 * Encode an animation to a base64-url string suitable for URL hashes.
 * Uses the bit-packed binary codec; the first byte is a format tag so the
 * decoder can pick the right struct. Picks the smallest sufficient version:
 *   V1: keyframes only
 *   V2: keyframes + annotations at default scale + default per-annotation sizes
 *   V3: V2 + annotationScale ≠ 1
 *   V4: V3 + per-annotation iconSize / labelSize
 * Older binary versions stay byte-stable so existing share links don't change.
 */
export function encodeAnimation(anim: Animation): string {
	const w = new BitWriter();
	const scale = anim.annotationScale ?? DEFAULT_ANNOTATION_SCALE;
	const hasAnnotations = anim.annotations && anim.annotations.length > 0;
	const needsV4 =
		hasAnnotations &&
		anim.annotations.some((a) => (a.iconSize ?? 1) !== 1 || (a.labelSize ?? 1) !== 1);
	const needsV3 = hasAnnotations && scale !== DEFAULT_ANNOTATION_SCALE;
	if (needsV4) {
		w.writeBits(FORMAT_TAG_BINARY_V4, 8);
		AnimationCodecV4.encode(
			{
				version: anim.version,
				style: anim.style,
				terrain: anim.terrain,
				keyframes: anim.keyframes.map(normalizeKeyframe),
				annotations: anim.annotations.map(normalizeAnnotation),
				annotationScale: scale
			},
			w
		);
	} else if (needsV3) {
		w.writeBits(FORMAT_TAG_BINARY_V3, 8);
		AnimationCodecV3.encode(
			{
				version: anim.version,
				style: anim.style,
				terrain: anim.terrain,
				keyframes: anim.keyframes.map(normalizeKeyframe),
				annotations: anim.annotations.map(normalizeAnnotation),
				annotationScale: scale
			},
			w
		);
	} else if (hasAnnotations) {
		w.writeBits(FORMAT_TAG_BINARY_V2, 8);
		AnimationCodecV2.encode(
			{
				version: anim.version,
				style: anim.style,
				terrain: anim.terrain,
				keyframes: anim.keyframes.map(normalizeKeyframe),
				annotations: anim.annotations.map(normalizeAnnotation)
			},
			w
		);
	} else {
		w.writeBits(FORMAT_TAG_BINARY_V1, 8);
		AnimationCodecV1.encode(
			{
				version: anim.version,
				style: anim.style,
				terrain: anim.terrain,
				keyframes: anim.keyframes.map(normalizeKeyframe)
			},
			w
		);
	}
	return bytesToBase64Url(w.finish());
}

/**
 * Decode an animation from a base64-url string. Returns null on any decode
 * failure (malformed base64, unknown format tag, codec read error).
 */
export function decodeAnimation(encoded: string): Animation | null {
	try {
		return decodeOrThrow(encoded);
	} catch {
		return null;
	}
}

function decodeOrThrow(encoded: string): Animation {
	const bytes = base64UrlToBytes(encoded);
	if (bytes.length === 0) throw new Error('Empty payload');
	const tag = bytes[0];
	if (
		tag !== FORMAT_TAG_BINARY_V1 &&
		tag !== FORMAT_TAG_BINARY_V2 &&
		tag !== FORMAT_TAG_BINARY_V3 &&
		tag !== FORMAT_TAG_BINARY_V4
	) {
		throw new Error(`Unknown URL hash format (tag=0x${tag.toString(16)})`);
	}
	const r = new BitReader(bytes);
	r.readBits(8); // consume tag
	if (tag === FORMAT_TAG_BINARY_V4) {
		const wire = AnimationCodecV4.decode(r);
		assertVersion(wire.version);
		return {
			version: SCHEMA_VERSION,
			style: wire.style,
			terrain: wire.terrain,
			keyframes: wire.keyframes.map(denormalizeKeyframe),
			annotations: wire.annotations.map(denormalizeAnnotation),
			annotationScale: wire.annotationScale
		};
	}
	if (tag === FORMAT_TAG_BINARY_V3) {
		const wire = AnimationCodecV3.decode(r);
		assertVersion(wire.version);
		return {
			version: SCHEMA_VERSION,
			style: wire.style,
			terrain: wire.terrain,
			keyframes: wire.keyframes.map(denormalizeKeyframe),
			annotations: wire.annotations.map(denormalizeAnnotation),
			annotationScale: wire.annotationScale
		};
	}
	if (tag === FORMAT_TAG_BINARY_V2) {
		const wire = AnimationCodecV2.decode(r);
		assertVersion(wire.version);
		return {
			version: SCHEMA_VERSION,
			style: wire.style,
			terrain: wire.terrain,
			keyframes: wire.keyframes.map(denormalizeKeyframe),
			annotations: wire.annotations.map(denormalizeAnnotation),
			annotationScale: DEFAULT_ANNOTATION_SCALE
		};
	}
	const wire = AnimationCodecV1.decode(r);
	assertVersion(wire.version);
	return {
		version: SCHEMA_VERSION,
		style: wire.style,
		terrain: wire.terrain,
		keyframes: wire.keyframes.map(denormalizeKeyframe),
		annotations: [],
		annotationScale: DEFAULT_ANNOTATION_SCALE
	};
}

function assertVersion(v: number): void {
	if (v > SCHEMA_VERSION) {
		throw new Error(`File was made with a newer version (v${v}); supported: v${SCHEMA_VERSION}.`);
	}
}

/**
 * Reads the animation from the URL hash. Returns null when no hash is
 * present (legitimate first visit). Throws if a hash is present but
 * cannot be decoded — callers should surface this to the user, since
 * they likely arrived via a broken share link.
 */
export function readAnimationFromUrl(): Animation | null {
	if (typeof window === 'undefined') return null;
	const hash = window.location.hash.startsWith('#')
		? window.location.hash.slice(1)
		: window.location.hash;
	if (!hash) return null;
	const params = new URLSearchParams(hash);
	const v = params.get(HASH_KEY);
	if (!v) return null;
	return decodeOrThrow(v);
}

/**
 * Return a bit-cost tree for the current encoding of `anim`. Useful for
 * debugging URL-hash size — pair with `formatInspection()` from `$lib/codec`
 * to print a "lat: 28 bits, zoom: 20 bits, …" tree.
 */
export function inspectAnimation(anim: Animation): InspectionNode {
	const scale = anim.annotationScale ?? DEFAULT_ANNOTATION_SCALE;
	const hasAnnotations = anim.annotations && anim.annotations.length > 0;
	const needsV4 =
		hasAnnotations &&
		anim.annotations.some((a) => (a.iconSize ?? 1) !== 1 || (a.labelSize ?? 1) !== 1);
	const needsV3 = hasAnnotations && scale !== DEFAULT_ANNOTATION_SCALE;
	const inner = needsV4
		? inspect(AnimationCodecV4, {
				version: anim.version,
				style: anim.style,
				terrain: anim.terrain,
				keyframes: anim.keyframes.map(normalizeKeyframe),
				annotations: anim.annotations.map(normalizeAnnotation),
				annotationScale: scale
			})
		: needsV3
			? inspect(AnimationCodecV3, {
					version: anim.version,
					style: anim.style,
					terrain: anim.terrain,
					keyframes: anim.keyframes.map(normalizeKeyframe),
					annotations: anim.annotations.map(normalizeAnnotation),
					annotationScale: scale
				})
			: hasAnnotations
				? inspect(AnimationCodecV2, {
						version: anim.version,
						style: anim.style,
						terrain: anim.terrain,
						keyframes: anim.keyframes.map(normalizeKeyframe),
						annotations: anim.annotations.map(normalizeAnnotation)
					})
				: inspect(AnimationCodecV1, {
						version: anim.version,
						style: anim.style,
						terrain: anim.terrain,
						keyframes: anim.keyframes.map(normalizeKeyframe)
					});
	// Wrap with the 1-byte format-tag prefix that `encodeAnimation` adds, so
	// the tree's bit total matches the actual on-the-wire payload.
	return {
		label: 'animation',
		bits: 8 + inner.bits,
		children: [{ label: '[format-tag]', bits: 8, children: [] }, ...inner.children]
	};
}

export function clearUrlHash(): void {
	if (typeof window === 'undefined') return;
	history.replaceState(null, '', window.location.pathname + window.location.search);
}

/**
 * Reads the most recently saved animation from localStorage. Used as a
 * fallback when the URL hash is empty (e.g., the user reloaded the bare
 * editor URL after closing the tab). Returns null on a fresh browser, on
 * any decode failure, or in environments without localStorage.
 */
export function readAnimationFromStorage(): Animation | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return decodeAnimation(raw);
	} catch {
		return null;
	}
}

/**
 * Mirror the current animation to localStorage so a page reload (without a
 * URL hash) restores it. Stored as the same base64-url string that the URL
 * hash would carry, so encode/decode is one code path. Silent on quota /
 * disabled-storage errors — it's a best-effort UX nicety.
 */
export function writeAnimationToStorage(anim: Animation): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(STORAGE_KEY, encodeAnimation(anim));
	} catch {
		// localStorage may be disabled (Safari private mode, quota full); ignore.
	}
}

export function clearAnimationStorage(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

export function writeAnimationToUrl(anim: Animation): void {
	if (typeof window === 'undefined') return;
	const url = window.location.pathname + window.location.search;
	if (anim.keyframes.length === 0) {
		history.replaceState(null, '', url);
		return;
	}
	const encoded = encodeAnimation(anim);
	history.replaceState(null, '', `${url}#${HASH_KEY}=${encoded}`);
}
