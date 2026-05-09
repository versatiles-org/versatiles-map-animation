import {
	base64UrlToBytes,
	BitReader,
	BitWriter,
	bool,
	bytesToBase64Url,
	enumOf,
	inspect,
	string as stringCodec,
	struct,
	type Codec,
	type InspectionNode,
	uint,
	vsint,
	vuint
} from './codec';
import {
	ANNOTATION_ICONS,
	DEFAULT_ANNOTATION_COLOR,
	DEFAULT_ANNOTATION_ICON,
	DEFAULT_ANNOTATION_SCALE,
	DEFAULT_PATH,
	isAnnotationIcon,
	MAP_STYLE_IDS,
	PATH_STYLES,
	SCHEMA_VERSION
} from './types';
import type {
	Animation,
	AnnotationIcon,
	Annotation,
	Keyframe,
	MapStyleId,
	PathStyle
} from './types';

const HASH_KEY = 'kf';

// First byte of the encoded payload tells us which format follows.
//   0x01: bit-packed binary v1 (no annotations)
//   0x02: bit-packed binary v2 (adds annotations array at the end)
//   0x03: bit-packed binary v3 (adds animation-level annotationScale)
const FORMAT_TAG_BINARY_V1 = 0x01;
const FORMAT_TAG_BINARY_V2 = 0x02;
const FORMAT_TAG_BINARY_V3 = 0x03;

// ---------------------------------------------------------------------------
// Binary codec for Animation
// ---------------------------------------------------------------------------

const MAX_LAT = 85.05112878; // standard Web Mercator pole-clamp

function lngLatToMercator(lng: number, lat: number): { mx: number; my: number } {
	const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
	const mx = (wrappedLng + 180) / 360;
	const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
	const sinLat = Math.sin((clampedLat * Math.PI) / 180);
	const my = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
	return { mx, my };
}

function mercatorToLngLat(mx: number, my: number): { lng: number; lat: number } {
	const lng = mx * 360 - 180;
	const n = Math.PI - 2 * Math.PI * my;
	const lat = (180 / Math.PI) * Math.atan((Math.exp(n) - Math.exp(-n)) / 2);
	return { lng, lat };
}

/**
 * How many bits to use for each Mercator-x / -y axis at a given zoom.
 * One world pixel at zoom z spans 1/(256·2^z) ≈ 2^-(z+8) of WM space, so
 * (z + 12) bits buys ~16× sub-pixel accuracy. Floor at 12 (sub-pixel even
 * at zoom 0) and cap at 30 — that bound keeps signed deltas in safe-integer
 * range for the zigzag varint and is still sub-pixel up to zoom 18.
 */
function zoomBits(zoom: number): number {
	return Math.max(12, Math.min(30, Math.ceil(zoom) + 12));
}

// `t` is stored in milliseconds via vuint — short animations cost just a few
// bits per timestamp.
const tCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(0, Math.round(v * 1000)), w),
	decode: (r) => vuint.decode(r) / 1000
};

// Zoom: stored as a vuint of round(zoom × 100). Two-decimal precision is
// imperceptible visually, and small numbers cost only ~10 bits typically.
const zoomCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(0, Math.round(v * 100)), w),
	decode: (r) => vuint.decode(r) / 100
};

// Pitch: 8 bits over 0..90° → ~0.35° precision (visually imperceptible).
const pitchCodec: Codec<number> = {
	encode: (v, w) => {
		const clamped = Math.max(0, Math.min(90, v));
		uint(8).encode(Math.round((clamped * 255) / 90), w);
	},
	decode: (r) => (uint(8).decode(r) * 90) / 255
};

// Bearing/roll: 10 bits over 0..360° (mod 360) → ~0.35° precision.
// Stored unsigned in [0, 360); decoded back to the application's [-180, 180).
function makeAngleCodec(): Codec<number> {
	return {
		encode: (v, w) => {
			const positive = (((v % 360) + 360) % 360) % 360;
			const intVal = Math.round((positive * 1024) / 360) % 1024;
			uint(10).encode(intVal, w);
		},
		decode: (r) => {
			const positive = (uint(10).decode(r) * 360) / 1024;
			return positive >= 180 ? positive - 360 : positive;
		}
	};
}
const bearingCodec = makeAngleCodec();
const rollCodec = makeAngleCodec();
const pathCodec = enumOf(PATH_STYLES as readonly [PathStyle, ...PathStyle[]]);

interface WireKeyframe {
	t: number;
	zoom: number;
	mx: number;
	my: number;
	pitch: number;
	bearing: number;
	roll: number;
	path: PathStyle;
}

const KEYFRAME_DEFAULTS: WireKeyframe = {
	t: 0,
	zoom: 0,
	mx: 0,
	my: 0,
	pitch: 0,
	bearing: 0,
	roll: 0,
	path: DEFAULT_PATH
};

// Field order matters: `zoom` must be encoded before `mx`/`my` because the
// position uses zoom-dependent bit widths. Mask bit i corresponds to the
// i-th field in (t, zoom, mx, my, pitch, bearing, roll, path).

function quantize(value: number, zoom: number): number {
	const max = Math.pow(2, zoomBits(zoom)) - 1;
	return Math.round(Math.max(0, Math.min(1, value)) * max);
}

function dequantize(intValue: number, zoom: number): number {
	const max = Math.pow(2, zoomBits(zoom)) - 1;
	return intValue / max;
}

function encodeMercatorAxisAbsolute(value: number, zoom: number, w: BitWriter): void {
	uint(zoomBits(zoom)).encode(quantize(value, zoom), w);
}

function decodeMercatorAxisAbsolute(zoom: number, r: BitReader): number {
	return dequantize(uint(zoomBits(zoom)).decode(r), zoom);
}

function encodeMercatorAxisDelta(value: number, prev: number, zoom: number, w: BitWriter): void {
	vsint.encode(quantize(value, zoom) - quantize(prev, zoom), w);
}

function decodeMercatorAxisDelta(prev: number, zoom: number, r: BitReader): number {
	return dequantize(quantize(prev, zoom) + vsint.decode(r), zoom);
}

/**
 * The keyframe array codec. Hand-rolled because `mx`/`my`'s bit width
 * depends on the keyframe's `zoom`, which the standard `deltaArray` can't
 * express (its sub-codecs are independent).
 *
 * Position encoding uses classical differential coding: the *first* time an
 * axis is emitted it is absolute (`uint(zoomBits)`); subsequent emissions
 * are signed deltas in the *current* zoom's grid (`vsint`). Re-quantizing
 * the previous value into the new grid each time keeps deltas small even
 * across zoom changes — a tighter zoom just gives a bigger grid, but the
 * delta still represents the same physical motion.
 *
 * Mask uses precision-aware comparison: an axis is emitted if it would
 * round to a different int at the current zoom. This naturally re-emits
 * position when zoom precision increases, so the precision context shift
 * is handled implicitly.
 */
const keyframesCodec: Codec<WireKeyframe[]> = {
	encode(arr, w) {
		const ins = w.inspector;
		if (ins) ins.enter('[length]', w.totalBits());
		vuint.encode(arr.length, w);
		if (ins) ins.exit('[length]', w.totalBits());

		let prev: WireKeyframe = { ...KEYFRAME_DEFAULTS };
		let mxHasPrior = false;
		let myHasPrior = false;
		for (let idx = 0; idx < arr.length; idx++) {
			const item = arr[idx];
			if (ins) ins.enter(`[${idx}]`, w.totalBits());

			// Mask: zoom and non-position fields use direct equality; position
			// uses precision-aware comparison at the (post-merge) zoom.
			let mask = 0;
			if (item.t !== prev.t) mask |= 1 << 0;
			if (item.zoom !== prev.zoom) mask |= 1 << 1;
			const effZoom = mask & 0b00000010 ? item.zoom : prev.zoom;
			if (quantize(item.mx, effZoom) !== quantize(prev.mx, effZoom)) mask |= 1 << 2;
			if (quantize(item.my, effZoom) !== quantize(prev.my, effZoom)) mask |= 1 << 3;
			if (item.pitch !== prev.pitch) mask |= 1 << 4;
			if (item.bearing !== prev.bearing) mask |= 1 << 5;
			if (item.roll !== prev.roll) mask |= 1 << 6;
			if (item.path !== prev.path) mask |= 1 << 7;

			if (ins) ins.enter('[mask]', w.totalBits());
			w.writeBits(mask, 8);
			if (ins) ins.exit('[mask]', w.totalBits());

			const writeField = <T>(name: keyof WireKeyframe, c: Codec<T>, value: T) => {
				if (ins) ins.enter(name, w.totalBits());
				c.encode(value, w);
				if (ins) ins.exit(name, w.totalBits());
			};

			if (mask & (1 << 0)) writeField('t', tCodec, item.t);
			if (mask & (1 << 1)) writeField('zoom', zoomCodec, item.zoom);
			if (mask & (1 << 2)) {
				if (ins) ins.enter('mx', w.totalBits());
				if (mxHasPrior) encodeMercatorAxisDelta(item.mx, prev.mx, effZoom, w);
				else encodeMercatorAxisAbsolute(item.mx, effZoom, w);
				if (ins) ins.exit('mx', w.totalBits());
				mxHasPrior = true;
			}
			if (mask & (1 << 3)) {
				if (ins) ins.enter('my', w.totalBits());
				if (myHasPrior) encodeMercatorAxisDelta(item.my, prev.my, effZoom, w);
				else encodeMercatorAxisAbsolute(item.my, effZoom, w);
				if (ins) ins.exit('my', w.totalBits());
				myHasPrior = true;
			}
			if (mask & (1 << 4)) writeField('pitch', pitchCodec, item.pitch);
			if (mask & (1 << 5)) writeField('bearing', bearingCodec, item.bearing);
			if (mask & (1 << 6)) writeField('roll', rollCodec, item.roll);
			if (mask & (1 << 7)) writeField('path', pathCodec, item.path);

			if (ins) ins.exit(`[${idx}]`, w.totalBits());

			// Update `prev` to mirror exactly what the decoder will see.
			const next: WireKeyframe = { ...prev };
			if (mask & (1 << 0)) next.t = item.t; // tCodec is ms-quantized; close enough
			if (mask & (1 << 1)) next.zoom = item.zoom;
			if (mask & (1 << 2)) next.mx = dequantize(quantize(item.mx, effZoom), effZoom);
			if (mask & (1 << 3)) next.my = dequantize(quantize(item.my, effZoom), effZoom);
			if (mask & (1 << 4)) next.pitch = item.pitch;
			if (mask & (1 << 5)) next.bearing = item.bearing;
			if (mask & (1 << 6)) next.roll = item.roll;
			if (mask & (1 << 7)) next.path = item.path;
			prev = next;
		}
	},
	decode(r) {
		const len = vuint.decode(r);
		const out: WireKeyframe[] = [];
		let prev: WireKeyframe = { ...KEYFRAME_DEFAULTS };
		let mxHasPrior = false;
		let myHasPrior = false;
		for (let i = 0; i < len; i++) {
			const mask = r.readBits(8);
			const item: WireKeyframe = { ...prev };
			if (mask & (1 << 0)) item.t = tCodec.decode(r);
			if (mask & (1 << 1)) item.zoom = zoomCodec.decode(r);
			const effZoom = item.zoom;
			if (mask & (1 << 2)) {
				item.mx = mxHasPrior
					? decodeMercatorAxisDelta(prev.mx, effZoom, r)
					: decodeMercatorAxisAbsolute(effZoom, r);
				mxHasPrior = true;
			}
			if (mask & (1 << 3)) {
				item.my = myHasPrior
					? decodeMercatorAxisDelta(prev.my, effZoom, r)
					: decodeMercatorAxisAbsolute(effZoom, r);
				myHasPrior = true;
			}
			if (mask & (1 << 4)) item.pitch = pitchCodec.decode(r);
			if (mask & (1 << 5)) item.bearing = bearingCodec.decode(r);
			if (mask & (1 << 6)) item.roll = rollCodec.decode(r);
			if (mask & (1 << 7)) item.path = pathCodec.decode(r);
			out.push(item);
			prev = item;
		}
		return out;
	}
};

// ---------------------------------------------------------------------------
// Annotations codec
//
// Annotations are static decorations on the map (markers, arrows, labels) with
// an optional visibility window expressed in animation time. Position uses a
// fixed 26-bit Mercator quantization (≈ sub-pixel at zoom 18) — annotations
// don't move, so the keyframe-style zoom-dependent precision isn't worth the
// complexity here. Mask bits 0..6 correspond to fields in declaration order.
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

interface WireAnnotation {
	mx: number;
	my: number;
	icon: AnnotationIcon;
	color: number;
	label: string;
	rotation: number;
	visibleFrom: number;
	visibleUntil: number;
}

// Sentinel for "always visible" — large enough that no realistic animation
// will compete with it, small enough to varint in a few bytes when emitted.
const ANNOTATION_VISIBLE_FOREVER = 86_400; // seconds = 24 h

const ANNOTATION_DEFAULTS: WireAnnotation = {
	mx: 0,
	my: 0,
	icon: DEFAULT_ANNOTATION_ICON,
	color: 0xffffff,
	label: '',
	rotation: 0,
	visibleFrom: 0,
	visibleUntil: ANNOTATION_VISIBLE_FOREVER
};

const annotationsCodec: Codec<WireAnnotation[]> = {
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

const AnimationCodecV1 = struct({
	version: uint(4),
	style: enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]),
	terrain: bool,
	keyframes: keyframesCodec
});

const AnimationCodecV2 = struct({
	version: uint(4),
	style: enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]),
	terrain: bool,
	keyframes: keyframesCodec,
	annotations: annotationsCodec
});

// V3 adds an animation-level `annotationScale` (vuint of round(scale*100)).
// Stored last so the V2 prefix is still parseable bit-by-bit; we only emit V3
// when the scale differs from the default, so no-scale animations remain V2.
const annotationScaleCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(1, Math.round(v * 100)), w),
	decode: (r) => vuint.decode(r) / 100
};

const AnimationCodecV3 = struct({
	version: uint(4),
	style: enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]),
	terrain: bool,
	keyframes: keyframesCodec,
	annotations: annotationsCodec,
	annotationScale: annotationScaleCodec
});

function normalizeKeyframe(kf: Keyframe): WireKeyframe {
	const { mx, my } = lngLatToMercator(kf.lng, kf.lat);
	return {
		t: kf.t,
		zoom: kf.zoom,
		mx,
		my,
		pitch: kf.pitch,
		bearing: kf.bearing,
		roll: kf.roll,
		path: kf.path ?? DEFAULT_PATH
	};
}

function denormalizeKeyframe(wire: WireKeyframe): Keyframe {
	const { lng, lat } = mercatorToLngLat(wire.mx, wire.my);
	const kf: Keyframe = {
		t: wire.t,
		lng,
		lat,
		zoom: wire.zoom,
		pitch: wire.pitch,
		bearing: wire.bearing,
		roll: wire.roll
	};
	if (wire.path !== DEFAULT_PATH) kf.path = wire.path;
	return kf;
}

// Hex colour helpers. The wire format stores RGB as a 24-bit int; the in-memory
// form keeps the user's `#rrggbb` string so the UI can round-trip arbitrary
// case/format. We accept `#rgb` and `#rrggbb` (with or without leading `#`)
// and emit the canonical lowercase `#rrggbb`.
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

function normalizeAnnotation(ann: Annotation): WireAnnotation {
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
		visibleUntil
	};
}

function denormalizeAnnotation(wire: WireAnnotation): Annotation {
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
	return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode an animation to a base64-url string suitable for URL hashes.
 * Uses the bit-packed binary codec; the first byte is a format tag so the
 * decoder can pick the right struct. Picks the smallest sufficient version:
 * V1 for keyframes-only, V2 when annotations are present at default scale,
 * V3 only when annotationScale differs from the default. Older binary
 * versions stay byte-stable so existing share links don't change.
 */
export function encodeAnimation(anim: Animation): string {
	const w = new BitWriter();
	const scale = anim.annotationScale ?? DEFAULT_ANNOTATION_SCALE;
	const hasAnnotations = anim.annotations && anim.annotations.length > 0;
	const needsV3 = hasAnnotations && scale !== DEFAULT_ANNOTATION_SCALE;
	if (needsV3) {
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
		tag === FORMAT_TAG_BINARY_V1 ||
		tag === FORMAT_TAG_BINARY_V2 ||
		tag === FORMAT_TAG_BINARY_V3
	) {
		const r = new BitReader(bytes);
		r.readBits(8); // consume tag
		if (tag === FORMAT_TAG_BINARY_V3) {
			const wire = AnimationCodecV3.decode(r);
			if (wire.version > SCHEMA_VERSION) {
				throw new Error(
					`File was made with a newer version (v${wire.version}); supported: v${SCHEMA_VERSION}.`
				);
			}
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
			if (wire.version > SCHEMA_VERSION) {
				throw new Error(
					`File was made with a newer version (v${wire.version}); supported: v${SCHEMA_VERSION}.`
				);
			}
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
		if (wire.version > SCHEMA_VERSION) {
			throw new Error(
				`File was made with a newer version (v${wire.version}); supported: v${SCHEMA_VERSION}.`
			);
		}
		return {
			version: SCHEMA_VERSION,
			style: wire.style,
			terrain: wire.terrain,
			keyframes: wire.keyframes.map(denormalizeKeyframe),
			annotations: [],
			annotationScale: DEFAULT_ANNOTATION_SCALE
		};
	}
	throw new Error(`Unknown URL hash format (tag=0x${tag.toString(16)})`);
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
 * debugging URL-hash size — pair with `formatInspection()` from `./codec`
 * to print a "lat: 28 bits, zoom: 20 bits, …" tree.
 */
export function inspectAnimation(anim: Animation): InspectionNode {
	const scale = anim.annotationScale ?? DEFAULT_ANNOTATION_SCALE;
	const hasAnnotations = anim.annotations && anim.annotations.length > 0;
	const needsV3 = hasAnnotations && scale !== DEFAULT_ANNOTATION_SCALE;
	const inner = needsV3
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
