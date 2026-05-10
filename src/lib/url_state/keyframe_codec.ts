/**
 * Bit-packed codec for the `Keyframe[]` part of an Animation. Hand-rolled
 * because `mx`/`my`'s bit width depends on the keyframe's `zoom`, which the
 * generic `deltaArray` can't express (its sub-codecs are independent).
 *
 * Position encoding uses classical differential coding: the *first* time an
 * axis is emitted it is absolute (`uint(zoomBits)`); subsequent emissions
 * are signed deltas in the *current* zoom's grid (`vsint`). Re-quantizing
 * the previous value into the new grid each time keeps deltas small even
 * across zoom changes.
 */

import { BitReader, BitWriter, type Codec, enumOf, uint, vsint, vuint } from '../codec';
import { DEFAULT_PATH, PATH_STYLES } from '../types';
import type { Keyframe, PathStyle } from '../types';
import { lngLatToMercator, mercatorToLngLat, zoomBits } from './mercator';

// ---------------------------------------------------------------------------
// Field codecs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export interface WireKeyframe {
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
 * Mask uses precision-aware comparison: an axis is emitted if it would
 * round to a different int at the current zoom. This naturally re-emits
 * position when zoom precision increases, so the precision context shift
 * is handled implicitly.
 */
export const keyframesCodec: Codec<WireKeyframe[]> = {
	encode(arr, w) {
		w.frame('[length]', () => vuint.encode(arr.length, w));

		let prev: WireKeyframe = { ...KEYFRAME_DEFAULTS };
		let mxHasPrior = false;
		let myHasPrior = false;
		for (let idx = 0; idx < arr.length; idx++) {
			const item = arr[idx];
			w.frame(`[${idx}]`, () => {
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

				w.frame('[mask]', () => w.writeBits(mask, 8));

				const writeField = <T>(name: keyof WireKeyframe, c: Codec<T>, value: T) =>
					w.frame(name, () => c.encode(value, w));

				if (mask & (1 << 0)) writeField('t', tCodec, item.t);
				if (mask & (1 << 1)) writeField('zoom', zoomCodec, item.zoom);
				if (mask & (1 << 2)) {
					w.frame('mx', () => {
						if (mxHasPrior) encodeMercatorAxisDelta(item.mx, prev.mx, effZoom, w);
						else encodeMercatorAxisAbsolute(item.mx, effZoom, w);
					});
					mxHasPrior = true;
				}
				if (mask & (1 << 3)) {
					w.frame('my', () => {
						if (myHasPrior) encodeMercatorAxisDelta(item.my, prev.my, effZoom, w);
						else encodeMercatorAxisAbsolute(item.my, effZoom, w);
					});
					myHasPrior = true;
				}
				if (mask & (1 << 4)) writeField('pitch', pitchCodec, item.pitch);
				if (mask & (1 << 5)) writeField('bearing', bearingCodec, item.bearing);
				if (mask & (1 << 6)) writeField('roll', rollCodec, item.roll);
				if (mask & (1 << 7)) writeField('path', pathCodec, item.path);

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
			});
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
// Wire ↔ application conversions
// ---------------------------------------------------------------------------

export function normalizeKeyframe(kf: Keyframe): WireKeyframe {
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

export function denormalizeKeyframe(wire: WireKeyframe): Keyframe {
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
