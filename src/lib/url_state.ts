import { DEFAULT_STYLE, DEFAULT_TERRAIN, isMapStyleId, SCHEMA_VERSION } from './types';
import type { Animation, Keyframe, MapStyleId } from './types';

const HASH_KEY = 'kf';

const FIELDS = ['t', 'lng', 'lat', 'zoom', 'pitch', 'bearing', 'roll'] as const;
type Field = (typeof FIELDS)[number];

const ROUND_DECIMALS: Record<Field, number> = {
	t: 3,
	lng: 6,
	lat: 6,
	zoom: 4,
	pitch: 2,
	bearing: 2,
	roll: 2
};

const FIRST_KF_DEFAULTS: Record<Field, number> = {
	t: 0,
	lng: 0,
	lat: 0,
	zoom: 0,
	pitch: 0,
	bearing: 0,
	roll: 0
};

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

function roundKeyframe(kf: Keyframe): Keyframe {
	return {
		t: round(kf.t, ROUND_DECIMALS.t),
		lng: round(kf.lng, ROUND_DECIMALS.lng),
		lat: round(kf.lat, ROUND_DECIMALS.lat),
		zoom: round(kf.zoom, ROUND_DECIMALS.zoom),
		pitch: round(kf.pitch, ROUND_DECIMALS.pitch),
		bearing: round(kf.bearing, ROUND_DECIMALS.bearing),
		roll: round(kf.roll, ROUND_DECIMALS.roll)
	};
}

/**
 * Squeeze an Animation into a smaller URL form by omitting fields that
 * match the previous keyframe (or, for the first keyframe, the default
 * value of 0). The `style` field is omitted when it equals the default.
 */
export function toCompact(anim: Animation): CompactAnimation {
	const out: CompactAnimation = { version: anim.version, keyframes: [] };
	if (anim.style && anim.style !== DEFAULT_STYLE) out.style = anim.style;
	if (anim.terrain !== DEFAULT_TERRAIN) out.terrain = anim.terrain;

	let prev: Keyframe | null = null;
	for (const raw of anim.keyframes) {
		const kf = roundKeyframe(raw);
		const reference: Record<Field, number> = prev
			? {
					t: prev.t,
					lng: prev.lng,
					lat: prev.lat,
					zoom: prev.zoom,
					pitch: prev.pitch,
					bearing: prev.bearing,
					roll: prev.roll
				}
			: FIRST_KF_DEFAULTS;
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
	let prev: Keyframe | null = null;
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
		const kf: Keyframe = {
			t: get('t'),
			lng: get('lng'),
			lat: get('lat'),
			zoom: get('zoom'),
			pitch: get('pitch'),
			bearing: get('bearing'),
			roll: get('roll')
		};
		keyframes.push(kf);
		prev = kf;
	}
	return { version: SCHEMA_VERSION, style, terrain, keyframes };
}

function toBase64Url(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(s: string): string {
	const pad = (4 - (s.length % 4)) % 4;
	const padded = s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(pad);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

export function encodeAnimation(anim: Animation): string {
	return toBase64Url(JSON.stringify(toCompact(anim)));
}

export function decodeAnimation(encoded: string): Animation | null {
	try {
		const json = fromBase64Url(encoded);
		return fromCompact(JSON.parse(json));
	} catch {
		return null;
	}
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
	const json = fromBase64Url(v);
	return fromCompact(JSON.parse(json));
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
