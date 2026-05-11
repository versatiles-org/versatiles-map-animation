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

import {
	type BitReader,
	type BitWriter,
	type Codec,
	enumOf,
	stringCodec,
	uint,
	vuint
} from '../codec';
import {
	ANNOTATION_ICONS,
	ANNOTATION_LABEL_FONTS,
	ANNOTATION_STYLE_KEYS,
	DEFAULT_ANNOTATION_COLOR,
	DEFAULT_ANNOTATION_ICON,
	DEFAULT_ANNOTATION_LABEL_COLOR,
	DEFAULT_ANNOTATION_LABEL_FONT,
	DEFAULT_LABEL_DISTANCE,
	DEFAULT_LABEL_POSITION,
	isAnnotationIcon,
	isAnnotationLabelFont,
	isLabelPosition,
	LABEL_POSITIONS,
	type AnnotationStyle
} from '../types';

// Halo width: ufixed at 0.1-px precision via 8-bit uint → 0..25.5 px range,
// plenty for a halo. Wider would just be silly.
import { ufixed } from '../codec';
const haloWidthCodec = ufixed(8, 10);
import type { Annotation, AnnotationIcon, AnnotationLabelFont, LabelPosition } from '../types';
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
// Font enum: 187 entries → 8 bits. Pinned in `types.ts`; see the note there
// about why we mirror the upstream font index in code.
const labelFontCodec = enumOf(
	ANNOTATION_LABEL_FONTS as readonly [AnnotationLabelFont, ...AnnotationLabelFont[]]
);
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
	/** Glyph font for the label. Default `DEFAULT_ANNOTATION_LABEL_FONT`. */
	labelFont: AnnotationLabelFont;
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
	iconHaloWidth: undefined,
	labelFont: DEFAULT_ANNOTATION_LABEL_FONT
};

// ---------------------------------------------------------------------------
// Codec factory + field descriptors
//
// All three annotation codecs (V2 8-bit mask, V4 16-bit, V5 24-bit) share the
// same shape: variable-length array of mask + emitted fields, with carry-
// forward across iterations. The differences are:
//   - mask width
//   - which fields are included
//   - one special "present-only" semantic for halo fields (don't carry forward;
//     mask bit means "value is present" instead of "differs from prev")
//
// Each field is described by a small object — adding a future field is a
// one-line addition to the relevant array.
// ---------------------------------------------------------------------------

interface AnnField {
	bit: number;
	/** Inspector label. For most fields, also the WireAnnotation key name. */
	label: string;
	/** 'self' = on-emit, copy item[key] into next; 'none' = always reset to undefined. */
	carryForward: 'self' | 'none';
	shouldEmit(item: WireAnnotation, prev: WireAnnotation): boolean;
	encode(item: WireAnnotation, prev: WireAnnotation, w: import('../codec').BitWriter): void;
	decode(item: WireAnnotation, prev: WireAnnotation, r: import('../codec').BitReader): void;
	/** Override the default `next[label] = item[label]` when carryForward === 'self'. */
	apply?(next: WireAnnotation, item: WireAnnotation): void;
}

/**
 * Carry-forward field: emit when value differs from prev; on the wire, just
 * the value through `codec`. Most fields use this shape.
 */
function simpleField<K extends keyof WireAnnotation>(
	bit: number,
	key: K,
	codec: Codec<WireAnnotation[K]>
): AnnField {
	return {
		bit,
		label: key as string,
		carryForward: 'self',
		shouldEmit: (item, prev) => item[key] !== prev[key],
		encode: (item, _prev, w) => codec.encode(item[key], w),
		decode: (item, _prev, r) => {
			item[key] = codec.decode(r);
		}
	};
}

/**
 * Present-only field (halo). The mask bit means "value is present" rather
 * than "differs from prev"; the field doesn't carry forward, so each
 * annotation's halo override is independent.
 */
function presentField<K extends keyof WireAnnotation>(
	bit: number,
	key: K,
	codec: Codec<NonNullable<WireAnnotation[K]>>
): AnnField {
	return {
		bit,
		label: key as string,
		carryForward: 'none',
		shouldEmit: (item) => item[key] !== undefined,
		encode: (item, _prev, w) => codec.encode(item[key] as NonNullable<WireAnnotation[K]>, w),
		decode: (item, _prev, r) => {
			item[key] = codec.decode(r) as WireAnnotation[K];
		}
	};
}

/**
 * Position field (mx / my). Comparison and wire format are based on the
 * quantized integer at fixed precision; the `apply` hook stores the
 * dequantized value so prev mirrors what the decoder will see (matches the
 * pre-factory hand-coded behaviour byte-for-byte).
 */
function positionField(bit: number, key: 'mx' | 'my'): AnnField {
	const quantize = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * ANNOTATION_POS_MAX);
	const inner = uint(ANNOTATION_POS_BITS);
	return {
		bit,
		label: key,
		carryForward: 'self',
		shouldEmit: (item, prev) => quantize(item[key]) !== quantize(prev[key]),
		encode: (item, _prev, w) => inner.encode(quantize(item[key]), w),
		decode: (item, _prev, r) => {
			item[key] = inner.decode(r) / ANNOTATION_POS_MAX;
		},
		apply: (next, item) => {
			next[key] = quantize(item[key]) / ANNOTATION_POS_MAX;
		}
	};
}

function makeAnnotationsCodec(maskBits: number, fields: AnnField[]): Codec<WireAnnotation[]> {
	return {
		encode(arr, w) {
			w.frame('[length]', () => vuint.encode(arr.length, w));

			let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
			for (let idx = 0; idx < arr.length; idx++) {
				const item = arr[idx];
				w.frame(`[${idx}]`, () => {
					let mask = 0;
					for (const f of fields) if (f.shouldEmit(item, prev)) mask |= 1 << f.bit;

					w.frame('[mask]', () => w.writeBits(mask, maskBits));
					for (const f of fields) {
						if (mask & (1 << f.bit)) {
							w.frame(f.label, () => f.encode(item, prev, w));
						}
					}

					const next: WireAnnotation = { ...prev };
					const nextBag = next as unknown as Record<string, unknown>;
					const itemBag = item as unknown as Record<string, unknown>;
					for (const f of fields) {
						if (f.carryForward === 'none') {
							// Halo-style: never inherit; reset to undefined regardless of mask.
							nextBag[f.label] = undefined;
						} else if (mask & (1 << f.bit)) {
							if (f.apply) f.apply(next, item);
							else nextBag[f.label] = itemBag[f.label];
						}
					}
					prev = next;
				});
			}
		},
		decode(r) {
			const len = vuint.decode(r);
			const out: WireAnnotation[] = [];
			let prev: WireAnnotation = { ...ANNOTATION_DEFAULTS };
			for (let i = 0; i < len; i++) {
				const mask = r.readBits(maskBits);
				const item: WireAnnotation = { ...prev };
				const itemBag = item as unknown as Record<string, unknown>;
				// Present-only fields don't inherit — clear before reading so an
				// unset mask bit decodes as `undefined`.
				for (const f of fields) {
					if (f.carryForward === 'none') itemBag[f.label] = undefined;
				}
				for (const f of fields) {
					if (mask & (1 << f.bit)) f.decode(item, prev, r);
				}
				out.push(item);
				prev = item;
			}
			return out;
		}
	};
}

// ---------------------------------------------------------------------------
// Field tables — extending the codec means adding one entry to one array.
// ---------------------------------------------------------------------------

const V2_FIELDS: AnnField[] = [
	positionField(0, 'mx'),
	positionField(1, 'my'),
	simpleField(2, 'icon', annotationIconCodec),
	simpleField(3, 'color', annotationColorCodec),
	simpleField(4, 'label', stringCodec),
	simpleField(5, 'rotation', annotationRotationCodec),
	simpleField(6, 'visibleFrom', annotationVisibilityCodec),
	simpleField(7, 'visibleUntil', annotationVisibilityCodec)
];

const V4_EXTRA: AnnField[] = [
	simpleField(8, 'iconSize', annotationSizeCodec),
	simpleField(9, 'labelSize', annotationSizeCodec),
	simpleField(10, 'labelPosition', labelPositionCodec),
	simpleField(11, 'labelDistance', labelDistanceCodec),
	simpleField(12, 'fadeIn', annotationVisibilityCodec),
	simpleField(13, 'fadeOut', annotationVisibilityCodec),
	simpleField(14, 'labelColor', annotationColorCodec)
];

const V5_EXTRA: AnnField[] = [
	presentField(15, 'labelHaloColor', annotationColorCodec),
	presentField(16, 'labelHaloWidth', haloWidthCodec),
	presentField(17, 'iconHaloColor', annotationColorCodec),
	presentField(18, 'iconHaloWidth', haloWidthCodec),
	simpleField(19, 'labelFont', labelFontCodec)
];

/**
 * Single annotation array codec covering every field. 24-bit per-annotation
 * mask: bits 0..7 = position/icon/colour/label/rotation/visibility, bits 8..14
 * = sizes/positioning/fade/colour, bits 15..18 = halo overrides (present-only).
 *
 * Adding a future per-annotation field is a one-row addition to one of the
 * field arrays above and a free bit in the 24-bit mask.
 */
export const annotationsCodec = makeAnnotationsCodec(24, [...V2_FIELDS, ...V4_EXTRA, ...V5_EXTRA]);

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

// ---------------------------------------------------------------------------
// Field-spec table for normalize / denormalize
//
// Most per-annotation fields share the same shape: clamp ≥ 0 on the way in,
// omit when value matches default on the way out. The few that don't (mx/my
// from lat/lng, icon validity, rotation mod-360, visibleUntil sentinel,
// labelPosition validity) stay as inline special cases below.
// ---------------------------------------------------------------------------

export interface FieldSpec {
	/** Field key (Annotation key === WireAnnotation key for everything in here). */
	key: string;
	toWire(ann: Annotation, wire: WireAnnotation): void;
	fromWire(wire: WireAnnotation, out: Annotation): void;
	/**
	 * Read this field from a raw JSON record (during file-import validation).
	 * Throws on type mismatch (with index for error context); silently skips
	 * when the field is absent or undefined.
	 */
	fromJson(raw: Record<string, unknown>, out: Annotation, idx: number): void;
}

/** Carry-forward numeric field with a default. */
function numField<K extends keyof Annotation & keyof WireAnnotation>(
	key: K,
	defaultVal: number
): FieldSpec {
	return {
		key,
		toWire(ann, wire) {
			(wire as unknown as Record<string, unknown>)[key] = Math.max(
				0,
				(ann[key] as number | undefined) ?? defaultVal
			);
		},
		fromWire(wire, out) {
			const v = (wire as unknown as Record<string, unknown>)[key] as number;
			if (v !== defaultVal) (out as unknown as Record<string, unknown>)[key] = v;
		},
		fromJson(raw, out, idx) {
			const v = raw[key];
			if (v === undefined) return;
			if (typeof v !== 'number' || !Number.isFinite(v)) {
				throw new Error(`Annotation ${idx}: invalid "${key}".`);
			}
			(out as unknown as Record<string, unknown>)[key] = Math.max(0, v);
		}
	};
}

/** Hex-colour field with a named string default and matching int default. */
function colorField(key: 'labelColor', defaultStr: string, defaultInt: number): FieldSpec {
	return {
		key,
		toWire(ann, wire) {
			wire[key] = parseHexColor(ann[key] ?? defaultStr);
		},
		fromWire(wire, out) {
			if (wire[key] !== defaultInt) out[key] = formatHexColor(wire[key]);
		},
		fromJson(raw, out) {
			const v = raw[key];
			if (typeof v === 'string') out[key] = v;
		}
	};
}

/** Present-only halo width — undefined ↔ undefined; clamp ≥ 0. */
function presentNumField(key: 'labelHaloWidth' | 'iconHaloWidth'): FieldSpec {
	return {
		key,
		toWire(ann, wire) {
			wire[key] = ann[key] != null ? Math.max(0, ann[key]!) : undefined;
		},
		fromWire(wire, out) {
			if (wire[key] !== undefined) out[key] = wire[key];
		},
		fromJson(raw, out, idx) {
			const v = raw[key];
			if (v === undefined) return;
			if (typeof v !== 'number' || !Number.isFinite(v)) {
				throw new Error(`Annotation ${idx}: invalid "${key}".`);
			}
			out[key] = Math.max(0, v);
		}
	};
}

/**
 * Carry-forward enum field with an in-memory default. Stored on the wire as
 * the enum's index; the in-memory default is omitted from the decoded
 * Annotation when it matches `defaultVal`.
 */
function enumField(
	key: 'labelFont',
	defaultVal: AnnotationLabelFont,
	check: (v: unknown) => v is AnnotationLabelFont
): FieldSpec {
	return {
		key,
		toWire(ann, wire) {
			wire[key] = check(ann[key]) ? ann[key] : defaultVal;
		},
		fromWire(wire, out) {
			if (wire[key] !== defaultVal) out[key] = wire[key];
		},
		fromJson(raw, out) {
			if (check(raw[key])) out[key] = raw[key];
		}
	};
}

/** Present-only halo colour — undefined ↔ undefined. */
function presentColorField(key: 'labelHaloColor' | 'iconHaloColor'): FieldSpec {
	return {
		key,
		toWire(ann, wire) {
			wire[key] = ann[key] != null ? parseHexColor(ann[key]!) : undefined;
		},
		fromWire(wire, out) {
			if (wire[key] !== undefined) out[key] = formatHexColor(wire[key]!);
		},
		fromJson(raw, out) {
			const v = raw[key];
			if (typeof v === 'string') out[key] = v;
		}
	};
}

export const FIELD_SPECS: FieldSpec[] = [
	numField('visibleFrom', 0),
	numField('iconSize', 1),
	numField('labelSize', 1),
	numField('labelDistance', DEFAULT_LABEL_DISTANCE),
	numField('fadeIn', 0),
	numField('fadeOut', 0),
	colorField('labelColor', DEFAULT_ANNOTATION_LABEL_COLOR, 0x111111),
	presentColorField('labelHaloColor'),
	presentNumField('labelHaloWidth'),
	presentColorField('iconHaloColor'),
	presentNumField('iconHaloWidth'),
	enumField('labelFont', DEFAULT_ANNOTATION_LABEL_FONT, isAnnotationLabelFont)
];

// ---------------------------------------------------------------------------
// Wire ↔ application conversions
// ---------------------------------------------------------------------------

export function normalizeAnnotation(ann: Annotation): WireAnnotation {
	const { mx, my } = lngLatToMercator(ann.lng, ann.lat);
	const wire: WireAnnotation = {
		...ANNOTATION_DEFAULTS,
		mx,
		my,
		icon: isAnnotationIcon(ann.icon) ? ann.icon : DEFAULT_ANNOTATION_ICON,
		color: parseHexColor(ann.iconColor ?? DEFAULT_ANNOTATION_COLOR),
		label: ann.label ?? '',
		rotation: ((((ann.rotation ?? 0) % 360) + 360) % 360) % 360,
		labelPosition: isLabelPosition(ann.labelPosition) ? ann.labelPosition : DEFAULT_LABEL_POSITION
	};
	for (const f of FIELD_SPECS) f.toWire(ann, wire);
	// visibleUntil depends on visibleFrom (which was filled by the table) and
	// uses a sentinel for "always visible", so handle it after the loop.
	const visibleUntilRaw = ann.visibleUntil;
	wire.visibleUntil =
		visibleUntilRaw == null || !Number.isFinite(visibleUntilRaw)
			? ANNOTATION_VISIBLE_FOREVER
			: Math.max(wire.visibleFrom, visibleUntilRaw);
	return wire;
}

export function denormalizeAnnotation(wire: WireAnnotation): Annotation {
	const { lng, lat } = mercatorToLngLat(wire.mx, wire.my);
	const out: Annotation = { lng, lat, label: wire.label };
	// Keep the in-memory annotation thin: only spell out icon/iconColor when
	// they differ from the codec's hardcoded baseline. A thin annotation lets
	// the renderer's `resolveAnnotation` pick up `Animation.defaultAnnotation`
	// — which is also preserved on the wire — instead of the hardcoded
	// fallback. Fattening the annotation here would shadow the user's
	// per-animation default style.
	if (wire.icon !== ANNOTATION_DEFAULTS.icon) out.icon = wire.icon;
	if (wire.color !== ANNOTATION_DEFAULTS.color) out.iconColor = formatHexColor(wire.color);
	if (wire.rotation !== 0) out.rotation = wire.rotation;
	if (wire.labelPosition !== DEFAULT_LABEL_POSITION) out.labelPosition = wire.labelPosition;
	// `<` not `!==` because the sentinel marks the upper bound.
	if (wire.visibleUntil < ANNOTATION_VISIBLE_FOREVER) out.visibleUntil = wire.visibleUntil;
	for (const f of FIELD_SPECS) f.fromWire(wire, out);
	return out;
}

// ---------------------------------------------------------------------------
// Codec for the per-animation `defaultAnnotation` block — a
// `Partial<AnnotationStyle>` carrying just the fields the user set as
// per-animation defaults.
//
// Wire layout: a 12-bit presence mask (one bit per key in
// `ANNOTATION_STYLE_KEYS` order) followed by the encoded value of each
// present field. Each field uses the same per-value codec the
// per-annotation codec uses for that field, so a font picked as the
// default takes the same 8 bits whether it's the per-animation default or
// a per-annotation override.
//
// Unlike per-annotation encoding, there's no carry-forward baseline: each
// emitted field is encoded directly. The per-annotation codec keeps its
// existing hardcoded carry-forward baseline (`ANNOTATION_DEFAULTS`), so
// annotations matching the *hardcoded* default still emit nothing. The
// renderer's `resolveAnnotation` merges the two at display time.
// ---------------------------------------------------------------------------

const ANNOTATION_STYLE_MASK_BITS = ANNOTATION_STYLE_KEYS.length; // 12

/**
 * Encode/decode a single style field's value to/from the wire. Each entry
 * matches one `ANNOTATION_STYLE_KEYS` key in order, so the index lines up
 * with the presence-mask bit.
 */
const STYLE_FIELD_CODECS: {
	[K in (typeof ANNOTATION_STYLE_KEYS)[number]]: {
		encode(v: NonNullable<AnnotationStyle[K]>, w: BitWriter): void;
		decode(r: BitReader): NonNullable<AnnotationStyle[K]>;
	};
} = {
	icon: {
		encode: (v, w) => annotationIconCodec.encode(v, w),
		decode: (r) => annotationIconCodec.decode(r)
	},
	iconColor: {
		encode: (v, w) => annotationColorCodec.encode(parseHexColor(v), w),
		decode: (r) => formatHexColor(annotationColorCodec.decode(r))
	},
	iconSize: {
		encode: (v, w) => annotationSizeCodec.encode(v, w),
		decode: (r) => annotationSizeCodec.decode(r)
	},
	iconHaloColor: {
		encode: (v, w) => annotationColorCodec.encode(parseHexColor(v), w),
		decode: (r) => formatHexColor(annotationColorCodec.decode(r))
	},
	iconHaloWidth: {
		encode: (v, w) => haloWidthCodec.encode(Math.max(0, v), w),
		decode: (r) => haloWidthCodec.decode(r)
	},
	labelColor: {
		encode: (v, w) => annotationColorCodec.encode(parseHexColor(v), w),
		decode: (r) => formatHexColor(annotationColorCodec.decode(r))
	},
	labelSize: {
		encode: (v, w) => annotationSizeCodec.encode(v, w),
		decode: (r) => annotationSizeCodec.decode(r)
	},
	labelPosition: {
		encode: (v, w) => labelPositionCodec.encode(v, w),
		decode: (r) => labelPositionCodec.decode(r)
	},
	labelDistance: {
		encode: (v, w) => labelDistanceCodec.encode(v, w),
		decode: (r) => labelDistanceCodec.decode(r)
	},
	labelFont: {
		encode: (v, w) => labelFontCodec.encode(v, w),
		decode: (r) => labelFontCodec.decode(r)
	},
	labelHaloColor: {
		encode: (v, w) => annotationColorCodec.encode(parseHexColor(v), w),
		decode: (r) => formatHexColor(annotationColorCodec.decode(r))
	},
	labelHaloWidth: {
		encode: (v, w) => haloWidthCodec.encode(Math.max(0, v), w),
		decode: (r) => haloWidthCodec.decode(r)
	}
};

export const defaultAnnotationCodec: Codec<Partial<AnnotationStyle>> = {
	encode(value, w) {
		let mask = 0;
		for (let i = 0; i < ANNOTATION_STYLE_KEYS.length; i++) {
			const k = ANNOTATION_STYLE_KEYS[i];
			if ((value as Record<string, unknown>)[k] !== undefined) mask |= 1 << i;
		}
		w.frame('[mask]', () => w.writeBits(mask, ANNOTATION_STYLE_MASK_BITS));
		for (let i = 0; i < ANNOTATION_STYLE_KEYS.length; i++) {
			if (!(mask & (1 << i))) continue;
			const k = ANNOTATION_STYLE_KEYS[i];
			const v = (value as Record<string, unknown>)[k];
			w.frame(
				k,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				() => (STYLE_FIELD_CODECS[k] as any).encode(v, w)
			);
		}
	},
	decode(r) {
		const mask = r.readBits(ANNOTATION_STYLE_MASK_BITS);
		const out: Record<string, unknown> = {};
		for (let i = 0; i < ANNOTATION_STYLE_KEYS.length; i++) {
			if (!(mask & (1 << i))) continue;
			const k = ANNOTATION_STYLE_KEYS[i];
			out[k] = STYLE_FIELD_CODECS[k].decode(r);
		}
		return out as Partial<AnnotationStyle>;
	}
};
