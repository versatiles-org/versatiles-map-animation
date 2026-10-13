/**
 * The `docker run` command that renders an animation to a video file with
 * the standalone renderer image, and the choices the export dialog offers
 * for it. Which formats and quality levels exist, and what file each
 * writes, comes from the renderer itself (`render/formats.mjs`), so the
 * dialog cannot offer something the renderer does not know.
 */

import { DEFAULT_FORMAT, DEFAULT_QUALITY, FORMATS, QUALITIES } from '../../render/formats.mjs';

export const RENDER_IMAGE = 'ghcr.io/versatiles-org/versatiles-map-animator:latest';

export { DEFAULT_FORMAT, DEFAULT_QUALITY };

/** Shutter angle the renderer uses when none is given. */
export const DEFAULT_SHUTTER_ANGLE = 180;

interface Choice {
	id: string;
	/** Short name for the picker. */
	label: string;
	/** What it is and what it is for, as a sentence for the hint line. */
	description: string;
}

/** How the dialog words each format of the renderer. */
const FORMAT_TEXTS: Record<string, Omit<Choice, 'id'>> = {
	mp4: {
		label: 'MP4 (H.264)',
		description: 'Small and plays everywhere — for the web and social media.'
	},
	prores: {
		label: 'ProRes 4444',
		description:
			'Visually lossless, for editing in Premiere, Final Cut or DaVinci Resolve. Large files.'
	},
	ffv1: {
		label: 'FFV1 (lossless)',
		description:
			'Exactly the pixels of the map, compactly stored. Opens in DaVinci Resolve, VLC and ffmpeg, not in Adobe or Apple software.'
	},
	animation: {
		label: 'QuickTime Animation (lossless)',
		description:
			'Exactly the pixels of the map, for Adobe and Apple software. About twice the size of FFV1.'
	}
};

/** How the dialog words each quality level of the MP4 format. */
const QUALITY_TEXTS: Record<string, Omit<Choice, 'id'>> = {
	high: {
		label: 'High',
		description: 'Best for uploading to a platform that re-encodes the video.'
	},
	standard: { label: 'Standard', description: '' },
	small: {
		label: 'Small',
		description: 'About 40 % of the standard size — for embedding the file directly on a page.'
	}
};

const choices = (ids: string[], texts: Record<string, Omit<Choice, 'id'>>): Choice[] =>
	ids.map((id) => ({ id, ...(texts[id] ?? { label: id, description: '' }) }));

export const VIDEO_FORMATS = choices(Object.keys(FORMATS), FORMAT_TEXTS);
export const VIDEO_QUALITIES = choices(Object.keys(QUALITIES), QUALITY_TEXTS);

/** Does this format have quality levels to choose from? */
export function hasQualityLevels(format: string): boolean {
	return format === 'mp4';
}

/** The file the render lands in, in the directory the command is run from. */
export function renderOutputName(format: string): string {
	return `animation${(FORMATS[format] ?? FORMATS[DEFAULT_FORMAT]).extension}`;
}

export interface RenderSettings {
	/** The animation, as the URL-hash payload. */
	hash: string;
	width: number;
	height: number;
	fps: number;
	/** Sub-frames per output frame; 1 = off. */
	motionBlur: number;
	shutterAngle: number;
	format: string;
	quality: string;
}

/**
 * Single-line so users can paste-and-run. `--pull always` keeps the image
 * fresh; the working directory is mounted at /out so the file lands next to
 * where the user invoked the command. `-it` allocates a pseudo-TTY
 * (line-buffered progress bars, colour) and keeps stdin open so the user can
 * `Ctrl-C` to abort the render.
 *
 * Whatever equals the renderer's default is left out, so the plain MP4
 * command stays as short as it always was.
 */
export function buildRenderCommand(s: RenderSettings): string {
	const flags = [
		`--hash '${s.hash}'`,
		`--width ${s.width}`,
		`--height ${s.height}`,
		`--fps ${s.fps}`
	];
	if (s.motionBlur > 1) {
		flags.push(`--motion-blur ${s.motionBlur}`);
		if (s.shutterAngle !== DEFAULT_SHUTTER_ANGLE) flags.push(`--shutter-angle ${s.shutterAngle}`);
	}
	if (s.format !== DEFAULT_FORMAT) flags.push(`--format ${s.format}`);
	if (hasQualityLevels(s.format) && s.quality !== DEFAULT_QUALITY) {
		flags.push(`--quality ${s.quality}`);
	}
	flags.push(`--output ${renderOutputName(s.format)}`);
	return `docker run --rm -it --pull always -v "$PWD:/out" ${RENDER_IMAGE} ${flags.join(' ')}`;
}
