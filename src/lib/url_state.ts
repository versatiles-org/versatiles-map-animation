import {
	base64UrlToBytes,
	BitReader,
	BitWriter,
	bool,
	bytesToBase64Url,
	deltaArray,
	enumOf,
	fixed,
	inspect,
	struct,
	type Codec,
	type InspectionNode,
	type TypeOf,
	ufixed,
	uint,
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

// `t` is stored in milliseconds via vuint — short animations cost just a few
// bits per timestamp.
const tCodec: Codec<number> = {
	encode: (v, w) => vuint.encode(Math.max(0, Math.round(v * 1000)), w),
	decode: (r) => vuint.decode(r) / 1000
};

// Picks the schema's `path` field type from `PATH_STYLES`. The const-readonly
// shape requires an at-least-one-element tuple to satisfy `enumOf`.
const pathCodec = enumOf(PATH_STYLES as readonly [PathStyle, ...PathStyle[]]);

// All fields a keyframe can carry on the wire. The deltaArray emits an N-bit
// presence mask per element and only writes the fields whose values differ
// from the previous keyframe (or from `defaults`, for the first one).
const keyframeShape = {
	t: tCodec,
	lng: fixed(29, 1e6), // ±180.000000 → fits in 29 bits signed
	lat: fixed(28, 1e6), // ±90.000000  → fits in 28 bits signed
	zoom: ufixed(20, 1e4), // 0..104 covered, 4-decimal precision
	pitch: ufixed(14, 100), // 0..163 covered (we cap at 90)
	bearing: fixed(16, 100), // ±327 covered (we cap at ±180)
	roll: fixed(16, 100),
	path: pathCodec
} as const;

const keyframeDefaults = {
	t: 0,
	lng: 0,
	lat: 0,
	zoom: 0,
	pitch: 0,
	bearing: 0,
	roll: 0,
	path: DEFAULT_PATH
} as const;

const AnimationCodec = struct({
	version: uint(4),
	style: enumOf(MAP_STYLE_IDS as readonly [MapStyleId, ...MapStyleId[]]),
	terrain: bool,
	keyframes: deltaArray(keyframeShape, keyframeDefaults)
});

// On the wire every keyframe carries every field — the deltaArray takes
// care of only emitting the ones that differ. The application's
// `Keyframe.path` is optional with default 'arc'; we normalize that on
// encode and re-introduce `undefined` on decode.
type WireKeyframe = TypeOf<typeof AnimationCodec>['keyframes'][number];

function normalizeKeyframe(kf: Keyframe): WireKeyframe {
	return {
		t: kf.t,
		lng: kf.lng,
		lat: kf.lat,
		zoom: kf.zoom,
		pitch: kf.pitch,
		bearing: kf.bearing,
		roll: kf.roll,
		path: kf.path ?? DEFAULT_PATH
	};
}

function denormalizeKeyframe(wire: WireKeyframe): Keyframe {
	const kf: Keyframe = {
		t: wire.t,
		lng: wire.lng,
		lat: wire.lat,
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
