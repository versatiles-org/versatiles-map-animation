import { describe, expect, it } from 'vitest';
import { FORMATS, QUALITIES, validateEncoding } from '../../render/formats.mjs';
import {
	buildRenderCommand,
	hasQualityLevels,
	renderOutputName,
	VIDEO_FORMATS,
	VIDEO_QUALITIES,
	type RenderSettings
} from './render_command';

const base: RenderSettings = {
	hash: 'AhQQabc',
	width: 1920,
	height: 1080,
	fps: 30,
	motionBlur: 1,
	shutterAngle: 180,
	format: 'mp4',
	quality: 'standard'
};
const PREFIX =
	'docker run --rm -it --pull always -v "$PWD:/out" ghcr.io/versatiles-org/versatiles-map-animator:latest';

describe('choices of the export dialog', () => {
	it('offers exactly the formats and quality levels the renderer has, each with its own wording', () => {
		expect(VIDEO_FORMATS.map((f) => f.id)).toEqual(Object.keys(FORMATS));
		expect(VIDEO_QUALITIES.map((q) => q.id)).toEqual(Object.keys(QUALITIES));
		for (const choice of [...VIDEO_FORMATS, ...VIDEO_QUALITIES]) {
			// Falls back to the bare id when the dialog has no text for a new entry.
			expect(choice.label).not.toBe(choice.id);
		}
		for (const format of VIDEO_FORMATS) expect(format.description.length).toBeGreaterThan(20);
	});

	it('says of the lossless formats that they are lossless', () => {
		for (const format of VIDEO_FORMATS) {
			expect(format.label.includes('lossless')).toBe(FORMATS[format.id].lossless);
		}
	});

	it('only MP4 has quality levels', () => {
		expect(VIDEO_FORMATS.filter((f) => hasQualityLevels(f.id)).map((f) => f.id)).toEqual(['mp4']);
	});

	it('names the output after the format', () => {
		expect(VIDEO_FORMATS.map((f) => renderOutputName(f.id))).toEqual([
			'animation.mp4',
			'animation.mov',
			'animation.mkv',
			'animation.mov'
		]);
	});
});

describe('buildRenderCommand', () => {
	it('is the plain command for the defaults — as short as it always was', () => {
		expect(buildRenderCommand(base)).toBe(
			`${PREFIX} --hash 'AhQQabc' --width 1920 --height 1080 --fps 30 --output animation.mp4`
		);
	});

	it('adds motion blur, and the shutter angle only when it is not the default', () => {
		expect(buildRenderCommand({ ...base, motionBlur: 8 })).toContain(
			'--fps 30 --motion-blur 8 --output'
		);
		expect(buildRenderCommand({ ...base, motionBlur: 8, shutterAngle: 90 })).toContain(
			'--motion-blur 8 --shutter-angle 90 --output'
		);
		expect(buildRenderCommand({ ...base, shutterAngle: 90 })).not.toContain('--shutter-angle');
	});

	it('adds the quality only for MP4 and only when it is not standard', () => {
		expect(buildRenderCommand({ ...base, quality: 'high' })).toContain(
			'--quality high --output animation.mp4'
		);
		expect(buildRenderCommand({ ...base, quality: 'small' })).toContain('--quality small');
		expect(buildRenderCommand(base)).not.toContain('--quality');
		// A quality left over from before the format was switched must not leak.
		expect(buildRenderCommand({ ...base, format: 'ffv1', quality: 'high' })).not.toContain(
			'--quality'
		);
	});

	it('adds the format and the matching file name', () => {
		expect(buildRenderCommand({ ...base, format: 'prores' })).toContain(
			'--format prores --output animation.mov'
		);
		expect(buildRenderCommand({ ...base, format: 'ffv1' })).toContain(
			'--format ffv1 --output animation.mkv'
		);
		expect(buildRenderCommand({ ...base, format: 'animation' })).toContain(
			'--format animation --output animation.mov'
		);
		expect(buildRenderCommand(base)).not.toContain('--format');
	});

	it('only ever builds commands the renderer accepts', () => {
		for (const format of VIDEO_FORMATS) {
			for (const quality of VIDEO_QUALITIES) {
				const command = buildRenderCommand({ ...base, format: format.id, quality: quality.id });
				const flag = (name: string) => command.match(new RegExp(`--${name} (\\S+)`))?.[1];
				expect(() =>
					validateEncoding({
						fps: 30,
						motionBlur: 1,
						format: flag('format'),
						quality: flag('quality'),
						output: flag('output')
					})
				).not.toThrow();
			}
		}
	});
});
