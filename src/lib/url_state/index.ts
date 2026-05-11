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
 * The on-the-wire format is a single tag byte followed by the V1 struct
 * defined in `./animation_codec`. Future *additive* features extend the
 * options mask inside V1; the format-tag bumps to V2 only on a genuinely
 * breaking change (see the rule documented at the top of `animation_codec.ts`).
 */

import { base64UrlToBytes, BitReader, BitWriter, bytesToBase64Url, inspect } from '../codec';
import type { InspectionNode } from '../codec';
import { ANIMATION_DEFAULTS, SCHEMA_VERSION } from '../types';
import type { Animation } from '../types';
import { AnimationCodec, FORMAT_TAG_BINARY_V1 } from './animation_codec';
import { denormalizeAnnotation, normalizeAnnotation } from './annotation_codec';
import { denormalizeKeyframe, normalizeKeyframe } from './keyframe_codec';

const HASH_KEY = 'kf';
const STORAGE_KEY = 'versatiles-map-animation';

// ---------------------------------------------------------------------------
// Wire payload <-> Animation conversions
// ---------------------------------------------------------------------------

type Wire = Parameters<typeof AnimationCodec.encode>[0];

function buildWire(anim: Animation): Wire {
	return {
		version: anim.version,
		style: anim.style,
		labels: anim.labels,
		terrain: anim.terrain,
		sky: anim.sky,
		keyframes: anim.keyframes.map(normalizeKeyframe),
		annotations: anim.annotations.map(normalizeAnnotation),
		annotationScale: anim.annotationScale,
		aspectRatio: anim.aspectRatio
	};
}

function fromWire(wire: Wire): Animation {
	return {
		version: SCHEMA_VERSION,
		style: wire.style,
		labels: wire.labels,
		terrain: wire.terrain,
		sky: wire.sky,
		keyframes: wire.keyframes.map(denormalizeKeyframe),
		annotations: wire.annotations.map(denormalizeAnnotation),
		annotationScale: wire.annotationScale ?? ANIMATION_DEFAULTS.annotationScale,
		aspectRatio: wire.aspectRatio ?? ANIMATION_DEFAULTS.aspectRatio,
		// `defaultAnnotation` isn't on the wire yet (UX-only feature for now —
		// the wire codec optimisation is a follow-up). Decoded animations
		// always come back with empty defaults.
		defaultAnnotation: {}
	};
}

// ---------------------------------------------------------------------------
// Encode / decode / inspect
// ---------------------------------------------------------------------------

/**
 * Encode an animation to a base64-url string suitable for URL hashes.
 * Uses the bit-packed binary codec; the first byte is a format tag (0x01)
 * followed by the V1 struct.
 */
export function encodeAnimation(anim: Animation): string {
	const w = new BitWriter();
	w.writeBits(FORMAT_TAG_BINARY_V1, 8);
	AnimationCodec.encode(buildWire(anim), w);
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
	if (tag !== FORMAT_TAG_BINARY_V1) {
		throw new Error(`Unknown URL hash format (tag=0x${tag.toString(16)})`);
	}
	const r = new BitReader(bytes);
	r.readBits(8); // consume tag
	const wire = AnimationCodec.decode(r);
	assertVersion(wire.version);
	return fromWire(wire);
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
	const inner = inspect(AnimationCodec, buildWire(anim));
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
