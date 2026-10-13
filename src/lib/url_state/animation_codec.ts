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
import {
	ASPECT_RATIOS,
	DEFAULT_ASPECT_RATIO,
	DEFAULT_MAP_PROJECTION,
	isDefaultScreenAnchor,
	MAP_LAYER_GROUPS,
	MAP_PROJECTIONS,
	MAP_STYLE_IDS,
	MAP_THEMES
} from '../types';
import type {
	AnnotationStyle,
	AspectRatio,
	MapLayerGroup,
	MapProjection,
	MapStyleId,
	MapTheme,
	ScreenAnchor,
	Sun
} from '../types';
import { annotationsCodec, defaultAnnotationCodec } from './annotation_codec';
import { keyframesCodecV1, keyframesCodecV2 } from './keyframe_codec';

export const FORMAT_TAG_BINARY_V1 = 0x01;
export const FORMAT_TAG_BINARY_V2 = 0x02;

const styleCodec = enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]);
const aspectRatioCodec = enumOf(ASPECT_RATIOS as readonly [AspectRatio, ...AspectRatio[]]);
// 5 bits: room for 32 themes, so appending to MAP_THEMES keeps old links valid.
const themeCodec = enumOf(MAP_THEMES as readonly [MapTheme, ...MapTheme[]], 5);
// 2 bits: room for 4 projections.
const projectionCodec = enumOf(MAP_PROJECTIONS as readonly [MapProjection, ...MapProjection[]], 2);

/**
 * Hidden layer groups as a bitmask: bit i set = `MAP_LAYER_GROUPS[i]` is
 * hidden. 16 bits, so the list can grow by five groups without changing the
 * encoding. Bits of groups this build does not know are ignored.
 */
const HIDDEN_LAYERS_BITS = 16;
const hiddenLayersCodec: Codec<MapLayerGroup[]> = {
	encode: (groups, w) => {
		let mask = 0;
		for (const g of groups) mask |= 1 << MAP_LAYER_GROUPS.indexOf(g);
		w.writeBits(mask, HIDDEN_LAYERS_BITS);
	},
	decode: (r) => {
		const mask = r.readBits(HIDDEN_LAYERS_BITS);
		return MAP_LAYER_GROUPS.filter((_, i) => mask & (1 << i));
	}
};

/** Sun position in whole degrees: 9 bits of direction (0–359), 7 of altitude (0–90). */
const sunCodec: Codec<Sun> = {
	encode: (sun, w) => {
		w.writeBits(sun.direction, 9);
		w.writeBits(sun.altitude, 7);
	},
	decode: (r) => ({ direction: r.readBits(9) % 360, altitude: Math.min(90, r.readBits(7)) })
};

/** Screen anchor in whole percent: 7 bits each for x and y (0–100). */
const anchorCodec: Codec<ScreenAnchor> = {
	encode: (anchor, w) => {
		w.writeBits(Math.round(anchor.x * 100), 7);
		w.writeBits(Math.round(anchor.y * 100), 7);
	},
	decode: (r) => ({
		x: Math.min(100, r.readBits(7)) / 100,
		y: Math.min(100, r.readBits(7)) / 100
	})
};

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
	theme?: MapTheme;
	hiddenLayers?: MapLayerGroup[];
	buildings3d?: boolean;
	sun?: Sun;
	projection?: MapProjection;
	anchor?: ScreenAnchor;
	/** One flag per keyframe, in order: is it a waypoint? */
	waypoints?: boolean[];
	/** Hold of each keyframe in seconds, in order; 0 for none. */
	holds?: number[];
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
	},
	{
		bit: 3,
		label: 'theme',
		shouldEmit: (v) => v.theme !== undefined,
		encode: (v, w) => themeCodec.encode(v.theme!, w),
		decode: (v, r) => {
			v.theme = themeCodec.decode(r);
		}
	},
	{
		bit: 4,
		label: 'hiddenLayers',
		shouldEmit: (v) => v.hiddenLayers !== undefined && v.hiddenLayers.length > 0,
		encode: (v, w) => hiddenLayersCodec.encode(v.hiddenLayers!, w),
		decode: (v, r) => {
			v.hiddenLayers = hiddenLayersCodec.decode(r);
		}
	},
	{
		// A plain flag: the mask bit is the value, there is no payload.
		bit: 5,
		label: 'buildings3d',
		shouldEmit: (v) => v.buildings3d === true,
		encode: () => {},
		decode: (v) => {
			v.buildings3d = true;
		}
	},
	{
		bit: 6,
		label: 'sun',
		shouldEmit: (v) => v.sun !== undefined,
		encode: (v, w) => sunCodec.encode(v.sun!, w),
		decode: (v, r) => {
			v.sun = sunCodec.decode(r);
		}
	},
	{
		bit: 7,
		label: 'projection',
		shouldEmit: (v) => v.projection !== undefined && v.projection !== DEFAULT_MAP_PROJECTION,
		encode: (v, w) => projectionCodec.encode(v.projection!, w),
		decode: (v, r) => {
			v.projection = projectionCodec.decode(r);
		}
	},
	{
		bit: 8,
		label: 'anchor',
		shouldEmit: (v) => v.anchor !== undefined && !isDefaultScreenAnchor(v.anchor),
		encode: (v, w) => anchorCodec.encode(v.anchor!, w),
		decode: (v, r) => {
			v.anchor = anchorCodec.decode(r);
		}
	},
	{
		// One bit per keyframe. The keyframes come earlier in the struct, so
		// the decoder knows how many bits to read. Kept out of the keyframe
		// codec so a build from before waypoints still reads the link — it
		// just shows every keyframe as a stop.
		bit: 9,
		label: 'waypoints',
		shouldEmit: (v) => v.waypoints !== undefined && v.waypoints.some(Boolean),
		encode: (v, w) => {
			for (let i = 0; i < v.keyframes.length; i++) bool.encode(v.waypoints![i] === true, w);
		},
		decode: (v, r) => {
			v.waypoints = v.keyframes.map(() => bool.decode(r));
		}
	},
	{
		// Per keyframe a flag, and for those that have one the hold in
		// milliseconds — the unit keyframe times are stored in.
		bit: 10,
		label: 'holds',
		shouldEmit: (v) => v.holds !== undefined && v.holds.some((h) => holdMs(h) > 0),
		encode: (v, w) => {
			for (let i = 0; i < v.keyframes.length; i++) {
				const ms = holdMs(v.holds![i]);
				bool.encode(ms > 0, w);
				if (ms > 0) vuint.encode(ms, w);
			}
		},
		decode: (v, r) => {
			v.holds = v.keyframes.map(() => (bool.decode(r) ? vuint.decode(r) / 1000 : 0));
		}
	}
];

function holdMs(seconds: number | undefined): number {
	return Math.max(0, Math.round((seconds ?? 0) * 1000));
}

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
