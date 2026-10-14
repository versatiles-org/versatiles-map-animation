// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	downloadName,
	extractHash,
	JobStore,
	parseJobRequest,
	publicJob,
	rendererArgs,
	videoFile
} from './jobs.mjs';

const HASH = 'AhsYd1UXQykn8O2DnpN81PQfwj7AruqD-Ebi7wmcdTi0Q3wAAFoBRx4ayLIA';

describe('extractHash', () => {
	it('takes a share link, a fragment or a bare hash', () => {
		expect(extractHash(`http://1.2.3.4:8080/#kf=${HASH}`)).toBe(HASH);
		expect(extractHash(`https://example.org/view?t=2#kf=${HASH}&x=1`)).toBe(HASH);
		expect(extractHash(`kf=${HASH}`)).toBe(HASH);
		expect(extractHash(`  ${HASH}\n`)).toBe(HASH);
	});

	it('takes nothing else', () => {
		for (const bad of ['', 'short', 'has spaces in it', `#kf=${HASH}<script>`, null, undefined]) {
			expect(extractHash(bad)).toBeNull();
		}
	});
});

describe('parseJobRequest', () => {
	it('fills in the defaults', () => {
		expect(parseJobRequest({ link: HASH })).toEqual({
			hash: HASH,
			title: '',
			settings: {
				width: 1280,
				fps: 30,
				format: 'mp4',
				quality: 'standard',
				motionBlur: 1,
				shutterAngle: 180
			}
		});
	});

	it('takes the settings the renderer knows, also as strings', () => {
		const { settings, title } = parseJobRequest({
			hash: HASH,
			title: '  Alps\nflight  ',
			settings: {
				width: '3840',
				fps: 60,
				format: 'prores',
				quality: 'high',
				motionBlur: '12',
				shutterAngle: 270
			}
		});
		expect(settings).toEqual({
			width: 3840,
			fps: 60,
			format: 'prores',
			quality: 'high',
			motionBlur: 12,
			shutterAngle: 270
		});
		expect(title).toBe('Alps flight');
	});

	it('refuses what it cannot render, with status 400', () => {
		for (const body of [
			null,
			{},
			{ link: 'nope' },
			{ link: HASH, settings: { width: 1000 } },
			{ link: HASH, settings: { format: 'gif' } },
			{ link: HASH, settings: { motionBlur: 33 } },
			{ link: HASH, settings: { motionBlur: 2.5 } },
			{ link: HASH, settings: { shutterAngle: 0 } }
		]) {
			expect(() => parseJobRequest(body)).toThrow(expect.objectContaining({ status: 400 }));
		}
	});
});

describe('a job', () => {
	const job = {
		id: 'x',
		user: 'alice',
		title: 'Zürich → Genève!',
		hash: HASH,
		settings: {
			width: 1920,
			fps: 25,
			format: 'ffv1',
			quality: 'standard',
			motionBlur: 4,
			shutterAngle: 270
		},
		status: 'finished',
		createdAt: '2026-10-14T10:00:00.000Z'
	};

	it('runs the renderer with its settings', () => {
		expect(rendererArgs(job, '/out/video.mkv')).toEqual([
			'--hash',
			HASH,
			'--width',
			'1920',
			'--fps',
			'25',
			'--format',
			'ffv1',
			'--motion-blur',
			'4',
			'--shutter-angle',
			'270',
			'--progress-json',
			'--output',
			'/out/video.mkv'
		]);
		const mp4 = { ...job, settings: { ...job.settings, format: 'mp4', motionBlur: 1 } };
		expect(rendererArgs(mp4, 'v.mp4')).toContain('--quality');
		expect(rendererArgs(mp4, 'v.mp4')).not.toContain('--motion-blur');
	});

	it('has a file and a download name that fit its format and title', () => {
		expect(videoFile(job)).toBe('video.mkv');
		expect(downloadName(job)).toBe('zurich-geneve-2026-10-14.mkv');
		expect(downloadName({ ...job, title: '' })).toBe('map-animation-2026-10-14.mkv');
	});

	it('does not show its hash to the browser', () => {
		expect(publicJob(job)).not.toHaveProperty('hash');
		expect(publicJob(job)).toHaveProperty('title');
	});
});

describe('JobStore', () => {
	let dir;
	beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'jobs-'))));
	afterEach(() => rm(dir, { recursive: true, force: true }));

	const request = (user, title) => ({
		user,
		title,
		hash: HASH,
		settings: parseJobRequest({ link: HASH }).settings
	});

	it('keeps jobs on disk, lists them per user newest first, and queues the oldest first', async () => {
		const store = new JobStore(dir);
		await store.load();
		const a = await store.create(request('alice', 'first'));
		await new Promise((r) => setTimeout(r, 5));
		const b = await store.create(request('bob', 'second'));
		await new Promise((r) => setTimeout(r, 5));
		const c = await store.create(request('alice', 'third'));
		expect(store.list().map((j) => j.title)).toEqual(['third', 'second', 'first']);
		expect(store.list('alice').map((j) => j.title)).toEqual(['third', 'first']);
		expect(store.nextQueued()).toBe(a);

		a.status = 'finished';
		await store.save(a);
		const again = new JobStore(dir);
		await again.load();
		expect(again.list().map((j) => j.id)).toEqual([c.id, b.id, a.id]);
		expect(again.get(a.id).status).toBe('finished');
		expect(again.nextQueued().id).toBe(b.id);
		expect(JSON.parse(await readFile(again.path(a, 'job.json'), 'utf8')).id).toBe(a.id);

		await again.remove(again.get(b.id));
		expect(again.get(b.id)).toBeNull();
		const third = new JobStore(dir);
		await third.load();
		expect(third.list()).toHaveLength(2);
	});
});
