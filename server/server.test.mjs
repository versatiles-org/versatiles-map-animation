// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createSecureServer, request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Accounts, formatUser, hashPassword } from './auth.mjs';
import { JobStore } from './jobs.mjs';
import { removeOldJobs, RenderQueue } from './queue.mjs';
import { createHandler, createPlainHandler, loadConfig } from './server.mjs';
import { CERT, KEY } from './test-certificate.mjs';

// Stands in for render.mjs: reports progress like it, and writes a "video".
// The hash says how it should go: …FAIL… fails, …SLOW… takes its time.
const FAKE_RENDERER = `
const args = process.argv.slice(2);
const hash = args[args.indexOf('--hash') + 1];
const output = args[args.indexOf('--output') + 1];
const say = (p) => process.stdout.write(JSON.stringify(p) + '\\n');
say({ phase: 'preparing' });
say({ phase: 'preparing', width: 1280, height: 720, frames: 31 });
if (hash.includes('FAIL')) {
	process.stderr.write('preparing renderer…\\n[renderer] error: no tiles today\\n');
	process.exit(1);
}
const total = 31;
let done = 0;
const step = () => {
	done += 10;
	say({ phase: 'rendering', done: Math.min(done, total), total });
	if (done < total) return setTimeout(step, hash.includes('SLOW') ? 1000 : 5);
	say({ phase: 'encoding' });
	require('node:fs').writeFileSync(output, Buffer.alloc(1000, 7));
};
step();
`;

const fakePreview = async (_ffmpeg, _video, preview, poster) => {
	await writeFile(preview, 'preview');
	await writeFile(poster, 'poster');
};

const HASH = 'AhsYd1UXQykn8O2DnpN81PQfwj7AruqD';

let dir;
let base;
let server;
let store;
let queue;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'render-server-'));
	const site = join(dir, 'site');
	await mkdir(join(site, '_app', 'immutable'), { recursive: true });
	await writeFile(join(site, 'index.html'), '<title>editor</title>');
	await writeFile(join(site, 'view.html'), '<title>view</title>');
	await writeFile(join(site, '_app', 'immutable', 'app.js'), 'export {}');
	await writeFile(join(dir, 'secret.txt'), 'secret');
	await writeFile(join(dir, 'renderer.cjs'), FAKE_RENDERER);
	await writeFile(
		join(dir, 'users.txt'),
		[
			formatUser('alice', await hashPassword('alice-secret')),
			formatUser('bob', await hashPassword('bob-secret'))
		].join('\n')
	);
	const config = loadConfig({
		DATA_DIR: join(dir, 'data'),
		USERS_FILE: join(dir, 'users.txt'),
		RENDERER: join(dir, 'renderer.cjs'),
		SITE_ROOT: site,
		MAX_QUEUED_PER_USER: '3'
	});
	const accounts = new Accounts(config.usersFile);
	await accounts.load();
	store = new JobStore(config.dataDir);
	await store.load();
	queue = new RenderQueue(store, { renderer: config.renderer, preview: fakePreview });
	await queue.start();
	server = createServer(createHandler(config, { accounts, store, queue }));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
	queue.stop();
	await new Promise((resolve) => server.close(resolve));
	await rm(dir, { recursive: true, force: true });
});

const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });

async function login(user, password) {
	const res = await get('/renders/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ user, password, next: '/renders/' })
	});
	const cookie = res.headers.get('set-cookie');
	return { res, cookie: cookie?.split(';')[0] };
}

async function addJob(cookie, body) {
	return get('/api/jobs', {
		method: 'POST',
		headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

async function jobsOf(cookie) {
	return (await (await get('/api/jobs', { headers: { Cookie: cookie } })).json()).jobs;
}

describe('without logging in', () => {
	it('only the login page and its assets are there', async () => {
		expect((await get('/renders/login')).status).toBe(200);
		expect((await get('/renders/assets/style.css')).status).toBe(200);
		expect((await get('/renders/assets/../server.mjs')).status).not.toBe(200);
		expect((await get('/api/jobs')).status).toBe(401);
		const page = await get('/renders/');
		expect(page.status).toBe(303);
		expect(page.headers.get('location')).toBe('/renders/login?next=%2Frenders%2F');
		expect((await get('/')).headers.get('location')).toMatch(/^\/renders\/login/);
	});

	it('a wrong password leads back to the login page', async () => {
		const { res, cookie } = await login('alice', 'nope-nope');
		expect(res.headers.get('location')).toMatch(/^\/renders\/login\?failed=1/);
		expect(cookie).toBeUndefined();
	});

	it('the session cookie is HTTP-only, and not marked secure over plain HTTP', async () => {
		const { res } = await login('alice', 'alice-secret');
		const cookie = res.headers.get('set-cookie');
		expect(cookie).toMatch(/HttpOnly; SameSite=Strict/);
		expect(cookie).not.toMatch(/Secure/);
	});
});

describe('logged in', () => {
	let alice;
	let bob;
	beforeAll(async () => {
		alice = (await login('alice', 'alice-secret')).cookie;
		bob = (await login('bob', 'bob-secret')).cookie;
	});

	it('serves the editor, and nothing outside of it', async () => {
		const editor = await get('/', { headers: { Cookie: alice } });
		expect(await editor.text()).toContain('editor');
		expect(await (await get('/view', { headers: { Cookie: alice } })).text()).toContain('view');
		const asset = await get('/_app/immutable/app.js', { headers: { Cookie: alice } });
		expect(asset.headers.get('cache-control')).toContain('immutable');
		expect((await get('/%2e%2e/secret.txt', { headers: { Cookie: alice } })).status).toBe(404);
		expect((await get('/renders/', { headers: { Cookie: alice } })).status).toBe(200);
		expect(await (await get('/api/me', { headers: { Cookie: alice } })).json()).toEqual({
			user: 'alice'
		});
	});

	it('renders a job, and the user gets its video, preview and poster', async () => {
		const res = await addJob(alice, { link: `http://1.2.3.4/#kf=${HASH}`, title: 'Alps' });
		expect(res.status).toBe(201);
		const { job } = await res.json();
		expect(job).not.toHaveProperty('hash');
		expect(job.status).toBe('queued');
		await queue.idle();

		const [done] = await jobsOf(alice);
		expect(done).toMatchObject({
			id: job.id,
			status: 'finished',
			size: 1000,
			duration: 1,
			width: 1280,
			height: 720
		});
		const headers = { Cookie: alice };
		const video = await get(`/api/jobs/${job.id}/video`, {
			headers: { ...headers, Range: 'bytes=0-9' }
		});
		expect(video.status).toBe(206);
		expect(video.headers.get('content-range')).toBe('bytes 0-9/1000');
		expect((await video.arrayBuffer()).byteLength).toBe(10);
		const download = await get(`/api/jobs/${job.id}/video?download`, { headers });
		expect(download.headers.get('content-disposition')).toMatch(
			/^attachment; filename="alps-\d{4}-\d\d-\d\d\.mp4"$/
		);
		expect(await (await get(`/api/jobs/${job.id}/preview`, { headers })).text()).toBe('preview');
		expect(await (await get(`/api/jobs/${job.id}/poster`, { headers })).text()).toBe('poster');

		// Bob neither sees it nor gets at it.
		expect(await jobsOf(bob)).toEqual([]);
		expect((await get(`/api/jobs/${job.id}/video`, { headers: { Cookie: bob } })).status).toBe(404);
		expect(
			(await get(`/api/jobs/${job.id}`, { method: 'DELETE', headers: { Cookie: bob } })).status
		).toBe(404);
	});

	it('lists the newest first and tells what went wrong when a render fails', async () => {
		await addJob(alice, { link: `${HASH}FAIL`, title: 'Broken' });
		await queue.idle();
		const [failed, older] = await jobsOf(alice);
		expect(failed).toMatchObject({ title: 'Broken', status: 'failed' });
		expect(failed.error).toContain('no tiles today');
		expect(older.title).toBe('Alps');
	});

	it('renders one job at a time, and a queued or running one can be cancelled', async () => {
		await addJob(bob, { link: `${HASH}SLOW`, title: 'slow' });
		await addJob(bob, { link: HASH, title: 'next' });
		await new Promise((r) => setTimeout(r, 300));
		let [next, slow] = await jobsOf(bob);
		expect(slow.status).toBe('rendering');
		expect(slow.progress.phase).toMatch(/rendering|preparing/);
		expect(next).toMatchObject({ status: 'queued', ahead: 1 });

		await get(`/api/jobs/${slow.id}`, { method: 'DELETE', headers: { Cookie: bob } });
		await queue.idle();
		[next, slow] = await jobsOf(bob);
		expect(slow.status).toBe('cancelled');
		expect(next.status).toBe('finished');

		// What is over is deleted, files and all.
		await get(`/api/jobs/${slow.id}`, { method: 'DELETE', headers: { Cookie: bob } });
		expect((await jobsOf(bob)).map((j) => j.title)).toEqual(['next']);
	});

	it('refuses bad requests and too many waiting jobs', async () => {
		const bad = await addJob(alice, { link: 'not a link' });
		expect(bad.status).toBe(400);
		expect((await bad.json()).error).toMatch(/share link/);
		const notJson = await get('/api/jobs', {
			method: 'POST',
			headers: { Cookie: alice },
			body: 'x'
		});
		expect(notJson.status).toBe(415);

		// While one renders, at most three may wait.
		const statuses = [];
		for (let i = 0; i < 5; i++)
			statuses.push((await addJob(alice, { link: `${HASH}SLOW` })).status);
		expect(statuses).toEqual([201, 201, 201, 201, 429]);
		for (const job of await jobsOf(alice)) {
			if (job.status === 'queued' || job.status === 'rendering') {
				await get(`/api/jobs/${job.id}`, { method: 'DELETE', headers: { Cookie: alice } });
			}
		}
		await queue.idle();
	});

	it('logs out', async () => {
		const { cookie } = await login('alice', 'alice-secret');
		await get('/renders/logout', { method: 'POST', headers: { Cookie: cookie } });
		expect((await get('/api/jobs', { headers: { Cookie: cookie } })).status).toBe(401);
	});
});

describe('removeOldJobs', () => {
	it('deletes what is over and older than the limit, and keeps the queue', async () => {
		const before = store.list().length;
		const now = Date.now() + 29 * 24 * 3600 * 1000;
		const waiting = await store.create({
			user: 'carol',
			title: '',
			hash: HASH,
			settings: store.list()[0].settings
		});
		waiting.status = 'queued';
		const removed = await removeOldJobs(store, 28, now);
		expect(removed).toBe(before);
		expect(store.list().map((j) => j.id)).toEqual([waiting.id]);
		await store.remove(waiting);
	});
});

describe('with a domain', () => {
	const config = loadConfig({
		DOMAIN: 'map.example.org, WWW.example.org',
		DATA_DIR: '/tmp/unused'
	});

	it('listens on 80 and 443 by default', () => {
		expect(config.domains).toEqual(['map.example.org', 'www.example.org']);
		expect([config.port, config.httpsPort]).toEqual([80, 443]);
		expect(config.acmeDirectory).toMatch(/letsencrypt\.org/);
		expect(loadConfig({ DATA_DIR: '/tmp/unused' }).port).toBe(8080);
	});

	/** Plain HTTP, as the server answers it on port 80. */
	async function plain(secure, path, host = 'map.example.org') {
		const challenges = new Map([['tok_1', 'tok_1.thumb']]);
		const http = createServer(createPlainHandler(config, challenges, () => secure));
		await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
		try {
			// Not `fetch`, which sends a Host header of its own.
			return await new Promise((resolve, reject) => {
				const req = httpRequest(
					{ host: '127.0.0.1', port: http.address().port, path, headers: { Host: host } },
					(res) => {
						let text = '';
						res.on('data', (chunk) => (text += chunk));
						res.on('end', () =>
							resolve({ status: res.statusCode, location: res.headers.location, text })
						);
					}
				);
				req.on('error', reject);
				req.end();
			});
		} finally {
			await new Promise((resolve) => http.close(resolve));
		}
	}

	it('answers the ACME challenges over plain HTTP', async () => {
		expect(await plain(false, '/.well-known/acme-challenge/tok_1')).toMatchObject({
			status: 200,
			text: 'tok_1.thumb'
		});
		expect((await plain(true, '/.well-known/acme-challenge/other')).status).toBe(404);
	});

	it('sends everything else to HTTPS, once there is a certificate', async () => {
		expect((await plain(false, '/renders/')).status).toBe(503);
		expect(await plain(true, '/renders/?x=1', 'www.example.org:80')).toMatchObject({
			status: 308,
			location: 'https://www.example.org/renders/?x=1'
		});
		// Not to an IP address or a name of someone else's.
		expect((await plain(true, '/', '203.0.113.7')).location).toBe('https://map.example.org/');
	});

	it('marks the session cookie secure over HTTPS', async () => {
		const accounts = new Accounts(join(dir, 'users.txt'));
		await accounts.load();
		const https = createSecureServer(
			{ key: KEY, cert: CERT },
			createHandler(config, { accounts, store, queue })
		);
		await new Promise((resolve) => https.listen(0, '127.0.0.1', resolve));
		try {
			const cookie = await new Promise((resolve, reject) => {
				const req = request(
					{
						host: '127.0.0.1',
						port: https.address().port,
						path: '/renders/login',
						method: 'POST',
						rejectUnauthorized: false,
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
					},
					(res) => {
						res.resume();
						resolve(res.headers['set-cookie']?.[0]);
					}
				);
				req.on('error', reject);
				req.end('user=alice&password=alice-secret');
			});
			expect(cookie).toMatch(/; Secure;/);
		} finally {
			await new Promise((resolve) => https.close(resolve));
		}
	});
});
