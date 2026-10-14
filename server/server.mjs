/**
 * Render server for versatiles-map-animator: the editor, a queue of render
 * jobs and the finished videos, behind a login. See README.md.
 *
 *   /                 the editor (and /view, the player it embeds)
 *   /renders/         the user's render jobs: new ones, progress, previews, downloads
 *   /renders/login    the login page; everything else needs a session
 *   /api/me           who is logged in — the editor asks, to offer rendering here
 *   /api/jobs         GET: the user's jobs, newest first; POST: a new one
 *   /api/jobs/<id>    DELETE: cancel a job, or delete one that is over
 *   /api/jobs/<id>/video|preview|poster   its files (`?download` to save the video)
 */

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Accounts, SESSION_MAX_AGE } from './auth.mjs';
import { parseCookies, readBody, redirect, sendFile, sendJson, sendText } from './http.mjs';
import { downloadName, JobStore, parseJobRequest, publicJob, videoFile } from './jobs.mjs';
import { removeOldJobs, RenderQueue } from './queue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, 'page');
const COOKIE = 'session';
/** Files of the server's own pages that may be fetched without a session. */
const ASSETS = new Set(['style.css', 'renders.js']);

/** The configuration from the environment; see README.md. */
export function loadConfig(env = process.env) {
	const dataDir = resolve(env.DATA_DIR ?? join(HERE, 'data'));
	return {
		port: Number(env.PORT ?? 8080),
		host: env.HOST ?? '0.0.0.0',
		dataDir,
		usersFile: resolve(env.USERS_FILE ?? join(dataDir, 'users.txt')),
		renderer: resolve(env.RENDERER ?? join(HERE, '..', 'render', 'render.mjs')),
		renderArgs: (env.RENDER_ARGS ?? '').split(/\s+/).filter(Boolean),
		siteRoot: resolve(
			env.SITE_ROOT ??
				['/app/site', join(HERE, '..', 'build')].find((dir) =>
					existsSync(join(dir, 'index.html'))
				) ??
				join(HERE, '..', 'build')
		),
		ffmpeg: env.FFMPEG ?? 'ffmpeg',
		keepDays: Number(env.KEEP_DAYS ?? 28),
		maxQueuedPerUser: Number(env.MAX_QUEUED_PER_USER ?? 10)
	};
}

/**
 * The request handler, on top of `accounts`, `store` and `queue`; a
 * function of its own so that tests can call it without a network.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @param {{ accounts: Accounts, store: JobStore, queue: RenderQueue }} parts
 */
export function createHandler(config, { accounts, store, queue }) {
	/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
	return async function handle(req, res) {
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Referrer-Policy', 'same-origin');
		const url = new URL(req.url ?? '/', 'http://server');
		const path = url.pathname;
		const token = parseCookies(req.headers.cookie)[COOKIE];

		try {
			// --- Without a session -------------------------------------------
			if (path === '/renders/login' && req.method === 'GET') {
				await sendFile(req, res, join(PAGE, 'login.html'), { cache: 'no-cache' });
				return;
			}
			if (path === '/renders/login' && req.method === 'POST') {
				const form = new URLSearchParams(await readBody(req, 10_000));
				const next = safeNext(form.get('next'));
				let session;
				try {
					session = await accounts.login(
						form.get('user') ?? '',
						form.get('password') ?? '',
						req.socket.remoteAddress ?? ''
					);
				} catch (err) {
					if (/** @type {any} */ (err).status !== 429) throw err;
					redirect(res, `/renders/login?wait=1&next=${encodeURIComponent(next)}`);
					return;
				}
				if (!session) {
					redirect(res, `/renders/login?failed=1&next=${encodeURIComponent(next)}`);
					return;
				}
				redirect(res, next, {
					'Set-Cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`
				});
				return;
			}
			if (path === '/renders/logout' && req.method === 'POST') {
				accounts.logout(token);
				redirect(res, '/renders/login', {
					'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
				});
				return;
			}
			if (path.startsWith('/renders/assets/') && ASSETS.has(path.slice(16))) {
				await sendFile(req, res, join(PAGE, path.slice(16)), { cache: 'no-cache' });
				return;
			}

			// --- With a session ----------------------------------------------
			const user = accounts.userOf(token);
			if (!user) {
				if (path.startsWith('/api/')) sendJson(res, 401, { error: 'Not logged in' });
				else redirect(res, `/renders/login?next=${encodeURIComponent(path + url.search)}`);
				return;
			}

			if (path === '/renders' || path === '/renders/') {
				res.setHeader('X-Frame-Options', 'DENY');
				await sendFile(req, res, join(PAGE, 'renders.html'), { cache: 'no-cache' });
				return;
			}
			if (path === '/api/me' && req.method === 'GET') {
				sendJson(res, 200, { user });
				return;
			}
			if (path === '/api/jobs' && req.method === 'GET') {
				// For a queued job: how many renders come before it, everyone's,
				// counted without saying whose they are.
				const waiting = store
					.list()
					.filter((job) => job.status === 'queued')
					.reverse();
				const rendering = store.list().some((job) => job.status === 'rendering') ? 1 : 0;
				const jobs = store.list(user).map((job) => ({
					...publicJob(job),
					...(job.status === 'queued' && { ahead: waiting.indexOf(job) + rendering })
				}));
				sendJson(res, 200, { jobs });
				return;
			}
			if (path === '/api/jobs' && req.method === 'POST') {
				if (!String(req.headers['content-type']).startsWith('application/json')) {
					sendJson(res, 415, { error: 'Expected JSON' });
					return;
				}
				let body;
				try {
					body = JSON.parse(await readBody(req));
				} catch {
					sendJson(res, 400, { error: 'Expected JSON' });
					return;
				}
				const request = parseJobRequest(body);
				const waiting = store.list(user).filter((job) => job.status === 'queued').length;
				if (waiting >= config.maxQueuedPerUser) {
					sendJson(res, 429, {
						error: `You already have ${waiting} renders waiting. Wait for them, or cancel some.`
					});
					return;
				}
				const job = await store.create({ user, ...request });
				// As it was added: the queue may begin on it right away.
				const added = publicJob(structuredClone(job));
				queue.kick();
				sendJson(res, 201, { job: added });
				return;
			}

			const m = /^\/api\/jobs\/([\w-]+)(?:\/(video|preview|poster))?$/.exec(path);
			if (m) {
				const job = store.get(m[1]);
				// Someone else's job does not exist, as far as this user can tell.
				if (!job || job.user !== user) {
					sendJson(res, 404, { error: 'No such render' });
					return;
				}
				if (!m[2] && req.method === 'DELETE') {
					if (job.status === 'queued' || job.status === 'rendering') await queue.cancel(job);
					else await store.remove(job);
					sendJson(res, 200, { ok: true });
					return;
				}
				if (m[2] && (req.method === 'GET' || req.method === 'HEAD') && job.status === 'finished') {
					const file = { video: videoFile(job), preview: 'preview.mp4', poster: 'poster.jpg' }[
						m[2]
					];
					const download = m[2] === 'video' && url.searchParams.has('download');
					if (
						await sendFile(req, res, store.path(job, file), {
							...(download && { download: downloadName(job) })
						})
					) {
						return;
					}
				}
				sendJson(res, 404, { error: 'Not found' });
				return;
			}
			if (path.startsWith('/api/')) {
				sendJson(res, 404, { error: 'Not found' });
				return;
			}

			// --- The editor --------------------------------------------------
			if (req.method === 'GET' || req.method === 'HEAD') {
				const file = siteFile(config.siteRoot, path);
				const cache = path.startsWith('/_app/immutable/')
					? 'public, max-age=31536000, immutable'
					: 'no-cache';
				if (file && (await sendFile(req, res, file, { cache }))) return;
			}
			sendText(res, 404, 'Not found');
		} catch (err) {
			const status = /** @type {any} */ (err).status ?? 500;
			if (status === 500) console.error(err);
			if (res.headersSent) res.destroy();
			else if (path.startsWith('/api/'))
				sendJson(res, status, { error: /** @type {Error} */ (err).message });
			else
				sendText(res, status, status === 500 ? 'Server error' : /** @type {Error} */ (err).message);
		}
	};
}

/** Where to go after logging in: a path on this server, nothing else. */
function safeNext(next) {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/renders/';
}

/** The file of the built editor for a URL path, or `null` outside of it. */
function siteFile(root, path) {
	let decoded;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		return null;
	}
	if (decoded.includes('\0')) return null;
	// `/` is the editor, `/view` the player: SvelteKit writes pages as `.html`.
	const name =
		decoded === '/' ? '/index.html' : /\.[a-z0-9]+$/i.test(decoded) ? decoded : `${decoded}.html`;
	const file = normalize(join(root, name));
	return file.startsWith(root + sep) ? file : null;
}

async function main() {
	const config = loadConfig();
	const log = (/** @type {string} */ msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

	const accounts = new Accounts(config.usersFile, log);
	await accounts.load();
	accounts.watch();
	if (accounts.size === 0) {
		log(`no users yet — add one with: node ${join(HERE, 'passwd.mjs')} add <name>`);
	}

	const store = new JobStore(config.dataDir);
	await store.load();
	const cleanUp = () =>
		removeOldJobs(store, config.keepDays)
			.then((n) => n > 0 && log(`deleted ${n} render(s) older than ${config.keepDays} days`))
			.catch((err) => log(`clean-up: ${err.message}`));
	await cleanUp();
	setInterval(cleanUp, 3600 * 1000).unref();

	const queue = new RenderQueue(store, {
		renderer: config.renderer,
		renderArgs: config.renderArgs,
		ffmpeg: config.ffmpeg,
		log
	});
	await queue.start();

	const server = createServer(createHandler(config, { accounts, store, queue }));
	server.listen(config.port, config.host, () =>
		log(`listening on http://${config.host}:${config.port}/ — data in ${config.dataDir}`)
	);

	const shutdown = () => {
		log('shutting down');
		queue.stop();
		server.close();
		setTimeout(() => process.exit(0), 2000).unref();
	};
	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
