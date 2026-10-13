import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FORMAT,
	encodingArgs,
	FORMATS,
	motionBlurFilters,
	QUALITIES,
	validateEncoding
} from './formats.mjs';

const base = { fps: 30, motionBlur: 1 };
/** The value following a flag in an argument list. */
const valueOf = (args, flag) => args[args.indexOf(flag) + 1];
const filtersOf = (args) => valueOf(args, '-vf').split(/,(?=[a-z])/);

describe('formats', () => {
	it('offers H.264, ProRes and two lossless formats, H.264 by default', () => {
		expect(Object.keys(FORMATS)).toEqual(['mp4', 'prores', 'ffv1', 'animation']);
		expect(DEFAULT_FORMAT).toBe('mp4');
		expect(
			Object.entries(FORMATS)
				.filter(([, f]) => f.lossless)
				.map(([name]) => name)
		).toEqual(['ffv1', 'animation']);
	});

	it('keeps the lossless formats in RGB and converts the others to YUV', () => {
		for (const format of Object.values(FORMATS)) {
			expect(format.yuv).toBe(format.pixelFormat.startsWith('yuv'));
			if (format.lossless) expect(format.yuv).toBe(false);
		}
	});
});

describe('encodingArgs', () => {
	it('encodes H.264 at the standard quality by default', () => {
		const args = encodingArgs(base);
		expect(valueOf(args, '-c:v')).toBe('libx264');
		expect(valueOf(args, '-crf')).toBe('18');
		expect(valueOf(args, '-preset')).toBe('slow');
		expect(valueOf(args, '-pix_fmt')).toBe('yuv420p');
		expect(valueOf(args, '-movflags')).toBe('+faststart');
	});

	it('maps the named quality levels to CRF, and lets --crf override them', () => {
		expect(QUALITIES).toEqual({ high: 15, standard: 18, small: 24 });
		for (const [quality, crf] of Object.entries(QUALITIES)) {
			expect(valueOf(encodingArgs({ ...base, quality }), '-crf')).toBe(String(crf));
		}
		expect(valueOf(encodingArgs({ ...base, quality: 'small', crf: 20 }), '-crf')).toBe('20');
		expect(valueOf(encodingArgs({ ...base, crf: 0 }), '-crf')).toBe('0');
		expect(valueOf(encodingArgs({ ...base, preset: 'veryfast' }), '-preset')).toBe('veryfast');
	});

	it('picks the encoder and pixel format of each format, without H.264 settings', () => {
		const expected = {
			prores: ['prores_ks', 'yuv444p10le'],
			ffv1: ['ffv1', 'bgr0'],
			animation: ['qtrle', 'rgb24']
		};
		for (const [format, [codec, pixelFormat]] of Object.entries(expected)) {
			const args = encodingArgs({ ...base, format });
			expect(valueOf(args, '-c:v')).toBe(codec);
			expect(valueOf(args, '-pix_fmt')).toBe(pixelFormat);
			expect(args).not.toContain('-crf');
			expect(args).not.toContain('-preset');
		}
		expect(valueOf(encodingArgs({ ...base, format: 'prores' }), '-profile:v')).toBe('4444');
	});

	it('converts to YUV with the BT.709 matrix and limited range, never the default of ffmpeg', () => {
		for (const format of ['mp4', 'prores']) {
			const args = encodingArgs({ ...base, format });
			expect(filtersOf(args)[0]).toBe('scale=out_color_matrix=bt709:out_range=tv');
			expect(valueOf(args, '-colorspace')).toBe('bt709');
			expect(valueOf(args, '-color_range')).toBe('tv');
		}
	});

	it('does not touch the pixels of a lossless format: only tags are set', () => {
		for (const format of ['ffv1', 'animation']) {
			const args = encodingArgs({ ...base, format });
			expect(filtersOf(args)).toEqual(['setparams=color_primaries=bt709:color_trc=iec61966-2-1']);
			expect(args).not.toContain('-colorspace');
		}
	});

	it('tags every format as BT.709 primaries with the sRGB curve, on the frames too', () => {
		for (const format of Object.keys(FORMATS)) {
			for (const motionBlur of [1, 8]) {
				const args = encodingArgs({ ...base, format, motionBlur });
				expect(valueOf(args, '-color_primaries')).toBe('bt709');
				expect(valueOf(args, '-color_trc')).toBe('iec61966-2-1');
				expect(filtersOf(args).at(-1)).toMatch(
					/^setparams=color_primaries=bt709:color_trc=iec61966-2-1/
				);
			}
		}
	});

	it('adds the motion blur in front and restores the frame rate', () => {
		const plain = encodingArgs({ ...base, format: 'ffv1' });
		const blurred = encodingArgs({ ...base, format: 'ffv1', motionBlur: 8 });
		expect(plain).not.toContain('-r');
		expect(valueOf(blurred, '-r')).toBe('30');
		expect(filtersOf(blurred).slice(0, 6)).toEqual(motionBlurFilters(8));
		expect(filtersOf(blurred)).toContain('format=bgr0');
	});

	it('halves the colour resolution of blurred H.264 from 8-bit RGB, like unblurred', () => {
		const filters = filtersOf(encodingArgs({ ...base, motionBlur: 4 }));
		expect(filters.slice(6)).toEqual([
			'format=rgb24',
			'scale=out_color_matrix=bt709:out_range=tv',
			'format=yuv420p',
			'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv'
		]);
		// ProRes keeps full colour resolution and the blur's extra precision.
		expect(filtersOf(encodingArgs({ ...base, format: 'prores', motionBlur: 4 }))).not.toContain(
			'format=rgb24'
		);
	});
});

describe('motionBlurFilters', () => {
	it('averages in linear light at 16 bits and returns to the sRGB curve it came from', () => {
		const filters = motionBlurFilters(4);
		expect(filters[0]).toBe('format=gbrp16le');
		expect(filters[1]).toContain('tin=iec61966-2-1:t=linear');
		expect(filters).toContain('tmix=frames=4');
		expect(filters).toContain('select=not(mod(n+1\\,4))');
		expect(filters.at(-1)).toContain('tin=linear:t=iec61966-2-1');
	});
});

describe('validateEncoding', () => {
	const ok = (opts) => expect(() => validateEncoding({ ...base, ...opts })).not.toThrow();
	const fails = (opts, message) =>
		expect(() => validateEncoding({ ...base, ...opts })).toThrow(message);

	it('accepts the defaults and every format with a matching file name', () => {
		ok({});
		ok({ output: '/out/animation.mp4' });
		ok({ format: 'prores', output: 'a.mov' });
		ok({ format: 'ffv1', output: 'a.MKV' });
		ok({ format: 'animation', output: 'a.mov' });
		ok({ quality: 'high', output: 'a.mp4' });
		ok({ crf: 0, preset: 'veryslow' });
	});

	it('rejects unknown formats and quality levels, naming the choices', () => {
		fails({ format: 'gif' }, /--format must be one of mp4\/prores\/ffv1\/animation, got gif/);
		fails({ quality: 'best' }, /--quality must be one of high\/standard\/small, got best/);
		fails({ crf: 60 }, /--crf must be an integer in 0\.\.51/);
		fails({ crf: NaN }, /--crf/);
	});

	it('rejects H.264 settings for the other formats', () => {
		fails({ format: 'ffv1', quality: 'high' }, /--quality only applies to --format mp4/);
		fails({ format: 'prores', crf: 10 }, /--crf only applies to --format mp4/);
		fails({ format: 'animation', preset: 'fast' }, /--preset only applies to --format mp4/);
	});

	it('rejects an output name that does not fit the format, and says which would', () => {
		fails({ format: 'ffv1', output: 'animation.mp4' }, /writes a \.mkv file.*animation\.mkv/);
		fails({ output: 'animation.mov' }, /writes a \.mp4 file/);
		fails({ format: 'prores', output: 'animation' }, /writes a \.mov file/);
	});
});
