import {
	base64UrlToBytes,
	BitReader,
	BitWriter,
	bool,
	bytesToBase64Url,
	enumOf,
	inspect,
	struct,
	type Codec,
	type InspectionNode,
	uint,
	vsint,
	vuint
} from './codec';
import {
	DEFAULT_PATH,
	DEFAULT_STYLE,
	DEFAULT_TERRAIN,
	isMapStyleId,
	MAP_STYLE_IDS,
	PATH_STYLES,
	SCHEMA_VERSION
} from './types';
import type { Animation, Keyframe, MapStyleId, PathStyle } from './types';

const HASH_KEY = 'kf';

// First byte of the encoded payload tells us which format follows.
//   0x01: bit-packed binary (current format)
//   0x7B ('{'): legacy JSON-base64 (kept for backward compatibility)
const FORMAT_TAG_BINARY_V1 = 0x01;
const FORMAT_TAG_JSON_LEGACY = 0x7b;

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

const AnimationCodec = struct({
	version: uint(4),
	style: enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]),
	terrain: bool,
	keyframes: keyframesCodec
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

// ---------------------------------------------------------------------------
// Legacy JSON-compact form (only used by the JSON fallback decoder)
// ---------------------------------------------------------------------------

const FIELDS = ['t', 'lng', 'lat', 'zoom', 'pitch', 'bearing', 'roll', 'path'] as const;
type Field = (typeof FIELDS)[number];

const ROUND_DECIMALS: Record<Field, number> = {
	t: 3,
	lng: 6,
	lat: 6,
	zoom: 4,
	pitch: 2,
	bearing: 2,
	roll: 2,
	path: 0
};

const FIRST_KF_DEFAULTS: Record<Field, number> = {
	t: 0,
	lng: 0,
	lat: 0,
	zoom: 0,
	pitch: 0,
	bearing: 0,
	roll: 0,
	path: 0
};

function pathToCode(p: PathStyle | undefined): number {
	return p === 'linear' ? 1 : 0;
}
function codeToPath(n: number): PathStyle {
	return n === 1 ? 'linear' : 'arc';
}

type CompactKeyframe = Partial<Record<Field, number>>;
interface CompactAnimation {
	version: number;
	style?: MapStyleId;
	terrain?: boolean;
	keyframes: CompactKeyframe[];
}

function round(x: number, decimals: number): number {
	const m = Math.pow(10, decimals);
	return Math.round(x * m) / m;
}

type NumKeyframe = Record<Field, number>;

function toNumKeyframe(kf: Keyframe): NumKeyframe {
	return {
		t: round(kf.t, ROUND_DECIMALS.t),
		lng: round(kf.lng, ROUND_DECIMALS.lng),
		lat: round(kf.lat, ROUND_DECIMALS.lat),
		zoom: round(kf.zoom, ROUND_DECIMALS.zoom),
		pitch: round(kf.pitch, ROUND_DECIMALS.pitch),
		bearing: round(kf.bearing, ROUND_DECIMALS.bearing),
		roll: round(kf.roll, ROUND_DECIMALS.roll),
		path: pathToCode(kf.path)
	};
}

/**
 * Squeeze an Animation into a smaller URL form (JSON variant) by omitting
 * fields that match the previous keyframe (or defaults of 0 for the first).
 * Retained for the JSON fallback path; new encodes use the binary codec.
 */
export function toCompact(anim: Animation): CompactAnimation {
	const out: CompactAnimation = { version: anim.version, keyframes: [] };
	if (anim.style && anim.style !== DEFAULT_STYLE) out.style = anim.style;
	if (anim.terrain !== DEFAULT_TERRAIN) out.terrain = anim.terrain;

	let prev: NumKeyframe | null = null;
	for (const raw of anim.keyframes) {
		const kf = toNumKeyframe(raw);
		const reference: NumKeyframe = prev ?? FIRST_KF_DEFAULTS;
		const compact: CompactKeyframe = {};
		for (const field of FIELDS) {
			if (kf[field] !== reference[field]) compact[field] = kf[field];
		}
		out.keyframes.push(compact);
		prev = kf;
	}
	return out;
}

/**
 * Inverse of toCompact. Missing fields are carried forward from the
 * previous keyframe; for the first keyframe, the default 0 is used.
 */
export function fromCompact(input: unknown): Animation {
	if (!input || typeof input !== 'object') throw new Error('Invalid: not an object');
	const obj = input as Record<string, unknown>;
	const version = obj.version;
	if (typeof version !== 'number') throw new Error('Invalid: missing or invalid "version"');
	if (version > SCHEMA_VERSION) {
		throw new Error(
			`File was made with a newer version (v${version}); supported: v${SCHEMA_VERSION}.`
		);
	}
	if (!Array.isArray(obj.keyframes)) throw new Error('Invalid: "keyframes" missing');
	const style: MapStyleId = isMapStyleId(obj.style) ? obj.style : DEFAULT_STYLE;
	const terrain = typeof obj.terrain === 'boolean' ? obj.terrain : DEFAULT_TERRAIN;

	const keyframes: Keyframe[] = [];
	let prev: NumKeyframe | null = null;
	for (let i = 0; i < obj.keyframes.length; i++) {
		const raw = obj.keyframes[i];
		if (!raw || typeof raw !== 'object') throw new Error(`Keyframe ${i}: not an object`);
		const c = raw as Record<string, unknown>;
		const get = (field: Field): number => {
			const v = c[field];
			if (v === undefined) return prev ? prev[field] : FIRST_KF_DEFAULTS[field];
			if (typeof v === 'number' && Number.isFinite(v)) return v;
			throw new Error(`Keyframe ${i}: invalid "${field}"`);
		};
		const num: NumKeyframe = {
			t: get('t'),
			lng: get('lng'),
			lat: get('lat'),
			zoom: get('zoom'),
			pitch: get('pitch'),
			bearing: get('bearing'),
			roll: get('roll'),
			path: get('path')
		};
		const kf: Keyframe = {
			t: num.t,
			lng: num.lng,
			lat: num.lat,
			zoom: num.zoom,
			pitch: num.pitch,
			bearing: num.bearing,
			roll: num.roll
		};
		const path = codeToPath(num.path);
		if (path !== DEFAULT_PATH) kf.path = path;
		keyframes.push(kf);
		prev = num;
	}
	return { version: SCHEMA_VERSION, style, terrain, keyframes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode an animation to a base64-url string suitable for URL hashes.
 * Uses the bit-packed binary codec; the first byte is a format tag so
 * legacy JSON-base64 hashes can still be decoded by `decodeAnimation`.
 */
export function encodeAnimation(anim: Animation): string {
	const w = new BitWriter();
	w.writeBits(FORMAT_TAG_BINARY_V1, 8);
	AnimationCodec.encode(
		{
			version: anim.version,
			style: anim.style,
			terrain: anim.terrain,
			keyframes: anim.keyframes.map(normalizeKeyframe)
		},
		w
	);
	return bytesToBase64Url(w.finish());
}

/**
 * Decode an animation from a base64-url string. Returns null on any decode
 * failure. Accepts both the new binary format and the legacy JSON-base64
 * form transparently.
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
	if (tag === FORMAT_TAG_BINARY_V1) {
		const r = new BitReader(bytes);
		r.readBits(8); // consume tag
		const wire = AnimationCodec.decode(r);
		if (wire.version > SCHEMA_VERSION) {
			throw new Error(
				`File was made with a newer version (v${wire.version}); supported: v${SCHEMA_VERSION}.`
			);
		}
		return {
			version: SCHEMA_VERSION,
			style: wire.style,
			terrain: wire.terrain,
			keyframes: wire.keyframes.map(denormalizeKeyframe)
		};
	}
	if (tag === FORMAT_TAG_JSON_LEGACY) {
		const json = new TextDecoder().decode(bytes);
		return fromCompact(JSON.parse(json));
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
	const inner = inspect(AnimationCodec, {
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
