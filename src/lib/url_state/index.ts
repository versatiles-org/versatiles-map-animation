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
 * the smallest sufficient version. The full version table lives in `VERSIONS`
 * below — each entry knows its tag, its codec, whether the current animation
 * needs it, how to build a wire payload, and how to read one back. That single
 * table drives encode, decode, and inspect.
 */

import { base64UrlToBytes, BitReader, BitWriter, bytesToBase64Url, inspect } from '../codec';
import type { Codec, InspectionNode } from '../codec';
import {
	DEFAULT_ANNOTATION_LABEL_COLOR,
	DEFAULT_ANNOTATION_SCALE,
	DEFAULT_LABEL_DISTANCE,
	DEFAULT_LABEL_POSITION,
	SCHEMA_VERSION
} from '../types';
import type { Animation } from '../types';
import {
	AnimationCodecV1,
	AnimationCodecV2,
	AnimationCodecV3,
	AnimationCodecV4,
	AnimationCodecV5,
	FORMAT_TAG_BINARY_V1,
	FORMAT_TAG_BINARY_V2,
	FORMAT_TAG_BINARY_V3,
	FORMAT_TAG_BINARY_V4,
	FORMAT_TAG_BINARY_V5
} from './animation_codec';
import { denormalizeAnnotation, normalizeAnnotation } from './annotation_codec';
import { denormalizeKeyframe, normalizeKeyframe } from './keyframe_codec';

const HASH_KEY = 'kf';
const STORAGE_KEY = 'versatiles-map-animation';

// ---------------------------------------------------------------------------
// Version table
// ---------------------------------------------------------------------------

interface VersionEntry {
	tag: number;
	codec: Codec<unknown>;
	/** True when this version is required to round-trip `anim` losslessly. */
	needs(anim: Animation, scale: number): boolean;
	/** Build the wire-shape payload that this version's codec accepts. */
	build(anim: Animation, scale: number): unknown;
	/** Reverse: turn a decoded wire payload into an Animation. */
	toAnimation(wire: unknown): Animation;
}

function hasAnnotations(anim: Animation): boolean {
	return Boolean(anim.annotations && anim.annotations.length > 0);
}

function needsHalo(a: Animation['annotations'][number]): boolean {
	return (
		a.labelHaloColor !== undefined ||
		a.labelHaloWidth !== undefined ||
		a.iconHaloColor !== undefined ||
		a.iconHaloWidth !== undefined
	);
}

function needsV4Extras(a: Animation['annotations'][number]): boolean {
	return (
		(a.iconSize ?? 1) !== 1 ||
		(a.labelSize ?? 1) !== 1 ||
		(a.labelPosition ?? DEFAULT_LABEL_POSITION) !== DEFAULT_LABEL_POSITION ||
		(a.labelDistance ?? DEFAULT_LABEL_DISTANCE) !== DEFAULT_LABEL_DISTANCE ||
		(a.fadeIn ?? 0) !== 0 ||
		(a.fadeOut ?? 0) !== 0 ||
		(a.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR) !== DEFAULT_ANNOTATION_LABEL_COLOR
	);
}

function commonWire(anim: Animation) {
	return {
		version: anim.version,
		style: anim.style,
		labels: anim.labels,
		terrain: anim.terrain,
		sky: anim.sky,
		keyframes: anim.keyframes.map(normalizeKeyframe)
	};
}

type WireWithAnnotations = ReturnType<typeof commonWire> & {
	annotations: ReturnType<typeof normalizeAnnotation>[];
	annotationScale?: number;
};

function fromWire(wire: WireWithAnnotations, scale: number): Animation {
	return {
		version: SCHEMA_VERSION,
		style: wire.style,
		labels: wire.labels,
		terrain: wire.terrain,
		sky: wire.sky,
		keyframes: wire.keyframes.map(denormalizeKeyframe),
		annotations: wire.annotations.map(denormalizeAnnotation),
		annotationScale: scale
	};
}

/**
 * Versions are listed highest-first. `encodeAnimation` walks the table and
 * picks the first entry whose `needs(...)` returns true; the last entry (V1)
 * has `needs: () => true`, acting as the fallback. Adding a new format
 * version means adding one row here — encode, decode, and inspect all see it
 * automatically.
 */
const VERSIONS: VersionEntry[] = [
	{
		tag: FORMAT_TAG_BINARY_V5,
		codec: AnimationCodecV5 as Codec<unknown>,
		needs: (anim) => hasAnnotations(anim) && anim.annotations.some(needsHalo),
		build: (anim, scale) => ({
			...commonWire(anim),
			annotations: anim.annotations.map(normalizeAnnotation),
			annotationScale: scale
		}),
		toAnimation: (wire) =>
			fromWire(wire as WireWithAnnotations, (wire as WireWithAnnotations).annotationScale!)
	},
	{
		tag: FORMAT_TAG_BINARY_V4,
		codec: AnimationCodecV4 as Codec<unknown>,
		needs: (anim) => hasAnnotations(anim) && anim.annotations.some(needsV4Extras),
		build: (anim, scale) => ({
			...commonWire(anim),
			annotations: anim.annotations.map(normalizeAnnotation),
			annotationScale: scale
		}),
		toAnimation: (wire) =>
			fromWire(wire as WireWithAnnotations, (wire as WireWithAnnotations).annotationScale!)
	},
	{
		tag: FORMAT_TAG_BINARY_V3,
		codec: AnimationCodecV3 as Codec<unknown>,
		needs: (anim, scale) => hasAnnotations(anim) && scale !== DEFAULT_ANNOTATION_SCALE,
		build: (anim, scale) => ({
			...commonWire(anim),
			annotations: anim.annotations.map(normalizeAnnotation),
			annotationScale: scale
		}),
		toAnimation: (wire) =>
			fromWire(wire as WireWithAnnotations, (wire as WireWithAnnotations).annotationScale!)
	},
	{
		tag: FORMAT_TAG_BINARY_V2,
		codec: AnimationCodecV2 as Codec<unknown>,
		needs: (anim) => hasAnnotations(anim),
		build: (anim) => ({
			...commonWire(anim),
			annotations: anim.annotations.map(normalizeAnnotation)
		}),
		toAnimation: (wire) => fromWire(wire as WireWithAnnotations, DEFAULT_ANNOTATION_SCALE)
	},
	{
		tag: FORMAT_TAG_BINARY_V1,
		codec: AnimationCodecV1 as Codec<unknown>,
		needs: () => true,
		build: (anim) => commonWire(anim),
		toAnimation: (wire) => {
			const w = wire as ReturnType<typeof commonWire>;
			return {
				version: SCHEMA_VERSION,
				style: w.style,
				labels: w.labels,
				terrain: w.terrain,
				sky: w.sky,
				keyframes: w.keyframes.map(denormalizeKeyframe),
				annotations: [],
				annotationScale: DEFAULT_ANNOTATION_SCALE
			};
		}
	}
];

function pickVersion(anim: Animation): VersionEntry {
	const scale = anim.annotationScale ?? DEFAULT_ANNOTATION_SCALE;
	// First entry whose `needs` matches; the last entry is the always-true fallback.
	for (const entry of VERSIONS) if (entry.needs(anim, scale)) return entry;
	return VERSIONS[VERSIONS.length - 1];
}

// ---------------------------------------------------------------------------
// Encode / decode / inspect
// ---------------------------------------------------------------------------

/**
 * Encode an animation to a base64-url string suitable for URL hashes.
 * Uses the bit-packed binary codec; the first byte is a format tag so the
 * decoder can pick the right struct. Picks the smallest sufficient version
 * from the table at the top of this file. Older binary versions stay
 * byte-stable so existing share links don't change.
 */
export function encodeAnimation(anim: Animation): string {
	const w = new BitWriter();
	const scale = anim.annotationScale ?? DEFAULT_ANNOTATION_SCALE;
	const entry = pickVersion(anim);
	w.writeBits(entry.tag, 8);
	entry.codec.encode(entry.build(anim, scale), w);
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
	const entry = VERSIONS.find((v) => v.tag === tag);
	if (!entry) throw new Error(`Unknown URL hash format (tag=0x${tag.toString(16)})`);
	const r = new BitReader(bytes);
	r.readBits(8); // consume tag
	const wire = entry.codec.decode(r) as { version: number };
	assertVersion(wire.version);
	return entry.toAnimation(wire);
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
	const entry = pickVersion(anim);
	const inner = inspect(entry.codec, entry.build(anim, scale));
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
