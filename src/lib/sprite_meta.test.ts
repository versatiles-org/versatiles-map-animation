import { describe, it, expect } from 'vitest';
import { annotationSpritePngUrl, spritePreviewStyle } from './sprite_meta';

describe('spritePreviewStyle', () => {
	it('embeds the sprite URL and pixel sizes', () => {
		const css = spritePreviewStyle('symbol-marker', 32);
		expect(css).toContain(annotationSpritePngUrl('extras'));
		expect(css).toContain('width: 32px');
		expect(css).toContain('height: 32px');
	});

	it('scales the background size proportionally to displayPx', () => {
		const at32 = spritePreviewStyle('symbol-circle', 32);
		const at64 = spritePreviewStyle('symbol-circle', 64);
		// scale = 1 → 352×306; scale = 2 → 704×612
		expect(at32).toContain('--sprite-size: 352px 306px');
		expect(at64).toContain('--sprite-size: 704px 612px');
		expect(at32).toContain('--sprite-pos: 0px -178px');
	});

	it('fits non-square icons into the chip and centres them', () => {
		// The pin is 32×38: scaled by 19/38 to fit, then centred horizontally.
		const css = spritePreviewStyle('symbol-marker', 19);
		expect(css).toContain('--sprite-size: 176px 153px');
		expect(css).toContain('--sprite-pos: -30.5px 0px');
	});

	it('reads each icon from the sheet that holds it', () => {
		expect(spritePreviewStyle('icon-home', 32)).toContain(annotationSpritePngUrl('icons'));
		expect(spritePreviewStyle('icon-information', 32)).toContain(annotationSpritePngUrl('base'));
	});

	it('emits the per-icon rotation offset (arrows = 90deg)', () => {
		const arrow = spritePreviewStyle('symbol-arrow', 32);
		expect(arrow).toContain('--sprite-rotate: 90deg');
		const marker = spritePreviewStyle('symbol-marker', 32);
		expect(marker).toContain('--sprite-rotate: 0deg');
	});
});
