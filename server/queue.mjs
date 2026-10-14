/**
 * The one worker: renders the queued jobs one after the other, oldest
 * first, each by running the renderer (`render/render.mjs`) as a process of
 * its own — a render that crashes or hangs cannot take the server with it,
 * and cancelling one is ending its process. When a video is done, ffmpeg
 * makes a small preview and a poster image of it.
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { rendererArgs, videoFile } from './jobs.mjs';

/** Lines of the renderer's output kept to explain a failure. */
const LOG_LINES = 40;
/** How often the progress of a render is written to disk, at most. */
const SAVE_EVERY_MS = 3000;

/** Size of the preview: it fits into a square this wide and high. */
const PREVIEW_SIZE = 320;

/**
 * Run a program to its end. Resolves with its exit code; `onStdout` gets
 * each line it writes to stdout, `onStderr` each line (or progress update)
 * it writes to stderr.
 */
export function run(command, args, { onStdout, onStderr, onSpawn } = {}) {
	return new Promise((resolve, reject) => {
		// Its own process group, so that ending it ends the browser and the
		// ffmpeg it started, too.
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
		onSpawn?.(child);
		if (onStdout) createInterface({ input: child.stdout }).on('line', onStdout);
		else child.stdout.resume();
		// A terminal progress line ends in `\r`, not `\n`.
		let rest = '';
		child.stderr.on('data', (chunk) => {
			const parts = (rest + chunk.toString()).split(/[\r\n]+/);
			rest = parts.pop() ?? '';
			for (const line of parts) if (line.trim()) onStderr?.(line);
		});
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (rest.trim()) onStderr?.(rest);
			resolve(code ?? (signal ? 128 : 1));
		});
	});
}

/** Make the preview and poster of a finished video with ffmpeg. */
export async function makePreview(ffmpeg, video, preview, poster, duration) {
	const fit =
		`scale=w=${PREVIEW_SIZE}:h=${PREVIEW_SIZE}:force_original_aspect_ratio=decrease` +
		':force_divisible_by=2';
	const lines = [];
	const collect = (/** @type {string} */ line) => lines.push(line);
	const encode = await run(
		ffmpeg,
		[
			'-y',
			'-v',
			'error',
			'-i',
			video,
			'-an',
			'-vf',
			`${fit},fps=15`,
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-crf',
			'30',
			'-pix_fmt',
			'yuv420p',
			'-movflags',
			'+faststart',
			preview
		],
		{ onStderr: collect }
	);
	if (encode !== 0)
		throw new Error(`preview: ${lines.join(' ') || `ffmpeg exited with ${encode}`}`);
	// The poster is a frame from the middle, where the animation is under way.
	const at = Math.max(0, (duration ?? 0) / 2).toFixed(2);
	const still = await run(
		ffmpeg,
		['-y', '-v', 'error', '-ss', at, '-i', preview, '-frames:v', '1', '-q:v', '4', poster],
		{ onStderr: collect }
	);
	if (still !== 0) throw new Error(`poster: ${lines.join(' ') || `ffmpeg exited with ${still}`}`);
}

export class RenderQueue {
	#store;
	#options;
	/** @type {{ job: import('./jobs.mjs').Job, child: import('node:child_process').ChildProcess | null, cancelled: boolean } | null} */
	#current = null;
	#idle = Promise.resolve();

	/**
	 * @param {import('./jobs.mjs').JobStore} store
	 * @param {{ renderer: string, renderArgs?: string[], ffmpeg?: string, node?: string, log?: (msg: string) => void, preview?: typeof makePreview }} options
	 */
	constructor(store, options) {
		this.#store = store;
		this.#options = {
			renderArgs: [],
			ffmpeg: 'ffmpeg',
			node: process.execPath,
			log: () => {},
			preview: makePreview,
			...options
		};
	}

	/**
	 * Begin work. A job that was being rendered when the server stopped is
	 * rendered again from the start, ahead of the others.
	 */
	async start() {
		for (const job of this.#store.list()) {
			if (job.status !== 'rendering') continue;
			job.status = 'queued';
			delete job.progress;
			delete job.startedAt;
			await this.#store.save(job);
		}
		this.kick();
	}

	/** Render the next job, unless one is being rendered already. */
	kick() {
		if (this.#current) return;
		const job = this.#store.nextQueued();
		if (!job) return;
		this.#current = { job, child: null, cancelled: false };
		this.#idle = this.#render(this.#current)
			.catch((err) => this.#options.log(`job ${job.id}: ${err.message}`))
			.finally(() => {
				this.#current = null;
				this.kick();
			});
	}

	/** Resolves when no job is being rendered (for tests and shutdown). */
	async idle() {
		while (this.#current) await this.#idle;
	}

	/** Stop a queued job, or end the render of the current one. */
	async cancel(job) {
		if (job.status === 'queued') {
			job.status = 'cancelled';
			job.finishedAt = new Date().toISOString();
			await this.#store.save(job);
		} else if (this.#current?.job === job) {
			this.#current.cancelled = true;
			const child = this.#current.child;
			if (child?.pid) {
				try {
					process.kill(-child.pid, 'SIGTERM');
				} catch {
					// Already gone.
				}
				// The browser may not go quietly.
				setTimeout(() => {
					try {
						if (child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
					} catch {
						// Gone by now.
					}
				}, 10_000).unref();
			}
		}
	}

	/** End the current render, for shutting down; it is queued again on the next start. */
	stop() {
		const child = this.#current?.child;
		if (child?.pid) {
			try {
				process.kill(-child.pid, 'SIGTERM');
			} catch {
				// Already gone.
			}
		}
	}

	async #render(current) {
		const { job } = current;
		const { log, node, renderer, renderArgs, ffmpeg, preview } = this.#options;
		const store = this.#store;
		job.status = 'rendering';
		job.startedAt = new Date().toISOString();
		job.progress = { phase: 'preparing' };
		await store.save(job);
		log(`job ${job.id}: rendering for ${job.user}`);

		const output = store.path(job, videoFile(job));
		/** @type {string[]} */
		const lines = [];
		let savedAt = Date.now();
		const code = await run(node, [renderer, ...rendererArgs(job, output), ...renderArgs], {
			onSpawn: (child) => (current.child = child),
			onStdout: (line) => {
				try {
					job.progress = JSON.parse(line);
				} catch {
					return;
				}
				const p = job.progress;
				// The renderer says how large the video is once it knows.
				if (p?.width && p.height) [job.width, job.height] = [p.width, p.height];
				if (p?.frames) job.duration = (p.frames - 1) / job.settings.fps;
				if (Date.now() - savedAt > SAVE_EVERY_MS) {
					savedAt = Date.now();
					store.save(job).catch(() => {});
				}
			},
			onStderr: (line) => {
				lines.push(line);
				if (lines.length > LOG_LINES) lines.shift();
			}
		});

		job.finishedAt = new Date().toISOString();
		delete job.progress;
		if (current.cancelled) {
			job.status = 'cancelled';
			log(`job ${job.id}: cancelled`);
		} else if (code !== 0) {
			job.status = 'failed';
			job.error = lines.join('\n') || `The renderer exited with code ${code}.`;
			log(`job ${job.id}: failed with code ${code}`);
		} else {
			try {
				job.progress = { phase: 'preview' };
				job.size = (await stat(output)).size;
				await preview(
					ffmpeg,
					output,
					store.path(job, 'preview.mp4'),
					store.path(job, 'poster.jpg'),
					job.duration
				);
				job.status = 'finished';
				log(`job ${job.id}: finished`);
			} catch (err) {
				job.status = 'failed';
				job.error = /** @type {Error} */ (err).message;
				log(`job ${job.id}: ${job.error}`);
			}
			delete job.progress;
			job.finishedAt = new Date().toISOString();
		}
		await store.save(job);
	}
}

/**
 * Delete the jobs that are over: finished, failed or cancelled more than
 * `keepDays` ago. Returns how many it deleted.
 */
export async function removeOldJobs(store, keepDays, now = Date.now()) {
	const limit = now - keepDays * 24 * 3600 * 1000;
	let removed = 0;
	for (const job of store.list()) {
		if (job.status === 'queued' || job.status === 'rendering') continue;
		if (Date.parse(job.finishedAt ?? job.createdAt) < limit) {
			await store.remove(job);
			removed++;
		}
	}
	return removed;
}
