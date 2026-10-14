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
 *
 * With DOMAIN set, all of that over HTTPS, with a certificate from Let's
 * Encrypt (acme.mjs); plain HTTP then only answers its challenges and sends
 * everyone else to HTTPS.
 */

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CHALLENGE_PATH, Certificates, LETS_ENCRYPT } from './acme.mjs';
import { Accounts, SESSION_MAX_AGE } from './auth.mjs';
import { parseCookies, readBody, redirect, sendFile, sendJson, sendText } from './http.mjs';
import { downloadName, JobStore, parseJobRequest, publicJob, videoFile } from './jobs.mjs';
import { removeOldJobs, RenderQueue } from './queue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, 'page');
const COOKIE = 'session';
/** How often to check whether the certificate needs renewing. */
const RENEW_CHECK_MS = 12 * 3600 * 1000;
/** Files of the server's own pages that may be fetched without a session. */
const ASSETS = new Set(['style.css', 'renders.js']);

/** The configuration from the environment; see README.md. */
export function loadConfig(env = process.env) {
	const dataDir = resolve(env.DATA_DIR ?? join(HERE, 'data'));
	const domains = (env.DOMAIN ?? '')
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
	return {
		port: Number(env.PORT ?? (domains.length ? 80 : 8080)),
		host: env.HOST ?? '0.0.0.0',
		domains,
		httpsPort: Number(env.HTTPS_PORT ?? 443),
		acmeEmail: env.ACME_EMAIL || undefined,
		acmeDirectory: env.ACME_DIRECTORY || LETS_ENCRYPT,
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
		// Over HTTPS, the browser is to send the session cookie over HTTPS only.
		const cookie = `HttpOnly; SameSite=Strict; Path=/${'encrypted' in req.socket ? '; Secure' : ''}`;

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
					'Set-Cookie': `${COOKIE}=${session}; ${cookie}; Max-Age=${SESSION_MAX_AGE}`
				});
				return;
			}
			if (path === '/renders/logout' && req.method === 'POST') {
				accounts.logout(token);
				redirect(res, '/renders/login', {
					'Set-Cookie': `${COOKIE}=; ${cookie}; Max-Age=0`
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

/**
 * Plain HTTP when the server has a domain: the answers to the ACME
 * challenges, and for everything else the way to HTTPS — or, before there
 * is a certificate, a note that one is on its way.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @param {Map<string, string>} challenges  token → answer
 * @param {() => boolean} secure  whether HTTPS is up
 */
export function createPlainHandler(config, challenges, secure) {
	/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
	return function handle(req, res) {
		const url = new URL(req.url ?? '/', 'http://server');
		if (url.pathname.startsWith(CHALLENGE_PATH)) {
			const answer = challenges.get(url.pathname.slice(CHALLENGE_PATH.length));
			if (answer) sendText(res, 200, answer);
			else sendText(res, 404, 'Not found');
			return;
		}
		if (!secure()) {
			res.setHeader('Retry-After', '60');
			sendText(
				res,
				503,
				'Waiting for the HTTPS certificate — see the server log. Try again in a minute.'
			);
			return;
		}
		// The domain asked for if it is one of ours (not the bare IP address).
		const asked = String(req.headers.host ?? '')
			.replace(/:\d+$/, '')
			.toLowerCase();
		const host = config.domains.includes(asked) ? asked : config.domains[0];
		const port = config.httpsPort === 443 ? '' : `:${config.httpsPort}`;
		res.writeHead(308, { Location: `https://${host}${port}${url.pathname}${url.search}` });
		res.end();
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

	const handler = createHandler(config, { accounts, store, queue });
	/** @type {{ close(): unknown }[]} */
	const servers = [];
	if (config.domains.length === 0) {
		const server = createServer(handler);
		server.listen(config.port, config.host, () =>
			log(`listening on http://${config.host}:${config.port}/ — data in ${config.dataDir}`)
		);
		servers.push(server);
	} else {
		servers.push(...(await serveSecurely(config, handler, log)));
	}

	const shutdown = () => {
		log('shutting down');
		queue.stop();
		for (const server of servers) server.close();
		setTimeout(() => process.exit(0), 2000).unref();
	};
	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
}

/**
 * HTTPS for `config.domains` on `config.httpsPort`, with a certificate from
 * Let's Encrypt that is renewed while the server runs; plain HTTP on
 * `config.port` for its challenges and as the way to HTTPS.
 */
async function serveSecurely(config, handler, log) {
	const certs = new Certificates({
		dir: join(config.dataDir, 'tls'),
		domains: config.domains,
		email: config.acmeEmail,
		directoryUrl: config.acmeDirectory
	});
	let pair = await certs.load();
	/** @type {import('node:https').Server | null} */
	let secure = null;
	const useCertificate = () => {
		if (!pair) return;
		if (secure) {
			secure.setSecureContext(pair);
			return;
		}
		secure = createSecureServer(pair, handler);
		secure.listen(config.httpsPort, config.host, () =>
			log(
				`listening on https://${config.domains[0]}${config.httpsPort === 443 ? '' : `:${config.httpsPort}`}/ — data in ${config.dataDir}`
			)
		);
	};

	const plain = createServer(createPlainHandler(config, certs.challenges, () => secure !== null));
	await new Promise((resolve, reject) => {
		plain.once('error', reject);
		plain.listen(config.port, config.host, () => resolve(undefined));
	});
	log(`answering ACME challenges and sending to HTTPS on port ${config.port}`);

	// An expired certificate is still better than none while a new one is on its way.
	useCertificate();
	let busy = false;
	const check = async () => {
		if (busy || !certs.needsRenewal(pair)) return;
		busy = true;
		try {
			log(`getting a certificate for ${config.domains.join(', ')}`);
			pair = await certs.renew();
			useCertificate();
			log('got the certificate');
		} catch (err) {
			log(`certificate: ${/** @type {Error} */ (err).message} — trying again in an hour`);
			setTimeout(check, 3600 * 1000).unref();
		} finally {
			busy = false;
		}
	};
	check();
	setInterval(check, RENEW_CHECK_MS).unref();
	return [plain, { close: () => secure?.close() }];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
