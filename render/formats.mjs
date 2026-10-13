// @ts-check
/**
 * Output formats of the renderer and the ffmpeg arguments that produce them.
 * Kept free of anything that needs a browser, so it can be unit-tested.
 *
 * Colour: the frames captured from Chromium are sRGB, 8 bits per channel,
 * full range. Every format keeps exactly those colours:
 *
 *  - The lossless formats store the RGB pixels as they are.
 *  - The YUV formats convert with the BT.709 matrix to limited range, which
 *    is what every player assumes for HD video, and say so in the file.
 *    (ffmpeg's default for this conversion is the BT.601 matrix of
 *    standard-definition video; played back as BT.709, pure green loses 15 %
 *    of its brightness and pure red picks up green.)
 *  - All of them are tagged with BT.709 primaries and the sRGB transfer
 *    curve, which is what the pixels are.
 */

/**
 * @typedef {object} Format
 * @property {string} extension  what the output file has to end in
 * @property {string} summary    one line for `--help`
 * @property {boolean} lossless
 * @property {string} pixelFormat  ffmpeg pixel format of the encoded video
 * @property {boolean} yuv        converted to YUV (needs matrix + range)
 * @property {string[]} encoder   ffmpeg encoder arguments
 */

/** @type {Record<string, Format>} */
export const FORMATS = {
	mp4: {
		extension: '.mp4',
		summary: 'H.264 in MP4 — small, plays everywhere; for the web and social media (default)',
		lossless: false,
		pixelFormat: 'yuv420p',
		yuv: true,
		encoder: ['-c:v', 'libx264', '-movflags', '+faststart']
	},
	prores: {
		extension: '.mov',
		summary: 'ProRes 4444 in MOV — visually lossless; for editing in Premiere, Final Cut, Resolve',
		lossless: false,
		pixelFormat: 'yuv444p10le',
		yuv: true,
		// `apl0` is the vendor tag Apple's own encoder writes; some tools check it.
		encoder: ['-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0']
	},
	ffv1: {
		extension: '.mkv',
		summary: 'FFV1 in MKV — lossless and compact; opens in Resolve, VLC, ffmpeg',
		lossless: true,
		pixelFormat: 'bgr0',
		yuv: false,
		// Version 3, every frame on its own, sliced for multithreading, with
		// checksums: the settings archives use.
		encoder: ['-c:v', 'ffv1', '-level', '3', '-g', '1', '-slices', '16', '-slicecrc', '1']
	},
	animation: {
		extension: '.mov',
		summary:
			'QuickTime Animation in MOV — lossless, about twice the size of FFV1; opens in Adobe and Apple software',
		lossless: true,
		pixelFormat: 'rgb24',
		yuv: false,
		encoder: ['-c:v', 'qtrle']
	}
};
export const DEFAULT_FORMAT = 'mp4';

/**
 * Named quality levels of the `mp4` format, as x264 CRF values (lower is
 * better and larger; three steps are roughly a third of the file size).
 * @type {Record<string, number>}
 */
export const QUALITIES = { high: 15, standard: 18, small: 24 };
export const DEFAULT_QUALITY = 'standard';
export const DEFAULT_PRESET = 'slow';

/**
 * @typedef {object} EncodingOptions
 * @property {string} [format]
 * @property {string} [quality]
 * @property {number | null} [crf]
 * @property {string | null} [preset]
 * @property {string} [output]
 * @property {number} fps
 * @property {number} motionBlur
 */

/**
 * Check the format-related options against each other. Throws an `Error`
 * with a message meant for the person at the command line.
 * @param {EncodingOptions} opts
 */
export function validateEncoding(opts) {
	const name = opts.format ?? DEFAULT_FORMAT;
	const format = FORMATS[name];
	if (!format) {
		throw new Error(`--format must be one of ${Object.keys(FORMATS).join('/')}, got ${name}`);
	}
	if (opts.quality !== undefined && !(opts.quality in QUALITIES)) {
		throw new Error(
			`--quality must be one of ${Object.keys(QUALITIES).join('/')}, got ${opts.quality}`
		);
	}
	if (opts.crf != null && (!Number.isInteger(opts.crf) || opts.crf < 0 || opts.crf > 51)) {
		throw new Error(`--crf must be an integer in 0..51, got ${opts.crf}`);
	}
	if (name !== 'mp4') {
		for (const [flag, value] of [
			['--quality', opts.quality],
			['--crf', opts.crf],
			['--preset', opts.preset]
		]) {
			if (value != null) {
				throw new Error(`${flag} only applies to --format mp4; ${name} has no quality setting`);
			}
		}
	}
	if (opts.output && !opts.output.toLowerCase().endsWith(format.extension)) {
		throw new Error(
			`--format ${name} writes a ${format.extension} file, but --output is "${opts.output}". ` +
				`Name it e.g. "animation${format.extension}".`
		);
	}
}

/**
 * The filter that averages `samples` sub-frames into each output frame.
 *
 * ffmpeg's `tmix=frames=N` averages every N consecutive frames; then
 * `select=not(mod(n+1,N))` keeps only the *last* frame of each complete
 * N-window. Net: each output frame is the average of N sub-frames that span
 * one output-frame's duration of animation time.
 *
 * Why not `fps=fps=…` to decimate? `tmix` is a sliding window — it emits one
 * frame per input, each being the average of the previous N inputs. A
 * timestamp-based decimator like `fps` picks the input frame nearest each
 * output time slot, which lands at tmix indices kN — but `tmix[kN]` averages
 * frames in [kN-N+1 .. kN], i.e. the END of output frame k-1's sub-frames +
 * the START of output frame k's. The result is a visible "doubled"
 * motion-blur trail per output frame. Keeping the indices kN-1 instead gives
 * the clean per-group average we want.
 *
 * `tpad=stop=1:stop_mode=clone` adds one trailing dummy frame so the
 * stream-end machinery flushes the last complete tmix window through
 * `select` (without it, the final group's frame at index totalN-1 gets
 * dropped at EOS).
 *
 * The two `zscale` calls do the averaging in **linear light**: the frames
 * are sRGB-encoded (perceptually uniform), but mixing photons in the real
 * world is linear. Averaging sRGB samples directly crushes shadows and
 * mid-tones. So: to linear, average, back to sRGB — the same curve the
 * frames came in with, so a part of the picture that does not move keeps
 * exactly its colours. In between the pixels have 16 bits per channel;
 * linear light in 8 bits has far too few steps in the shadows. Requires
 * ffmpeg built with libzimg — the static build in the Docker image has it,
 * and so does Debian's `ffmpeg` package.
 * @param {number} samples
 * @returns {string[]}
 */
export function motionBlurFilters(samples) {
	const rgb = 'pin=bt709:p=bt709:rin=full:r=full:min=gbr:m=gbr';
	return [
		'format=gbrp16le',
		`zscale=tin=iec61966-2-1:t=linear:${rgb}`,
		'tpad=stop=1:stop_mode=clone',
		`tmix=frames=${samples}`,
		// `\,` escapes the comma inside the select expression so ffmpeg
		// doesn't read it as the end of the filter.
		`select=not(mod(n+1\\,${samples}))`,
		`zscale=tin=linear:t=iec61966-2-1:${rgb}`
	];
}

/**
 * Everything ffmpeg needs after its input: filters, encoder, colour tags.
 * The output path is not included.
 * @param {EncodingOptions} opts
 * @returns {string[]}
 */
export function encodingArgs(opts) {
	const name = opts.format ?? DEFAULT_FORMAT;
	const format = FORMATS[name];
	const samples = Math.max(1, opts.motionBlur);
	const args = [];

	const filters = samples > 1 ? motionBlurFilters(samples) : [];
	// See the note on colour at the top of this file. The pixel format is
	// part of the chain so the matrix applies to this very conversion and
	// ffmpeg does not add one of its own afterwards.
	if (format.yuv) {
		// Halving the colour resolution straight from the 16-bit pixels of the
		// blur makes ffmpeg use a sharpening filter that rings at coloured
		// edges; from 8-bit RGB it averages, as it does without motion blur.
		if (samples > 1 && format.pixelFormat === 'yuv420p') filters.push('format=rgb24');
		filters.push('scale=out_color_matrix=bt709:out_range=tv');
	}
	if (filters.length > 0) filters.push(`format=${format.pixelFormat}`);
	// The tags have to be set on the frames: recent ffmpeg versions take them
	// from there and ignore the output options below when the two disagree.
	filters.push(
		'setparams=color_primaries=bt709:color_trc=iec61966-2-1' +
			(format.yuv ? ':colorspace=bt709:range=tv' : '')
	);
	args.push('-vf', filters.join(','));
	if (samples > 1) args.push('-r', String(opts.fps));

	args.push(...format.encoder);
	if (name === 'mp4') {
		const crf = opts.crf ?? QUALITIES[opts.quality ?? DEFAULT_QUALITY];
		args.push('-preset', opts.preset ?? DEFAULT_PRESET, '-crf', String(crf));
	}
	args.push('-pix_fmt', format.pixelFormat);
	if (format.yuv) args.push('-colorspace', 'bt709', '-color_range', 'tv');
	args.push('-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1');
	return args;
}
