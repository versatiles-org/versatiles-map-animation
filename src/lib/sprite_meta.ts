/**
 * Static metadata for the sprite atlases that hold the annotation icons.
 * Pulled from the live `<sheet>.json` once and pinned here so we can render
 * icon previews in the UI without depending on a runtime fetch. A sheet
 * rebuild can move icons around, so re-pin these when the sprites are
 * updated (we'd rather catch a version drift in code review than leave the
 * picker silently broken).
 */

import { ANNOTATION_ICON_ROTATION_OFFSETS, type AnnotationIcon } from './types';

const SPRITE_BASE_URL = 'https://tiles.versatiles.org/assets/sprites';

type SpriteSheet = 'extras' | 'icons' | 'base';

/** Atlas dimensions (px, at pixelRatio 1) of each sheet. */
const ANNOTATION_SPRITE_ATLAS: Record<SpriteSheet, [number, number]> = {
	extras: [352, 306],
	icons: [384, 384],
	base: [384, 352]
};

export function annotationSpritePngUrl(sheet: SpriteSheet): string {
	return `${SPRITE_BASE_URL}/${sheet}.png`;
}

/** Sheet plus `[x, y, width, height]` of each icon in its atlas. */
export const ANNOTATION_SPRITE_POS: Record<
	AnnotationIcon,
	[SpriteSheet, number, number, number, number]
> = {
	'symbol-marker': ['extras', 64, 0, 32, 38],
	'symbol-marker_outline': ['extras', 128, 76, 32, 38],
	'symbol-circle': ['extras', 0, 178, 32, 32],
	'symbol-circle_outline': ['extras', 32, 178, 32, 32],
	'symbol-star': ['extras', 256, 32, 32, 32],
	'symbol-star_outline': ['extras', 256, 192, 32, 32],
	'symbol-arrow': ['extras', 128, 242, 32, 32],
	'symbol-arrow1': ['extras', 160, 242, 32, 32],
	'symbol-arrow2': ['extras', 192, 242, 32, 32],
	'icon-home': ['icons', 256, 32, 32, 32],
	'icon-mountain': ['icons', 192, 256, 32, 32],
	'icon-information': ['base', 320, 320, 32, 32]
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
	const [sheet, sx, sy, sw, sh] = ANNOTATION_SPRITE_POS[icon];
	const [atlasW, atlasH] = ANNOTATION_SPRITE_ATLAS[sheet];
	// Fit the icon's longer side into the chip and centre the shorter one;
	// the neighbours that peek in beside a non-square icon are transparent
	// SDF padding.
	const scale = displayPx / Math.max(sw, sh);
	const px = (displayPx - sw * scale) / 2 - sx * scale;
	const py = (displayPx - sh * scale) / 2 - sy * scale;
	// Apply the same per-icon rotation offset the map uses, so what the user
	// sees in the dropdown matches what they'll get on the map at rotation 0.
	const offsetDeg = ANNOTATION_ICON_ROTATION_OFFSETS[icon];
	return [
		`width: ${displayPx}px`,
		`height: ${displayPx}px`,
		`--sprite-bg: url('${annotationSpritePngUrl(sheet)}')`,
		`--sprite-pos: ${px}px ${py}px`,
		`--sprite-size: ${atlasW * scale}px ${atlasH * scale}px`,
		`--sprite-rotate: ${offsetDeg}deg`
	].join('; ');
}
