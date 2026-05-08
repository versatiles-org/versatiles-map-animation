// @ts-check
/**
 * Offline renderer for versatiles-map-animation.
 *
 * Drives the static /view page frame-by-frame in headless Chromium with
 * software-WebGL (SwiftShader), captures each frame as PNG, and pipes the
 * stream into ffmpeg for H.264 encoding. A virtual clock (Playwright's
 * page.clock) keeps MapLibre's internal animations (label fades, transitions)
 * synchronised with the keyframe playhead so per-frame settle time is
 * decoupled from animation time.
 *
 * Usage:
 *   node render.mjs --hash <code>           --output out.mp4
 *   node render.mjs --url 'https://…#kf=…'  --output out.mp4
 *   node render.mjs --hash AVYw… --width 1920 --fps 30 --crf 18 --output out.mp4
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ALLOWED_WIDTHS = [640, 1280, 1920, 3840];
const DEFAULT_OPTS = {
	width: 1280,
	fps: 30,
	crf: 18,
	preset: 'slow',
	frameTimeoutMs: 60_000,
	prewarm: true,
	endTime: null
};

function parseArgv(argv) {
	const out = { ...DEFAULT_OPTS };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		switch (a) {
			case '--hash':
				out.hash = next();
				break;
			case '--url':
				out.url = next();
				break;
			case '--site-url':
				out.siteUrl = next();
				break;
			case '--site-root':
				out.siteRoot = next();
				break;
			case '--width':
				out.width = parseInt(next(), 10);
				break;
			case '--fps':
				out.fps = parseInt(next(), 10);
				break;
			case '--crf':
				out.crf = parseInt(next(), 10);
				break;
			case '--preset':
				out.preset = next();
				break;
			case '--output':
			case '-o':
				out.output = next();
				break;
			case '--frame-timeout':
				out.frameTimeoutMs = parseInt(next(), 10);
				break;
			case '--end-time':
				out.endTime = parseFloat(next());
				break;
			case '--no-prewarm':
				out.prewarm = false;
				break;
			case '--prewarm':
				out.prewarm = true;
				break;
			case '-h':
			case '--help':
				out.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${a}`);
		}
	}
	return out;
}

function usage() {
	return [
		'Usage: render.mjs [options]',
		'',
		'  --hash <code>          URL-hash payload from the editor (alternative to --url)',
		'  --url <full-url>       full /view URL (the renderer extracts #kf=...)',
		'  --site-root <dir>      static-files root to serve (default: /app/site or ./build)',
		'  --site-url <url>       skip the built-in static server and use this base URL instead',
		'  --width <n>            video width — one of 640, 1280, 1920, 3840 (default 1280)',
		'  --fps <n>              frame rate (default 30)',
		'  --crf <n>              x264 CRF, lower = higher quality (default 18)',
		'  --preset <name>        x264 preset (default "slow")',
		'  --frame-timeout <ms>   per-frame settle timeout (default 60000)',
		'  --no-prewarm           skip the initial trajectory walk that pre-fills tile cache',
		'  --output <path>        output MP4 (required)',
		''
	].join('\n');
}

function extractHash(input) {
	if (!input) return null;
	const trimmed = input.trim();
	const hashIdx = trimmed.indexOf('#');
	if (hashIdx >= 0) {
		const hash = trimmed.slice(hashIdx + 1);
		const params = new URLSearchParams(hash);
		const v = params.get('kf');
		if (v) return v;
		return hash;
	}
	if (trimmed.startsWith('kf=')) return trimmed.slice(3);
	return trimmed;
}

function defaultSiteRoot() {
	// Inside the Docker image the bundled site lives at /app/site/. Locally
	// (npm run, no container) we fall back to ../build/.
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = ['/app/site', resolve(here, '..', 'build')];
	for (const c of candidates) if (existsSync(join(c, 'view.html'))) return c;
	return candidates[0];
}

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

/**
 * Serve `siteRoot` over HTTP on a random port. Chromium needs a real HTTP
 * origin for ES module imports — `file://` is blocked by CORS.
 * Resolves once the server is listening and returns `{ url, close }`.
 */
async function spawnStaticServer(siteRoot) {
	const root = resolve(siteRoot);
	const server = createServer(async (req, res) => {
		try {
			let urlPath = (req.url || '/').split('?')[0].split('#')[0];
			if (urlPath === '/') urlPath = '/index.html';
			let filePath = normalize(join(root, urlPath));
			if (!filePath.startsWith(root)) {
				res.writeHead(403);
				return res.end();
			}
			let st = await stat(filePath).catch(() => null);
			// SvelteKit adapter-static writes `view.html` for the `/view`
			// route, so resolve `${path}` → `${path}.html` when needed.
			if (!st && existsSync(filePath + '.html')) {
				filePath = filePath + '.html';
				st = await stat(filePath);
			}
			if (!st) {
				res.writeHead(404);
				return res.end(`404 ${urlPath}`);
			}
			if (st.isDirectory()) filePath = join(filePath, 'index.html');
			const body = await readFile(filePath);
			res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
			res.end(body);
		} catch (err) {
			res.writeHead(500);
			res.end(String(err && err.message));
		}
	});
	await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
	const addr = server.address();
	const port = typeof addr === 'object' && addr ? addr.port : 0;
	const url = `http://127.0.0.1:${port}`;
	return {
		url,
		close: () => new Promise((r) => server.close(() => r(undefined)))
	};
}

function buildPageUrl(baseUrl, hash, render) {
	// Hash payload contains characters that don't need URL-encoding in #kf=…,
	// and the existing share links don't encode it, so leave as-is. The route
	// is `/view`; the static server resolves it to `view.html`.
	const sep = render ? '?render=1#kf=' : '#kf=';
	return `${baseUrl}/view${sep}${hash}`;
}

function spawnFfmpeg(opts) {
	const args = [
		'-y',
		'-f',
		'image2pipe',
		'-framerate',
		String(opts.fps),
		'-i',
		'pipe:0',
		'-c:v',
		'libx264',
		'-preset',
		opts.preset,
		'-crf',
		String(opts.crf),
		'-pix_fmt',
		'yuv420p',
		'-movflags',
		'+faststart',
		opts.output
	];
	const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
	const exit = new Promise((res, rej) => {
		proc.on('exit', (code) =>
			code === 0 ? res(undefined) : rej(new Error(`ffmpeg exit ${code}`))
		);
		proc.on('error', rej);
	});
	return { proc, exit };
}

async function waitForFrameReady(page, timeoutMs) {
	// Resolve once MapLibre is idle (all tiles loaded, repaint done) for the
	// current camera. We force a repaint to make the idle event reliable when
	// the map happens to already be idle.
	return await Promise.race([
		page.evaluate(
			() =>
				new Promise((resolve) => {
					const map = /** @type {any} */ (window).__map;
					if (!map) return resolve(undefined);
					const onIdle = () => resolve(undefined);
					map.once('idle', onIdle);
					map.triggerRepaint();
				})
		),
		new Promise((_res, rej) =>
			setTimeout(() => rej(new Error(`frame settle timeout after ${timeoutMs}ms`)), timeoutMs)
		)
	]);
}

async function setupPage(browser, opts, hash) {
	const height = Math.round((opts.width * 9) / 16);
	const ctx = await browser.newContext({ viewport: { width: opts.width, height } });
	const page = await ctx.newPage();
	page.on('pageerror', (e) => process.stderr.write(`[pageerror] ${e.message}\n`));
	page.on('console', (msg) => {
		if (msg.type() === 'error') process.stderr.write(`[console.error] ${msg.text()}\n`);
	});
	const url = buildPageUrl(opts.siteUrl, hash, true);
	process.stderr.write(`[renderer] navigating to ${url}\n`);
	await page.goto(url, { waitUntil: 'load' });
	// Wait for the renderer hook + map instance to be ready.
	await page.waitForFunction(
		() => /** @type {any} */ (window).__renderer && /** @type {any} */ (window).__map,
		{ timeout: 30_000 }
	);
	// First idle = initial map is fully drawn.
	await waitForFrameReady(page, 30_000);
	const duration = await page.evaluate(() => /** @type {any} */ (window).__renderer.duration);
	return { ctx, page, duration };
}

async function prewarmPass(page, duration, opts) {
	process.stderr.write(`[renderer] prewarm: walking the trajectory at 5 fps to fill tile cache\n`);
	const fps = 5;
	const total = Math.max(2, Math.ceil(duration * fps) + 1);
	for (let i = 0; i < total; i++) {
		const t = Math.min(duration, i / fps);
		await page.evaluate((t) => /** @type {any} */ (window).__renderer.seekTo(t), t);
		try {
			await waitForFrameReady(page, opts.frameTimeoutMs);
		} catch {
			process.stderr.write(`[renderer] prewarm frame ${i} timeout, continuing\n`);
		}
	}
}

async function capturePass(page, duration, opts, ffmpegStdin) {
	const total = Math.max(2, Math.ceil(duration * opts.fps) + 1);
	process.stderr.write(`[renderer] capturing ${total} frames at ${opts.fps} fps\n`);

	// Install a virtual clock so MapLibre's internal animations evaluate at
	// the correct *animation* time, not wall-clock time, regardless of how
	// long each SwiftShader-rendered frame actually takes.
	await page.clock.install({ time: 0 });

	for (let i = 0; i < total; i++) {
		const t = Math.min(duration, i / opts.fps);
		const tMs = t * 1000;
		await page.clock.setFixedTime(tMs);
		await page.evaluate((t) => /** @type {any} */ (window).__renderer.seekTo(t), t);
		try {
			await waitForFrameReady(page, opts.frameTimeoutMs);
		} catch (err) {
			process.stderr.write(
				`[renderer] frame ${i + 1}/${total} (t=${t.toFixed(3)}) timeout: ${err.message}\n`
			);
		}
		const png = await page.screenshot({ type: 'png' });
		ffmpegStdin.write(png);
		if ((i + 1) % 10 === 0 || i === total - 1) {
			process.stderr.write(`[renderer] frame ${i + 1}/${total} (t=${t.toFixed(2)}s)\n`);
		}
	}
	ffmpegStdin.end();
}

async function main() {
	const opts = parseArgv(process.argv.slice(2));
	if (opts.help) {
		process.stdout.write(usage());
		return;
	}
	if (!ALLOWED_WIDTHS.includes(opts.width)) {
		throw new Error(`--width must be one of ${ALLOWED_WIDTHS.join('/')}, got ${opts.width}`);
	}
	if (!opts.output) throw new Error('--output is required');
	if (!opts.hash && !opts.url) throw new Error('--hash or --url is required');
	const hash = extractHash(opts.url) ?? opts.hash;
	if (!hash) throw new Error('could not extract hash from --url');

	// Ensure the output directory exists.
	const outAbs = isAbsolute(opts.output) ? opts.output : resolve(process.cwd(), opts.output);
	await mkdir(dirname(outAbs), { recursive: true });
	opts.output = outAbs;

	// If a --site-url is given, use it; otherwise spawn a tiny static server.
	let server = null;
	if (!opts.siteUrl) {
		const root = opts.siteRoot ?? defaultSiteRoot();
		server = await spawnStaticServer(root);
		opts.siteUrl = server.url;
		process.stderr.write(`[renderer] serving ${root} on ${server.url}\n`);
	}

	const browser = await chromium.launch({
		args: [
			'--use-gl=swiftshader',
			'--enable-unsafe-swiftshader',
			'--disable-gpu-vsync',
			'--disable-dev-shm-usage',
			'--no-sandbox'
		]
	});

	try {
		const { ctx, page, duration } = await setupPage(browser, opts, hash);
		const cappedDuration = opts.endTime != null ? Math.min(duration, opts.endTime) : duration;
		process.stderr.write(
			`[renderer] animation duration: ${duration.toFixed(2)}s` +
				(opts.endTime != null ? ` (capped at ${cappedDuration.toFixed(2)}s)` : '') +
				'\n'
		);

		if (opts.prewarm) {
			await prewarmPass(page, cappedDuration, opts);
		}

		const { proc, exit } = spawnFfmpeg(opts);
		await capturePass(page, cappedDuration, opts, proc.stdin);
		await exit;
		process.stderr.write(`[renderer] wrote ${opts.output}\n`);
		await ctx.close();
	} finally {
		await browser.close();
		if (server) await server.close();
	}
}

main().catch((err) => {
	process.stderr.write(`[renderer] error: ${err.message}\n`);
	if (err.stack) process.stderr.write(err.stack + '\n');
	process.exit(1);
});
