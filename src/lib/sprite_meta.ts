/**
 * Static metadata for the markers sprite atlas. Pulled from the live
 * `sprites.json` once and pinned here so we can render icon previews in the
 * UI without depending on a runtime fetch. The atlas dimensions and per-icon
 * pixel positions are stable across atlas rebuilds (we'd rather catch a
 * version drift in code review than leave the picker silently broken).
 */

import type { AnnotationIcon } from './types';

export const ANNOTATION_SPRITE_PNG_URL =
	'https://tiles.versatiles.org/assets/sprites/markers/sprites.png';

export const ANNOTATION_SPRITE_ATLAS_W = 224;
export const ANNOTATION_SPRITE_ATLAS_H = 192;
export const ANNOTATION_SPRITE_PX = 32;

/** Top-left pixel of each icon in the atlas (all icons are 32×32). */
export const ANNOTATION_SPRITE_POS: Record<AnnotationIcon, [number, number]> = {
	'symbol-marker': [160, 96],
	'symbol-marker_outline': [160, 128],
	'symbol-circle': [0, 128],
	'symbol-circle_outline': [32, 128],
	'symbol-star': [64, 160],
	'symbol-star_outline': [96, 160],
	'symbol-arrow': [128, 32],
	'symbol-arrow1': [128, 64],
	'symbol-arrow2': [128, 96],
	'icon-home': [0, 64],
	'icon-mountain': [96, 0],
	'icon-information': [32, 64]
};

/**
 * Inline style for a square sprite preview chip. Emits the *size* of the
 * preview directly and exposes the per-icon background position/size as CSS
 * variables so the consumer's stylesheet can render the sprite via a
 * `::after` pseudo-element. That layering is what lets us invert just the
 * icon's pixels (black-on-transparent → white-on-transparent) without also
 * inverting the surrounding "white on black" chip.
 */
export function spritePreviewStyle(icon: AnnotationIcon, displayPx: number): string {
	const [sx, sy] = ANNOTATION_SPRITE_POS[icon];
	const scale = displayPx / ANNOTATION_SPRITE_PX;
	return [
		`width: ${displayPx}px`,
		`height: ${displayPx}px`,
		`--sprite-bg: url('${ANNOTATION_SPRITE_PNG_URL}')`,
		`--sprite-pos: -${sx * scale}px -${sy * scale}px`,
		`--sprite-size: ${ANNOTATION_SPRITE_ATLAS_W * scale}px ${ANNOTATION_SPRITE_ATLAS_H * scale}px`
	].join('; ');
}
