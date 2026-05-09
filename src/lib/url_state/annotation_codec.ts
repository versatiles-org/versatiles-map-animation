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
	DEFAULT_LABEL_DISTANCE,
	DEFAULT_LABEL_POSITION,
	isAnnotationIcon,
	isLabelPosition,
	LABEL_POSITIONS
} from '../types';
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
}

const ANNOTATION_DEFAULTS: WireAnnotation = {
	mx: 0,
	my: 0,
	icon: DEFAULT_ANNOTATION_ICON,
	color: 0xffffff,
	label: '',
	rotation: 0,
	visibleFrom: 0,
	visibleUntil: ANNOTATION_VISIBLE_FOREVER,
	iconSize: 1,
	labelSize: 1,
	labelPosition: DEFAULT_LABEL_POSITION,
	labelDistance: DEFAULT_LABEL_DISTANCE
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
 * V4 codec: 16-bit mask + extra fields beyond V2 (iconSize at bit 8, labelSize
 * at bit 9, labelPosition at bit 10, labelDistance at bit 11). Used only when
 * at least one annotation has a non-default value for any of these; V2/V3 stay
 * byte-stable for share links that don't use these features.
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
		labelDistance: Math.max(0, ann.labelDistance ?? DEFAULT_LABEL_DISTANCE)
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
	return out;
}
