/**
 * Bit-packed codec for the `Annotation[]` part of an Animation. Each entry
 * carries a position (mx, my), an icon, color, label, optional rotation, and
 * an optional visibility window. Encoded with an 8-bit presence mask + only
 * the changed fields, carry-forward style.
 *
 * Position uses a fixed 26-bit Mercator quantization (≈ sub-pixel at zoom 18).
 * Annotations don't move during playback, so the keyframe-style zoom-dependent
 * precision isn't worth the complexity here. Mask bits 0..7 correspond to
 * fields in declaration order: mx, my, icon, color, label, rotation,
 * visibleFrom, visibleUntil.
 */

import { type Codec, enumOf, string as stringCodec, uint, vuint } from '../codec';
import {
	ANNOTATION_ICONS,
	DEFAULT_ANNOTATION_COLOR,
	DEFAULT_ANNOTATION_ICON,
	DEFAULT_ANNOTATION_LABEL_COLOR,
	DEFAULT_LABEL_DISTANCE,
	DEFAULT_LABEL_POSITION,
	isAnnotationIcon,
	isLabelPosition,
	LABEL_POSITIONS
} from '../types';

// Halo width: ufixed at 0.1-px precision via 8-bit uint → 0..25.5 px range,
// plenty for a halo. Wider would just be silly.
import { ufixed } from '../codec';
const haloWidthCodec = ufixed(8, 10);
import type { Annotation, AnnotationIcon, LabelPosition } from '../types';
import { lngLatToMercator, mercatorToLngLat } from './mercator';

// ---------------------------------------------------------------------------
// Field codecs and constants
// ---------------------------------------------------------------------------

const ANNOTATION_POS_BITS = 26;
const ANNOTATION_POS_MAX = Math.pow(2, ANNOTATION_POS_BITS) - 1;

const annotationIconCodec = enumOf(
	ANNOTATION_ICONS as readonly [AnnotationIcon, ...AnnotationIcon[]]
);
const annotationColorCodec = uint(24); // 0xRRGGBB
const annotationRotationCodec = uint(9); // 0..511, mod 360
const annotationVisibilityCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(0, Math.round(v * 1000)), w),
	decode: (r) => vuint.decode(r) / 1000
};
// Per-annotation iconSize / labelSize: vuint of round(v * 100). Default is 1.0
// → 100, encoded in 1 byte. The annotation never wants size 0, so we clamp at 1.
const annotationSizeCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(1, Math.round(v * 100)), w),
	decode: (r) => vuint.decode(r) / 100
};
const labelPositionCodec = enumOf(LABEL_POSITIONS as readonly [LabelPosition, ...LabelPosition[]]);
// labelDistance: vuint of round(v * 100). Default 1.5 → 150 (1-byte vuint).
// 0 collapses the label onto the geo point; >5 em is silly but legal.
const labelDistanceCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(0, Math.round(v * 100)), w),
	decode: (r) => vuint.decode(r) / 100
};

// Sentinel for "always visible" — large enough that no realistic animation
// will compete with it, small enough to varint in a few bytes when emitted.
const ANNOTATION_VISIBLE_FOREVER = 86_400; // seconds = 24 h

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export interface WireAnnotation {
	mx: number;
	my: number;
	icon: AnnotationIcon;
	color: number;
	label: string;
	rotation: number;
	visibleFrom: number;
	visibleUntil: number;
	/** Default 1. Only emitted on the wire by V4+; older codecs ignore it. */
	iconSize: number;
	/** Default 1. Only emitted on the wire by V4+; older codecs ignore it. */
	labelSize: number;
	/** Default `bottom`. Only emitted on the wire by V4+. */
	labelPosition: LabelPosition;
	/** em-distance from the geo point. Default `DEFAULT_LABEL_DISTANCE` (1.5). */
	labelDistance: number;
	/** Fade-in seconds. Default 0. */
	fadeIn: number;
	/** Fade-out seconds. Default 0. */
	fadeOut: number;
	/** Label text colour as 0xRRGGBB. Default = parsed `DEFAULT_ANNOTATION_LABEL_COLOR`. */
	labelColor: number;
	/** Halo overrides; undefined means "use the default" (auto-flip / 1.5 px / off). */
	labelHaloColor: number | undefined;
	labelHaloWidth: number | undefined;
	iconHaloColor: number | undefined;
	iconHaloWidth: number | undefined;
}

const ANNOTATION_DEFAULTS: WireAnnotation = {
	mx: 0,
	my: 0,
	icon: DEFAULT_ANNOTATION_ICON,
	// Must match `parseHexColor(DEFAULT_ANNOTATION_COLOR)` so the default
	// in-memory annotation skips the color field on the wire (carry-forward).
	color: 0xcc0000,
	label: '',
	rotation: 0,
	visibleFrom: 0,
	visibleUntil: ANNOTATION_VISIBLE_FOREVER,
	iconSize: 1,
	labelSize: 1,
	labelPosition: DEFAULT_LABEL_POSITION,
	labelDistance: DEFAULT_LABEL_DISTANCE,
	fadeIn: 0,
	fadeOut: 0,
	// 0x111111 — must match parseHexColor(DEFAULT_ANNOTATION_LABEL_COLOR).
	labelColor: 0x111111,
	// `undefined` here means "use the editor/render default" — never explicitly
	// emitted on the wire; the codec compares `item !== prev` and skips when
	// both sides are undefined.
	labelHaloColor: undefined,
	labelHaloWidth: undefined,
	iconHaloColor: undefined,
	iconHaloWidth: undefined
};

export const annotationsCodec: Codec<WireAnnotation[]> = {
	encode(arr, w) {
		const ins = w.inspector;
		if (ins) ins.enter('[length]', w.totalBits());
		vuint.encode(arr.length, w);
		if (ins) ins.exit('[length]', w.totalBits());

		let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
		for (let idx = 0; idx < arr.length; idx++) {
			const item = arr[idx];
			if (ins) ins.enter(`[${idx}]`, w.totalBits());

			const mxInt = Math.round(Math.max(0, Math.min(1, item.mx)) * ANNOTATION_POS_MAX);
			const myInt = Math.round(Math.max(0, Math.min(1, item.my)) * ANNOTATION_POS_MAX);
			const prevMxInt = Math.round(prev.mx * ANNOTATION_POS_MAX);
			const prevMyInt = Math.round(prev.my * ANNOTATION_POS_MAX);

			let mask = 0;
			if (mxInt !== prevMxInt) mask |= 1 << 0;
			if (myInt !== prevMyInt) mask |= 1 << 1;
			if (item.icon !== prev.icon) mask |= 1 << 2;
			if (item.color !== prev.color) mask |= 1 << 3;
			if (item.label !== prev.label) mask |= 1 << 4;
			if (item.rotation !== prev.rotation) mask |= 1 << 5;
			if (item.visibleFrom !== prev.visibleFrom) mask |= 1 << 6;
			if (item.visibleUntil !== prev.visibleUntil) mask |= 1 << 7;

			if (ins) ins.enter('[mask]', w.totalBits());
			w.writeBits(mask, 8);
			if (ins) ins.exit('[mask]', w.totalBits());

			const writeField = <T>(name: keyof WireAnnotation, c: Codec<T>, value: T) => {
				if (ins) ins.enter(name, w.totalBits());
				c.encode(value, w);
				if (ins) ins.exit(name, w.totalBits());
			};

			if (mask & (1 << 0)) writeField('mx', uint(ANNOTATION_POS_BITS), mxInt);
			if (mask & (1 << 1)) writeField('my', uint(ANNOTATION_POS_BITS), myInt);
			if (mask & (1 << 2)) writeField('icon', annotationIconCodec, item.icon);
			if (mask & (1 << 3)) writeField('color', annotationColorCodec, item.color);
			if (mask & (1 << 4)) writeField('label', stringCodec, item.label);
			if (mask & (1 << 5)) writeField('rotation', annotationRotationCodec, item.rotation);
			if (mask & (1 << 6)) writeField('visibleFrom', annotationVisibilityCodec, item.visibleFrom);
			if (mask & (1 << 7)) writeField('visibleUntil', annotationVisibilityCodec, item.visibleUntil);

			if (ins) ins.exit(`[${idx}]`, w.totalBits());

			const next: WireAnnotation = { ...prev };
			if (mask & (1 << 0)) next.mx = mxInt / ANNOTATION_POS_MAX;
			if (mask & (1 << 1)) next.my = myInt / ANNOTATION_POS_MAX;
			if (mask & (1 << 2)) next.icon = item.icon;
			if (mask & (1 << 3)) next.color = item.color;
			if (mask & (1 << 4)) next.label = item.label;
			if (mask & (1 << 5)) next.rotation = item.rotation;
			if (mask & (1 << 6)) next.visibleFrom = item.visibleFrom;
			if (mask & (1 << 7)) next.visibleUntil = item.visibleUntil;
			prev = next;
		}
	},
	decode(r) {
		const len = vuint.decode(r);
		const out: WireAnnotation[] = [];
		let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
		for (let i = 0; i < len; i++) {
			const mask = r.readBits(8);
			const item: WireAnnotation = { ...prev };
			if (mask & (1 << 0)) item.mx = uint(ANNOTATION_POS_BITS).decode(r) / ANNOTATION_POS_MAX;
			if (mask & (1 << 1)) item.my = uint(ANNOTATION_POS_BITS).decode(r) / ANNOTATION_POS_MAX;
			if (mask & (1 << 2)) item.icon = annotationIconCodec.decode(r);
			if (mask & (1 << 3)) item.color = annotationColorCodec.decode(r);
			if (mask & (1 << 4)) item.label = stringCodec.decode(r);
			if (mask & (1 << 5)) item.rotation = annotationRotationCodec.decode(r);
			if (mask & (1 << 6)) item.visibleFrom = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 7)) item.visibleUntil = annotationVisibilityCodec.decode(r);
			out.push(item);
			prev = item;
		}
		return out;
	}
};

/**
 * V4 codec: 16-bit mask + extra fields beyond V2 — bit 8 iconSize, bit 9
 * labelSize, bit 10 labelPosition, bit 11 labelDistance, bit 12 fadeIn,
 * bit 13 fadeOut, bit 14 labelColor. Used only when at least one annotation
 * has a non-default value for any of these; V2/V3 stay byte-stable for share
 * links that don't.
 */
export const annotationsCodecV4: Codec<WireAnnotation[]> = {
	encode(arr, w) {
		const ins = w.inspector;
		if (ins) ins.enter('[length]', w.totalBits());
		vuint.encode(arr.length, w);
		if (ins) ins.exit('[length]', w.totalBits());

		let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
		for (let idx = 0; idx < arr.length; idx++) {
			const item = arr[idx];
			if (ins) ins.enter(`[${idx}]`, w.totalBits());

			const mxInt = Math.round(Math.max(0, Math.min(1, item.mx)) * ANNOTATION_POS_MAX);
			const myInt = Math.round(Math.max(0, Math.min(1, item.my)) * ANNOTATION_POS_MAX);
			const prevMxInt = Math.round(prev.mx * ANNOTATION_POS_MAX);
			const prevMyInt = Math.round(prev.my * ANNOTATION_POS_MAX);

			let mask = 0;
			if (mxInt !== prevMxInt) mask |= 1 << 0;
			if (myInt !== prevMyInt) mask |= 1 << 1;
			if (item.icon !== prev.icon) mask |= 1 << 2;
			if (item.color !== prev.color) mask |= 1 << 3;
			if (item.label !== prev.label) mask |= 1 << 4;
			if (item.rotation !== prev.rotation) mask |= 1 << 5;
			if (item.visibleFrom !== prev.visibleFrom) mask |= 1 << 6;
			if (item.visibleUntil !== prev.visibleUntil) mask |= 1 << 7;
			if (item.iconSize !== prev.iconSize) mask |= 1 << 8;
			if (item.labelSize !== prev.labelSize) mask |= 1 << 9;
			if (item.labelPosition !== prev.labelPosition) mask |= 1 << 10;
			if (item.labelDistance !== prev.labelDistance) mask |= 1 << 11;
			if (item.fadeIn !== prev.fadeIn) mask |= 1 << 12;
			if (item.fadeOut !== prev.fadeOut) mask |= 1 << 13;
			if (item.labelColor !== prev.labelColor) mask |= 1 << 14;

			if (ins) ins.enter('[mask]', w.totalBits());
			w.writeBits(mask, 16);
			if (ins) ins.exit('[mask]', w.totalBits());

			const writeField = <T>(name: keyof WireAnnotation, c: Codec<T>, value: T) => {
				if (ins) ins.enter(name, w.totalBits());
				c.encode(value, w);
				if (ins) ins.exit(name, w.totalBits());
			};

			if (mask & (1 << 0)) writeField('mx', uint(ANNOTATION_POS_BITS), mxInt);
			if (mask & (1 << 1)) writeField('my', uint(ANNOTATION_POS_BITS), myInt);
			if (mask & (1 << 2)) writeField('icon', annotationIconCodec, item.icon);
			if (mask & (1 << 3)) writeField('color', annotationColorCodec, item.color);
			if (mask & (1 << 4)) writeField('label', stringCodec, item.label);
			if (mask & (1 << 5)) writeField('rotation', annotationRotationCodec, item.rotation);
			if (mask & (1 << 6)) writeField('visibleFrom', annotationVisibilityCodec, item.visibleFrom);
			if (mask & (1 << 7)) writeField('visibleUntil', annotationVisibilityCodec, item.visibleUntil);
			if (mask & (1 << 8)) writeField('iconSize', annotationSizeCodec, item.iconSize);
			if (mask & (1 << 9)) writeField('labelSize', annotationSizeCodec, item.labelSize);
			if (mask & (1 << 10)) writeField('labelPosition', labelPositionCodec, item.labelPosition);
			if (mask & (1 << 11)) writeField('labelDistance', labelDistanceCodec, item.labelDistance);
			if (mask & (1 << 12)) writeField('fadeIn', annotationVisibilityCodec, item.fadeIn);
			if (mask & (1 << 13)) writeField('fadeOut', annotationVisibilityCodec, item.fadeOut);
			if (mask & (1 << 14)) writeField('labelColor', annotationColorCodec, item.labelColor);

			if (ins) ins.exit(`[${idx}]`, w.totalBits());

			const next: WireAnnotation = { ...prev };
			if (mask & (1 << 0)) next.mx = mxInt / ANNOTATION_POS_MAX;
			if (mask & (1 << 1)) next.my = myInt / ANNOTATION_POS_MAX;
			if (mask & (1 << 2)) next.icon = item.icon;
			if (mask & (1 << 3)) next.color = item.color;
			if (mask & (1 << 4)) next.label = item.label;
			if (mask & (1 << 5)) next.rotation = item.rotation;
			if (mask & (1 << 6)) next.visibleFrom = item.visibleFrom;
			if (mask & (1 << 7)) next.visibleUntil = item.visibleUntil;
			if (mask & (1 << 8)) next.iconSize = item.iconSize;
			if (mask & (1 << 9)) next.labelSize = item.labelSize;
			if (mask & (1 << 10)) next.labelPosition = item.labelPosition;
			if (mask & (1 << 11)) next.labelDistance = item.labelDistance;
			if (mask & (1 << 12)) next.fadeIn = item.fadeIn;
			if (mask & (1 << 13)) next.fadeOut = item.fadeOut;
			if (mask & (1 << 14)) next.labelColor = item.labelColor;
			prev = next;
		}
	},
	decode(r) {
		const len = vuint.decode(r);
		const out: WireAnnotation[] = [];
		let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
		for (let i = 0; i < len; i++) {
			const mask = r.readBits(16);
			const item: WireAnnotation = { ...prev };
			if (mask & (1 << 0)) item.mx = uint(ANNOTATION_POS_BITS).decode(r) / ANNOTATION_POS_MAX;
			if (mask & (1 << 1)) item.my = uint(ANNOTATION_POS_BITS).decode(r) / ANNOTATION_POS_MAX;
			if (mask & (1 << 2)) item.icon = annotationIconCodec.decode(r);
			if (mask & (1 << 3)) item.color = annotationColorCodec.decode(r);
			if (mask & (1 << 4)) item.label = stringCodec.decode(r);
			if (mask & (1 << 5)) item.rotation = annotationRotationCodec.decode(r);
			if (mask & (1 << 6)) item.visibleFrom = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 7)) item.visibleUntil = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 8)) item.iconSize = annotationSizeCodec.decode(r);
			if (mask & (1 << 9)) item.labelSize = annotationSizeCodec.decode(r);
			if (mask & (1 << 10)) item.labelPosition = labelPositionCodec.decode(r);
			if (mask & (1 << 11)) item.labelDistance = labelDistanceCodec.decode(r);
			if (mask & (1 << 12)) item.fadeIn = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 13)) item.fadeOut = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 14)) item.labelColor = annotationColorCodec.decode(r);
			out.push(item);
			prev = item;
		}
		return out;
	}
};

/**
 * V5 codec: 24-bit mask + four extra fields beyond V4 — bit 15 labelHaloColor,
 * bit 16 labelHaloWidth, bit 17 iconHaloColor, bit 18 iconHaloWidth. Used
 * only when at least one annotation customises a halo; V4 stays byte-stable
 * for share links that don't use these features.
 *
 * Halo colour fields use `number | undefined` (undefined = "use default").
 * The mask bit serves as the presence indicator: when 0, the field stays
 * undefined and MapStage falls back to the auto-flip (labels) / off (icons)
 * default.
 */
export const annotationsCodecV5: Codec<WireAnnotation[]> = {
	encode(arr, w) {
		const ins = w.inspector;
		if (ins) ins.enter('[length]', w.totalBits());
		vuint.encode(arr.length, w);
		if (ins) ins.exit('[length]', w.totalBits());

		let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
		for (let idx = 0; idx < arr.length; idx++) {
			const item = arr[idx];
			if (ins) ins.enter(`[${idx}]`, w.totalBits());

			const mxInt = Math.round(Math.max(0, Math.min(1, item.mx)) * ANNOTATION_POS_MAX);
			const myInt = Math.round(Math.max(0, Math.min(1, item.my)) * ANNOTATION_POS_MAX);
			const prevMxInt = Math.round(prev.mx * ANNOTATION_POS_MAX);
			const prevMyInt = Math.round(prev.my * ANNOTATION_POS_MAX);

			let mask = 0;
			if (mxInt !== prevMxInt) mask |= 1 << 0;
			if (myInt !== prevMyInt) mask |= 1 << 1;
			if (item.icon !== prev.icon) mask |= 1 << 2;
			if (item.color !== prev.color) mask |= 1 << 3;
			if (item.label !== prev.label) mask |= 1 << 4;
			if (item.rotation !== prev.rotation) mask |= 1 << 5;
			if (item.visibleFrom !== prev.visibleFrom) mask |= 1 << 6;
			if (item.visibleUntil !== prev.visibleUntil) mask |= 1 << 7;
			if (item.iconSize !== prev.iconSize) mask |= 1 << 8;
			if (item.labelSize !== prev.labelSize) mask |= 1 << 9;
			if (item.labelPosition !== prev.labelPosition) mask |= 1 << 10;
			if (item.labelDistance !== prev.labelDistance) mask |= 1 << 11;
			if (item.fadeIn !== prev.fadeIn) mask |= 1 << 12;
			if (item.fadeOut !== prev.fadeOut) mask |= 1 << 13;
			if (item.labelColor !== prev.labelColor) mask |= 1 << 14;
			// Halo fields don't carry forward — each annotation's halo override
			// is independent. The mask bit means "present" (vs undefined =
			// use default). Without this carve-out, going from a halo-set
			// annotation back to a default one would set the mask but try to
			// encode `undefined`.
			if (item.labelHaloColor !== undefined) mask |= 1 << 15;
			if (item.labelHaloWidth !== undefined) mask |= 1 << 16;
			if (item.iconHaloColor !== undefined) mask |= 1 << 17;
			if (item.iconHaloWidth !== undefined) mask |= 1 << 18;

			if (ins) ins.enter('[mask]', w.totalBits());
			w.writeBits(mask, 24);
			if (ins) ins.exit('[mask]', w.totalBits());

			const writeField = <T>(name: keyof WireAnnotation, c: Codec<T>, value: T) => {
				if (ins) ins.enter(name, w.totalBits());
				c.encode(value, w);
				if (ins) ins.exit(name, w.totalBits());
			};

			if (mask & (1 << 0)) writeField('mx', uint(ANNOTATION_POS_BITS), mxInt);
			if (mask & (1 << 1)) writeField('my', uint(ANNOTATION_POS_BITS), myInt);
			if (mask & (1 << 2)) writeField('icon', annotationIconCodec, item.icon);
			if (mask & (1 << 3)) writeField('color', annotationColorCodec, item.color);
			if (mask & (1 << 4)) writeField('label', stringCodec, item.label);
			if (mask & (1 << 5)) writeField('rotation', annotationRotationCodec, item.rotation);
			if (mask & (1 << 6)) writeField('visibleFrom', annotationVisibilityCodec, item.visibleFrom);
			if (mask & (1 << 7)) writeField('visibleUntil', annotationVisibilityCodec, item.visibleUntil);
			if (mask & (1 << 8)) writeField('iconSize', annotationSizeCodec, item.iconSize);
			if (mask & (1 << 9)) writeField('labelSize', annotationSizeCodec, item.labelSize);
			if (mask & (1 << 10)) writeField('labelPosition', labelPositionCodec, item.labelPosition);
			if (mask & (1 << 11)) writeField('labelDistance', labelDistanceCodec, item.labelDistance);
			if (mask & (1 << 12)) writeField('fadeIn', annotationVisibilityCodec, item.fadeIn);
			if (mask & (1 << 13)) writeField('fadeOut', annotationVisibilityCodec, item.fadeOut);
			if (mask & (1 << 14)) writeField('labelColor', annotationColorCodec, item.labelColor);
			if (mask & (1 << 15))
				writeField('labelHaloColor', annotationColorCodec, item.labelHaloColor!);
			if (mask & (1 << 16)) writeField('labelHaloWidth', haloWidthCodec, item.labelHaloWidth!);
			if (mask & (1 << 17)) writeField('iconHaloColor', annotationColorCodec, item.iconHaloColor!);
			if (mask & (1 << 18)) writeField('iconHaloWidth', haloWidthCodec, item.iconHaloWidth!);

			if (ins) ins.exit(`[${idx}]`, w.totalBits());

			const next: WireAnnotation = { ...prev };
			if (mask & (1 << 0)) next.mx = mxInt / ANNOTATION_POS_MAX;
			if (mask & (1 << 1)) next.my = myInt / ANNOTATION_POS_MAX;
			if (mask & (1 << 2)) next.icon = item.icon;
			if (mask & (1 << 3)) next.color = item.color;
			if (mask & (1 << 4)) next.label = item.label;
			if (mask & (1 << 5)) next.rotation = item.rotation;
			if (mask & (1 << 6)) next.visibleFrom = item.visibleFrom;
			if (mask & (1 << 7)) next.visibleUntil = item.visibleUntil;
			if (mask & (1 << 8)) next.iconSize = item.iconSize;
			if (mask & (1 << 9)) next.labelSize = item.labelSize;
			if (mask & (1 << 10)) next.labelPosition = item.labelPosition;
			if (mask & (1 << 11)) next.labelDistance = item.labelDistance;
			if (mask & (1 << 12)) next.fadeIn = item.fadeIn;
			if (mask & (1 << 13)) next.fadeOut = item.fadeOut;
			if (mask & (1 << 14)) next.labelColor = item.labelColor;
			// Halo fields are per-annotation only — `prev`'s halo state is
			// always `undefined`, so the next iteration's "present" check
			// matches the encoder.
			next.labelHaloColor = undefined;
			next.labelHaloWidth = undefined;
			next.iconHaloColor = undefined;
			next.iconHaloWidth = undefined;
			prev = next;
		}
	},
	decode(r) {
		const len = vuint.decode(r);
		const out: WireAnnotation[] = [];
		let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
		for (let i = 0; i < len; i++) {
			const mask = r.readBits(24);
			const item: WireAnnotation = { ...prev };
			if (mask & (1 << 0)) item.mx = uint(ANNOTATION_POS_BITS).decode(r) / ANNOTATION_POS_MAX;
			if (mask & (1 << 1)) item.my = uint(ANNOTATION_POS_BITS).decode(r) / ANNOTATION_POS_MAX;
			if (mask & (1 << 2)) item.icon = annotationIconCodec.decode(r);
			if (mask & (1 << 3)) item.color = annotationColorCodec.decode(r);
			if (mask & (1 << 4)) item.label = stringCodec.decode(r);
			if (mask & (1 << 5)) item.rotation = annotationRotationCodec.decode(r);
			if (mask & (1 << 6)) item.visibleFrom = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 7)) item.visibleUntil = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 8)) item.iconSize = annotationSizeCodec.decode(r);
			if (mask & (1 << 9)) item.labelSize = annotationSizeCodec.decode(r);
			if (mask & (1 << 10)) item.labelPosition = labelPositionCodec.decode(r);
			if (mask & (1 << 11)) item.labelDistance = labelDistanceCodec.decode(r);
			if (mask & (1 << 12)) item.fadeIn = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 13)) item.fadeOut = annotationVisibilityCodec.decode(r);
			if (mask & (1 << 14)) item.labelColor = annotationColorCodec.decode(r);
			// Halo fields: per-annotation only — explicit-undefined when bit unset.
			item.labelHaloColor = mask & (1 << 15) ? annotationColorCodec.decode(r) : undefined;
			item.labelHaloWidth = mask & (1 << 16) ? haloWidthCodec.decode(r) : undefined;
			item.iconHaloColor = mask & (1 << 17) ? annotationColorCodec.decode(r) : undefined;
			item.iconHaloWidth = mask & (1 << 18) ? haloWidthCodec.decode(r) : undefined;
			out.push(item);
			prev = item;
		}
		return out;
	}
};

// ---------------------------------------------------------------------------
// Hex colour helpers — wire stores RGB as a 24-bit int; in-memory keeps the
// user's `#rrggbb` string so the UI can round-trip arbitrary case/format.
// ---------------------------------------------------------------------------

function parseHexColor(input: string): number {
	const hex = input.trim().replace(/^#/, '');
	let r: number, g: number, b: number;
	if (hex.length === 3) {
		r = parseInt(hex[0] + hex[0], 16);
		g = parseInt(hex[1] + hex[1], 16);
		b = parseInt(hex[2] + hex[2], 16);
	} else if (hex.length === 6) {
		r = parseInt(hex.slice(0, 2), 16);
		g = parseInt(hex.slice(2, 4), 16);
		b = parseInt(hex.slice(4, 6), 16);
	} else {
		// Fall back to the default rather than throwing — annotations should
		// survive a malformed colour rather than break the whole URL decode.
		return parseHexColor(DEFAULT_ANNOTATION_COLOR);
	}
	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
		return parseHexColor(DEFAULT_ANNOTATION_COLOR);
	}
	return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

function formatHexColor(rgb: number): string {
	return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Wire ↔ application conversions
// ---------------------------------------------------------------------------

export function normalizeAnnotation(ann: Annotation): WireAnnotation {
	const { mx, my } = lngLatToMercator(ann.lng, ann.lat);
	const icon: AnnotationIcon = isAnnotationIcon(ann.icon) ? ann.icon : DEFAULT_ANNOTATION_ICON;
	const rotation = ((((ann.rotation ?? 0) % 360) + 360) % 360) % 360;
	const visibleFrom = Math.max(0, ann.visibleFrom ?? 0);
	const visibleUntilRaw = ann.visibleUntil;
	const visibleUntil =
		visibleUntilRaw == null || !Number.isFinite(visibleUntilRaw)
			? ANNOTATION_VISIBLE_FOREVER
			: Math.max(visibleFrom, visibleUntilRaw);
	return {
		mx,
		my,
		icon,
		color: parseHexColor(ann.color ?? DEFAULT_ANNOTATION_COLOR),
		label: ann.label ?? '',
		rotation,
		visibleFrom,
		visibleUntil,
		iconSize: ann.iconSize ?? 1,
		labelSize: ann.labelSize ?? 1,
		labelPosition: isLabelPosition(ann.labelPosition) ? ann.labelPosition : DEFAULT_LABEL_POSITION,
		labelDistance: Math.max(0, ann.labelDistance ?? DEFAULT_LABEL_DISTANCE),
		fadeIn: Math.max(0, ann.fadeIn ?? 0),
		fadeOut: Math.max(0, ann.fadeOut ?? 0),
		labelColor: parseHexColor(ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR),
		labelHaloColor: ann.labelHaloColor != null ? parseHexColor(ann.labelHaloColor) : undefined,
		labelHaloWidth: ann.labelHaloWidth != null ? Math.max(0, ann.labelHaloWidth) : undefined,
		iconHaloColor: ann.iconHaloColor != null ? parseHexColor(ann.iconHaloColor) : undefined,
		iconHaloWidth: ann.iconHaloWidth != null ? Math.max(0, ann.iconHaloWidth) : undefined
	};
}

export function denormalizeAnnotation(wire: WireAnnotation): Annotation {
	const { lng, lat } = mercatorToLngLat(wire.mx, wire.my);
	const out: Annotation = {
		lng,
		lat,
		icon: wire.icon,
		color: formatHexColor(wire.color),
		label: wire.label
	};
	if (wire.rotation !== 0) out.rotation = wire.rotation;
	if (wire.visibleFrom !== 0) out.visibleFrom = wire.visibleFrom;
	if (wire.visibleUntil < ANNOTATION_VISIBLE_FOREVER) out.visibleUntil = wire.visibleUntil;
	if (wire.iconSize !== 1) out.iconSize = wire.iconSize;
	if (wire.labelSize !== 1) out.labelSize = wire.labelSize;
	if (wire.labelPosition !== DEFAULT_LABEL_POSITION) out.labelPosition = wire.labelPosition;
	if (wire.labelDistance !== DEFAULT_LABEL_DISTANCE) out.labelDistance = wire.labelDistance;
	if (wire.fadeIn !== 0) out.fadeIn = wire.fadeIn;
	if (wire.fadeOut !== 0) out.fadeOut = wire.fadeOut;
	if (wire.labelColor !== 0x111111) out.labelColor = formatHexColor(wire.labelColor);
	if (wire.labelHaloColor !== undefined) out.labelHaloColor = formatHexColor(wire.labelHaloColor);
	if (wire.labelHaloWidth !== undefined) out.labelHaloWidth = wire.labelHaloWidth;
	if (wire.iconHaloColor !== undefined) out.iconHaloColor = formatHexColor(wire.iconHaloColor);
	if (wire.iconHaloWidth !== undefined) out.iconHaloWidth = wire.iconHaloWidth;
	return out;
}
