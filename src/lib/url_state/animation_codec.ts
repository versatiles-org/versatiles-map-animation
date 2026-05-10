/**
 * Top-level Animation structs (V1 / V2 / V3 / V4 / V5) and the format-tag table.
 *
 * Format tags (first byte of the encoded payload):
 *   0x01: V1 — keyframes only
 *   0x02: V2 — adds annotations[]
 *   0x03: V3 — adds animation-level annotationScale
 *   0x04: V4 — per-annotation sizes / labelPosition / fades / labelColor
 *   0x05: V5 — per-annotation halo customisation (label + icon, color + width)
 *
 * Older versions are kept for byte-stable share links: an animation that
 * doesn't use a feature stays at the smallest version that fits.
 */

import { bool, type Codec, enumOf, struct, uint, vuint } from '../codec';
import { MAP_STYLE_IDS } from '../types';
import type { MapStyleId } from '../types';
import { annotationsCodec, annotationsCodecV4, annotationsCodecV5 } from './annotation_codec';
import { keyframesCodec } from './keyframe_codec';

export const FORMAT_TAG_BINARY_V1 = 0x01;
export const FORMAT_TAG_BINARY_V2 = 0x02;
export const FORMAT_TAG_BINARY_V3 = 0x03;
export const FORMAT_TAG_BINARY_V4 = 0x04;
export const FORMAT_TAG_BINARY_V5 = 0x05;

const styleCodec = enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]);

// `labels` is animation-wide: shows place names / road shields on `colorful`,
// or the colorful overlay on top of `satellite` imagery. 1 bit per encoding.
export const AnimationCodecV1 = struct({
	version: uint(4),
	style: styleCodec,
	labels: bool,
	terrain: bool,
	keyframes: keyframesCodec
});

export const AnimationCodecV2 = struct({
	version: uint(4),
	style: styleCodec,
	labels: bool,
	terrain: bool,
	keyframes: keyframesCodec,
	annotations: annotationsCodec
});

// V3 adds an animation-level `annotationScale` (vuint of round(scale*100)).
// Stored last so the V2 prefix is still parseable bit-by-bit; we only emit V3
// when the scale differs from the default, so default-scale animations stay V2.
export const annotationScaleCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(1, Math.round(v * 100)), w),
	decode: (r) => vuint.decode(r) / 100
};

export const AnimationCodecV3 = struct({
	version: uint(4),
	style: styleCodec,
	labels: bool,
	terrain: bool,
	keyframes: keyframesCodec,
	annotations: annotationsCodec,
	annotationScale: annotationScaleCodec
});

// V4: same shape as V3 but the annotations array uses the wider 16-bit-mask
// codec that carries per-annotation iconSize + labelSize. annotationScale is
// always present so V4 can also represent V3's feature.
export const AnimationCodecV4 = struct({
	version: uint(4),
	style: styleCodec,
	labels: bool,
	terrain: bool,
	keyframes: keyframesCodec,
	annotations: annotationsCodecV4,
	annotationScale: annotationScaleCodec
});

// V5: same shape as V4 but the annotations array uses the 24-bit-mask codec
// with per-annotation halo customisation (label + icon, color + width).
export const AnimationCodecV5 = struct({
	version: uint(4),
	style: styleCodec,
	labels: bool,
	terrain: bool,
	keyframes: keyframesCodec,
	annotations: annotationsCodecV5,
	annotationScale: annotationScaleCodec
});
