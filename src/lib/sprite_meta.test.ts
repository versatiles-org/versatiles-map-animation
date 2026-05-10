import { describe, it, expect } from 'vitest';
import { ANNOTATION_SPRITE_PNG_URL, spritePreviewStyle } from './sprite_meta';

describe('spritePreviewStyle', () => {
	it('embeds the sprite URL and pixel sizes', () => {
		const css = spritePreviewStyle('symbol-marker', 32);
		expect(css).toContain(ANNOTATION_SPRITE_PNG_URL);
		expect(css).toContain('width: 32px');
		expect(css).toContain('height: 32px');
	});

	it('scales the background size proportionally to displayPx', () => {
		const at32 = spritePreviewStyle('symbol-marker', 32);
		const at64 = spritePreviewStyle('symbol-marker', 64);
		// scale = 1 → 224×192; scale = 2 → 448×384
		expect(at32).toContain('--sprite-size: 224px 192px');
		expect(at64).toContain('--sprite-size: 448px 384px');
	});

	it('emits the per-icon rotation offset (arrows = 90deg)', () => {
		const arrow = spritePreviewStyle('symbol-arrow', 32);
		expect(arrow).toContain('--sprite-rotate: 90deg');
		const marker = spritePreviewStyle('symbol-marker', 32);
		expect(marker).toContain('--sprite-rotate: 0deg');
	});
});
