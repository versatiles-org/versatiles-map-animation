/**
 * Render jobs: what a user asked for, where it stands, and the files it
 * produced. Each job is a folder in `<data>/jobs/` with a `job.json` and,
 * once it is done, the video, a small preview and a poster image.
 *
 * Status: `queued` → `rendering` → `finished`, or `failed` / `cancelled`.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_FORMAT, DEFAULT_QUALITY, FORMATS, QUALITIES } from '../render/formats.mjs';

export const WIDTHS = [640, 1280, 1920, 3840];
export const FRAME_RATES = [24, 25, 30, 50, 60];
/** Sub-frames per frame and shutter angle in degrees: the renderer's limits. */
export const MOTION_BLUR = { min: 1, max: 32 };
export const SHUTTER_ANGLE = { min: 1, max: 360, default: 180 };
export const STATUSES = ['queued', 'rendering', 'finished', 'failed', 'cancelled'];

const DEFAULT_SETTINGS = {
	width: 1280,
	fps: 30,
	format: DEFAULT_FORMAT,
	quality: DEFAULT_QUALITY,
	motionBlur: 1,
	shutterAngle: SHUTTER_ANGLE.default
};

/**
 * @typedef {object} Settings
 * @property {number} width
 * @property {number} fps
 * @property {string} format      a key of `FORMATS`
 * @property {string} quality     a key of `QUALITIES`; used for `mp4` only
 * @property {number} motionBlur  sub-frames per frame, 1 = off
 * @property {number} shutterAngle  degrees of each frame the sub-frames span
 *
 * @typedef {object} Progress
 * @property {string} phase  `preparing`, `warming`, `rendering`, `encoding` or `preview`
 * @property {number} [done]
 * @property {number} [total]
 * @property {number} [eta]  seconds
 *
 * @typedef {object} Job
 * @property {string} id
 * @property {string} user
 * @property {string} title
 * @property {string} hash        the animation, as in the editor's share links
 * @property {Settings} settings
 * @property {string} status      one of `STATUSES`
 * @property {string} createdAt   ISO time
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {Progress} [progress]
 * @property {number} [width]     pixels of the video, once the renderer has said
 * @property {number} [height]
 * @property {number} [duration]  seconds of video
 * @property {number} [size]      bytes of the video
 * @property {string} [error]     the end of the renderer's output, when it failed
 */

/**
 * The animation in a share link, a `#kf=…` fragment or a bare hash — the
 * same forms the renderer takes.
 */
export function extractHash(input) {
	const text = String(input ?? '').trim();
	const fragment = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text;
	const hash = new URLSearchParams(fragment).get('kf') ?? fragment;
	return /^[A-Za-z0-9_-]{8,200000}$/.test(hash) ? hash : null;
}

/** Throw an error that the server answers with status 400 and its message. */
function invalid(message) {
	throw Object.assign(new Error(message), { status: 400 });
}

/** Pick `value` out of `allowed`, or the default; anything else is an error. */
function oneOf(name, value, allowed, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	const match = allowed.find((a) => String(a) === String(value));
	if (match === undefined) invalid(`${name} must be one of ${allowed.join(', ')}`);
	return match;
}

/** A whole number from `min` to `max`, or the default; anything else is an error. */
function wholeNumber(name, value, { min, max }, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max)
		invalid(`${name} must be a whole number from ${min} to ${max}`);
	return n;
}

/**
 * What a request to render asks for, checked: `{ hash, title, settings }`.
 * Throws an error with `status` 400 for anything it cannot take.
 */
export function parseJobRequest(body) {
	if (!body || typeof body !== 'object') invalid('Expected a JSON object');
	const hash = extractHash(body.link ?? body.hash);
	if (!hash) invalid('Paste a share link of the editor, or its hash');
	const title = String(body.title ?? '')
		.replace(/\p{Cc}/gu, ' ')
		.trim()
		.slice(0, 120);
	const s = body.settings ?? {};
	/** @type {Settings} */
	const settings = {
		width: oneOf('width', s.width, WIDTHS, DEFAULT_SETTINGS.width),
		fps: oneOf('fps', s.fps, FRAME_RATES, DEFAULT_SETTINGS.fps),
		format: oneOf('format', s.format, Object.keys(FORMATS), DEFAULT_SETTINGS.format),
		quality: oneOf('quality', s.quality, Object.keys(QUALITIES), DEFAULT_SETTINGS.quality),
		motionBlur: wholeNumber('motionBlur', s.motionBlur, MOTION_BLUR, DEFAULT_SETTINGS.motionBlur),
		shutterAngle: wholeNumber(
			'shutterAngle',
			s.shutterAngle,
			SHUTTER_ANGLE,
			DEFAULT_SETTINGS.shutterAngle
		)
	};
	return { hash, title, settings };
}

/** The file name of a job's video in its folder. */
export function videoFile(job) {
	return 'video' + FORMATS[job.settings.format].extension;
}

/** The name a job's video is downloaded as: its title (or a default) and its day. */
export function downloadName(job) {
	const base =
		job.title
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^A-Za-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.toLowerCase()
			.slice(0, 60) || 'map-animation';
	return `${base}-${job.createdAt.slice(0, 10)}${FORMATS[job.settings.format].extension}`;
}

/** The renderer's arguments for a job, writing to `output`. */
export function rendererArgs(job, output) {
	const { width, fps, format, quality, motionBlur, shutterAngle } = job.settings;
	return [
		'--hash',
		job.hash,
		'--width',
		String(width),
		'--fps',
		String(fps),
		'--format',
		format,
		...(format === 'mp4' ? ['--quality', quality] : []),
		...(motionBlur > 1 ? ['--motion-blur', String(motionBlur)] : []),
		...(motionBlur > 1 && shutterAngle && shutterAngle !== SHUTTER_ANGLE.default
			? ['--shutter-angle', String(shutterAngle)]
			: []),
		'--progress-json',
		'--output',
		output
	];
}

/** What a user's browser gets to see of a job: everything but the hash. */
export function publicJob(job) {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { hash, ...rest } = job;
	return rest;
}

/**
 * The jobs on disk, kept in memory too. `save` writes a job's `job.json`
 * in one piece (to a temporary file, then renamed), so a crash never leaves
 * half of one behind.
 */
export class JobStore {
	#dir;
	/** @type {Map<string, Job>} */
	#jobs = new Map();

	constructor(dataDir) {
		this.#dir = join(dataDir, 'jobs');
	}

	/** Read all jobs from disk. Folders without a readable `job.json` are skipped. */
	async load() {
		await mkdir(this.#dir, { recursive: true });
		this.#jobs.clear();
		for (const entry of await readdir(this.#dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			try {
				const job = JSON.parse(await readFile(join(this.#dir, entry.name, 'job.json'), 'utf8'));
				if (job.id === entry.name) this.#jobs.set(job.id, job);
			} catch {
				// A folder of something else, or a job that never got its file.
			}
		}
	}

	/** All jobs, or those of `user`; the newest first. */
	list(user) {
		return [...this.#jobs.values()]
			.filter((job) => user === undefined || job.user === user)
			.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
	}

	get(id) {
		return this.#jobs.get(id) ?? null;
	}

	/** The job that has waited longest, or `null`. */
	nextQueued() {
		return (
			this.list()
				.reverse()
				.find((job) => job.status === 'queued') ?? null
		);
	}

	/** A new job in the queue. */
	async create({ user, hash, title, settings }) {
		const now = new Date();
		// Sortable by time, and not guessable.
		const id = `${now.getTime().toString(36)}-${randomBytes(6).toString('hex')}`;
		/** @type {Job} */
		const job = { id, user, title, hash, settings, status: 'queued', createdAt: now.toISOString() };
		await mkdir(join(this.#dir, id), { recursive: true });
		this.#jobs.set(id, job);
		await this.save(job);
		return job;
	}

	async save(job) {
		const file = this.path(job, 'job.json');
		await writeFile(file + '.tmp', JSON.stringify(job, null, '\t'));
		await rename(file + '.tmp', file);
	}

	/** Delete a job and its files. */
	async remove(job) {
		this.#jobs.delete(job.id);
		await rm(join(this.#dir, job.id), { recursive: true, force: true });
	}

	/** Where a file of a job lives. */
	path(job, file) {
		return join(this.#dir, job.id, file);
	}
}
