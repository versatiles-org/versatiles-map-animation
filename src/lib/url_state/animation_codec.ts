/**
 * Top-level Animation struct (V1 and V2) and the format-tag table.
 *
 * Wire format:
 *   tag byte → version | style | labels | terrain | sky |
 *              keyframes | annotations | options-mask + opt fields
 *
 * The options mask is a bitfield at the end of the struct gating features
 * that have a sensible default. The default-only animation pays for the
 * mask and nothing else; opting into a feature adds its own field. Adding
 * a future option means: pick a free bit, write a codec, add one row to
 * OPTIONS below.
 *
 * The two formats differ in exactly two widths:
 *
 *   | tag  | options mask | keyframe `path`                  |
 *   | 0x01 | 8 bits       | 1 bit (`arc`, `linear`)          |
 *   | 0x02 | 16 bits      | 2 bits (index into PATH_STYLES)  |
 *
 * V2 is what the encoder writes. V1 is decode-only, so links shared before
 * V2 keep working.
 *
 * **Versioning rule**: bump the format tag (and add a new codec) only if a
 * change would cause an old decoder to misread the bytes — changing an
 * existing field's encoding, changing what an existing field *means*,
 * removing a field that older animations relied on, or running out of room
 * in the options mask. Adding a new optional feature is *not* a version
 * bump — extend OPTIONS instead.
 */

import { bool, type Codec, enumOf, struct, uint, vuint } from '../codec';
import { ASPECT_RATIOS, DEFAULT_ASPECT_RATIO, MAP_STYLE_IDS } from '../types';
import type { AnnotationStyle, AspectRatio, MapStyleId } from '../types';
import { annotationsCodec, defaultAnnotationCodec } from './annotation_codec';
import { keyframesCodecV1, keyframesCodecV2 } from './keyframe_codec';

export const FORMAT_TAG_BINARY_V1 = 0x01;
export const FORMAT_TAG_BINARY_V2 = 0x02;

const styleCodec = enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]);
const aspectRatioCodec = enumOf(ASPECT_RATIOS as readonly [AspectRatio, ...AspectRatio[]]);

/** Animation-level scale: vuint of round(scale*100). Default 1.0 → 100. */
const annotationScaleCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(1, Math.round(v * 100)), w),
	decode: (r) => vuint.decode(r) / 100
};

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

/**
 * Wire-shape representation of an Animation. The codec walks the struct
 * fields in declaration order and then the options mask + present option
 * payloads, so field order here matters.
 */
type WireAnimation = {
	version: number;
	style: MapStyleId;
	labels: boolean;
	terrain: boolean;
	sky: boolean;
	keyframes: ReturnType<typeof keyframesCodecV2.decode>;
	annotations: ReturnType<typeof annotationsCodec.decode>;
	annotationScale?: number;
	aspectRatio?: AspectRatio;
	defaultAnnotation?: Partial<AnnotationStyle>;
};

// ---------------------------------------------------------------------------
// Options mask: extend by adding rows here
// ---------------------------------------------------------------------------

interface AnimOption {
	bit: number;
	label: string;
	shouldEmit(value: WireAnimation): boolean;
	encode(value: WireAnimation, w: import('../codec').BitWriter): void;
	decode(value: WireAnimation, r: import('../codec').BitReader): void;
}

const OPTIONS: AnimOption[] = [
	{
		bit: 0,
		label: 'annotationScale',
		shouldEmit: (v) => v.annotationScale !== undefined && v.annotationScale !== 1,
		encode: (v, w) => annotationScaleCodec.encode(v.annotationScale!, w),
		decode: (v, r) => {
			v.annotationScale = annotationScaleCodec.decode(r);
		}
	},
	{
		bit: 1,
		label: 'aspectRatio',
		shouldEmit: (v) => v.aspectRatio !== undefined && v.aspectRatio !== DEFAULT_ASPECT_RATIO,
		encode: (v, w) => aspectRatioCodec.encode(v.aspectRatio!, w),
		decode: (v, r) => {
			v.aspectRatio = aspectRatioCodec.decode(r);
		}
	},
	{
		bit: 2,
		label: 'defaultAnnotation',
		shouldEmit: (v) =>
			v.defaultAnnotation !== undefined && Object.keys(v.defaultAnnotation).length > 0,
		encode: (v, w) => defaultAnnotationCodec.encode(v.defaultAnnotation!, w),
		decode: (v, r) => {
			v.defaultAnnotation = defaultAnnotationCodec.decode(r);
		}
	}
];

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

function makeAnimationCodec(
	keyframesCodec: Codec<WireAnimation['keyframes']>,
	optionsMaskBits: number
): Codec<WireAnimation> {
	const baseCodec = struct({
		version: uint(4),
		style: styleCodec,
		labels: bool,
		terrain: bool,
		sky: bool,
		keyframes: keyframesCodec,
		annotations: annotationsCodec
	});

	return {
		encode(value, w) {
			baseCodec.encode(
				{
					version: value.version,
					style: value.style,
					labels: value.labels,
					terrain: value.terrain,
					sky: value.sky,
					keyframes: value.keyframes,
					annotations: value.annotations
				},
				w
			);

			let mask = 0;
			for (const o of OPTIONS) {
				if (!o.shouldEmit(value)) continue;
				if (o.bit >= optionsMaskBits) {
					throw new Error(`option '${o.label}' does not fit a ${optionsMaskBits}-bit options mask`);
				}
				mask |= 1 << o.bit;
			}

			w.frame('[options-mask]', () => w.writeBits(mask, optionsMaskBits));
			for (const o of OPTIONS) {
				if (mask & (1 << o.bit)) w.frame(o.label, () => o.encode(value, w));
			}
		},
		decode(r) {
			const base = baseCodec.decode(r);
			const value: WireAnimation = { ...base };
			const mask = r.readBits(optionsMaskBits);
			for (const o of OPTIONS) {
				if (mask & (1 << o.bit)) o.decode(value, r);
			}
			return value;
		}
	};
}

/** Decode-only: what links written before V2 carry. */
export const AnimationCodecV1 = makeAnimationCodec(keyframesCodecV1, 8);
/** The current format; `AnimationCodec` is what the encoder writes. */
export const AnimationCodecV2 = makeAnimationCodec(keyframesCodecV2, 16);
export const AnimationCodec = AnimationCodecV2;
export const FORMAT_TAG_BINARY = FORMAT_TAG_BINARY_V2;
