/**
 * Top-level Animation structs (V1 / V2 / V3 / V4) and the format-tag table.
 *
 * Format tags (first byte of the encoded payload):
 *   0x01: V1 — keyframes only
 *   0x02: V2 — adds annotations[]
 *   0x03: V3 — adds animation-level annotationScale
 *   0x04: V4 — extends each annotation with iconSize + labelSize
 *
 * Older versions are kept for byte-stable share links: an animation that
 * doesn't use a feature stays at the smallest version that fits.
 */

import { bool, type Codec, enumOf, struct, uint, vuint } from '../codec';
import { MAP_STYLE_IDS } from '../types';
import type { MapStyleId } from '../types';
import { annotationsCodec, annotationsCodecV4 } from './annotation_codec';
import { keyframesCodec } from './keyframe_codec';

export const FORMAT_TAG_BINARY_V1 = 0x01;
export const FORMAT_TAG_BINARY_V2 = 0x02;
export const FORMAT_TAG_BINARY_V3 = 0x03;
export const FORMAT_TAG_BINARY_V4 = 0x04;

const styleCodec = enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]);

export const AnimationCodecV1 = struct({
	version: uint(4),
	style: styleCodec,
	terrain: bool,
	keyframes: keyframesCodec
});

export const AnimationCodecV2 = struct({
	version: uint(4),
	style: styleCodec,
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
	terrain: bool,
	keyframes: keyframesCodec,
	annotations: annotationsCodecV4,
	annotationScale: annotationScaleCodec
});
