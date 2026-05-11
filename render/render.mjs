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
	// Optional explicit pixel height. When omitted, defaults to width * 9/16
	// (legacy 16:9 behaviour). The editor always passes both `--width` and
	// `--height` derived from the chosen composition aspect ratio.
	height: null,
	fps: 30,
	crf: 18,
	preset: 'slow',
	frameTimeoutMs: 30_000,
	prewarm: true,
	endTime: null,
	verbose: false
};

// ---------------------------------------------------------------------------
// Output helpers — keep stderr tidy by default
// ---------------------------------------------------------------------------

let VERBOSE = false;

function log(msg) {
	process.stderr.write(msg + '\n');
}
function debug(msg) {
	if (VERBOSE) process.stderr.write(msg + '\n');
}
function fmtDuration(seconds) {
	if (!isFinite(seconds) || seconds < 0) return '–';
	const s = Math.round(seconds);
	if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function fmtBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

class Progress {
	constructor(total, label) {
		this.total = total;
		this.label = label;
		this.start = Date.now();
		this.tty = !!process.stderr.isTTY;
		this.lastPaint = 0;
		this.lastN = 0;
		this.lastPrintedN = 0;
	}
	update(n) {
		const now = Date.now();
		// Throttle updates to keep stderr quiet on non-TTYs and avoid flicker on TTYs.
		if (n < this.total && now - this.lastPaint < 250 && n - this.lastN < 1) return;
		this.lastPaint = now;
		this.lastN = n;
		const elapsed = (now - this.start) / 1000;
		const rate = n / Math.max(elapsed, 0.001);
		const remaining = n < this.total ? (this.total - n) / Math.max(rate, 0.001) : 0;
		const pct = Math.round((n / this.total) * 100);
		const eta = n < this.total ? `ETA ${fmtDuration(remaining)}` : `${fmtDuration(elapsed)}`;
		const line = `  ${this.label}  ${String(n).padStart(String(this.total).length)}/${this.total}  ${String(pct).padStart(3)}%  ${eta}`;
		if (this.tty) {
			process.stderr.write('\r\x1b[2K' + line);
		} else if (
			n === this.total ||
			n - this.lastPrintedN >= Math.max(1, Math.ceil(this.total / 20))
		) {
			process.stderr.write(line + '\n');
			this.lastPrintedN = n;
		}
	}
	finish() {
		if (this.tty) process.stderr.write('\n');
	}
}

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
			case '--height':
				out.height = parseInt(next(), 10);
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
			case '--verbose':
			case '-v':
				out.verbose = true;
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
		'  --height <n>           video height (default: width * 9/16 — i.e. 16:9 aspect)',
		'  --fps <n>              frame rate (default 30)',
		'  --crf <n>              x264 CRF, lower = higher quality (default 18)',
		'  --preset <name>        x264 preset (default "slow")',
		'  --frame-timeout <ms>   per-frame settle timeout (default 60000)',
		'  --no-prewarm           skip the initial trajectory walk that pre-fills tile cache',
		'  --output <path>        output MP4 (required)',
		'  -v, --verbose          show ffmpeg output and page console messages',
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
		'-loglevel',
		VERBOSE ? 'info' : 'error',
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
	// Capture stderr so we can show it only on failure (when not verbose).
	const proc = spawn('ffmpeg', args, {
		stdio: ['pipe', 'inherit', VERBOSE ? 'inherit' : 'pipe']
	});
	let stderrBuf = '';
	if (proc.stderr) proc.stderr.on('data', (chunk) => (stderrBuf += chunk.toString()));
	// Suppress the unhandled `error` event on stdin so that EPIPE (which
	// fires when ffmpeg has already died before consuming all PNG frames)
	// doesn't crash the renderer with a stack trace. We surface the real
	// cause — ffmpeg's exit code + captured stderr — via the exit promise
	// instead. Without this listener Node throws synchronously on the first
	// `.write()` after ffmpeg goes away, masking the underlying ffmpeg error.
	proc.stdin.on('error', () => {});
	const exit = new Promise((res, rej) => {
		proc.on('exit', (code) => {
			if (code === 0) return res(undefined);
			if (stderrBuf) process.stderr.write(stderrBuf);
			rej(new Error(`ffmpeg exit ${code}`));
		});
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
	const height = opts.height ?? Math.round((opts.width * 9) / 16);
	const ctx = await browser.newContext({ viewport: { width: opts.width, height } });
	const page = await ctx.newPage();
	// Real exceptions in the page bubble up; non-fatal warnings (font glyph
	// 404s, MapLibre router warnings, …) only show with --verbose.
	page.on('pageerror', (e) => log(`page error: ${e.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error') debug(`page console.error: ${msg.text()}`);
	});
	const url = buildPageUrl(opts.siteUrl, hash, true);
	debug(`navigating to ${url}`);
	await page.goto(url, { waitUntil: 'load' });
	// Cold containers with software WebGL + uncached satellite/DEM tiles can
	// easily take longer than 30s to reach `map.on('load')`. Be generous; the
	// caller can shorten with --frame-timeout if they want stricter behaviour.
	const setupTimeout = Math.max(opts.frameTimeoutMs, 120_000);
	try {
		await page.waitForFunction(
			() => /** @type {any} */ (window).__renderer && /** @type {any} */ (window).__map,
			{ timeout: setupTimeout }
		);
	} catch (err) {
		const has = await page.evaluate(() => ({
			renderer: !!(/** @type {any} */ (window).__renderer),
			map: !!(/** @type {any} */ (window).__map),
			href: window.location.href
		}));
		throw new Error(
			`setup timed out after ${Math.round(setupTimeout / 1000)}s ` +
				`(renderer=${has.renderer}, map=${has.map}). ` +
				`URL: ${has.href}. ` +
				`Re-run with --verbose to see page console output, or pass a larger --frame-timeout.`,
			{ cause: err }
		);
	}
	await waitForFrameReady(page, setupTimeout);
	const duration = await page.evaluate(() => /** @type {any} */ (window).__renderer.duration);
	return { ctx, page, duration };
}

async function prewarmPass(page, duration, opts) {
	// 2 fps: each step covers a bigger camera jump, so the cache fills in
	// fewer settle-waits than a finer-grained walk would need. Tiles for
	// intermediate positions get fetched implicitly when the capture pass
	// (or the next prewarm step) requires them.
	const fps = 2;
	const total = Math.max(2, Math.ceil(duration * fps) + 1);
	const progress = new Progress(total, 'warming tile cache');
	for (let i = 0; i < total; i++) {
		const t = Math.min(duration, i / fps);
		await page.evaluate((t) => /** @type {any} */ (window).__renderer.seekTo(t), t);
		try {
			await waitForFrameReady(page, opts.frameTimeoutMs);
		} catch {
			debug(`prewarm frame ${i} timeout, continuing`);
		}
		progress.update(i + 1);
	}
	progress.finish();
}

async function capturePass(page, duration, opts, ffmpegStdin) {
	const total = Math.max(2, Math.ceil(duration * opts.fps) + 1);

	// No virtual clock here. Earlier versions installed `page.clock` to keep
	// MapLibre's internal animations (label fades, tile fades) on animation
	// time rather than wall-clock time, but that broke the post-network
	// repaint chain — tile fetches resolve in real time, schedule a new rAF,
	// and that rAF gets stuck in the controlled queue until the next
	// `pauseAt`, by which point `waitForFrameReady` has already timed out.
	//
	// We don't actually need virtual time, because `waitForFrameReady` waits
	// for `map.on('idle')` *before* each screenshot — at idle, every
	// MapLibre-internal animation has settled to its end state, regardless
	// of how long real wall-clock time it took to get there. Our annotation
	// fades use `store.currentTime` (the animation timeline, not the system
	// clock), and the camera is set with direct jumps, so wall-clock leakage
	// has no visible effect on the captured frames.
	const progress = new Progress(total, 'rendering frames');
	for (let i = 0; i < total; i++) {
		// If ffmpeg has died, bail out instead of looping through all 700+
		// remaining frames writing PNGs into a dead pipe. The exit promise
		// (awaited just below in main) will surface the real ffmpeg error.
		if (!ffmpegStdin.writable || ffmpegStdin.destroyed) {
			progress.finish();
			throw new Error(`ffmpeg pipe closed early (after frame ${i})`);
		}
		const t = Math.min(duration, i / opts.fps);
		await page.evaluate((t) => /** @type {any} */ (window).__renderer.seekTo(t), t);
		try {
			await waitForFrameReady(page, opts.frameTimeoutMs);
		} catch (err) {
			log(`! frame ${i + 1}/${total} timeout (t=${t.toFixed(3)}): ${err.message}`);
		}
		const png = await page.screenshot({ type: 'png' });
		ffmpegStdin.write(png);
		progress.update(i + 1);
	}
	progress.finish();
	ffmpegStdin.end();
}

async function main() {
	const opts = parseArgv(process.argv.slice(2));
	if (opts.help) {
		process.stdout.write(usage());
		return;
	}
	VERBOSE = !!opts.verbose;
	if (!ALLOWED_WIDTHS.includes(opts.width)) {
		throw new Error(`--width must be one of ${ALLOWED_WIDTHS.join('/')}, got ${opts.width}`);
	}
	if (!opts.output) throw new Error('--output is required');
	if (!opts.hash && !opts.url) throw new Error('--hash or --url is required');
	const hash = extractHash(opts.url) ?? opts.hash;
	if (!hash) throw new Error('could not extract hash from --url');

	const outAbs = isAbsolute(opts.output) ? opts.output : resolve(process.cwd(), opts.output);
	await mkdir(dirname(outAbs), { recursive: true });
	opts.output = outAbs;

	let server = null;
	if (!opts.siteUrl) {
		const root = opts.siteRoot ?? defaultSiteRoot();
		server = await spawnStaticServer(root);
		opts.siteUrl = server.url;
		debug(`serving ${root} on ${server.url}`);
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
		log('preparing renderer…');
		const { ctx, page, duration } = await setupPage(browser, opts, hash);
		const cappedDuration = opts.endTime != null ? Math.min(duration, opts.endTime) : duration;
		const totalFrames = Math.max(2, Math.ceil(cappedDuration * opts.fps) + 1);
		const height = opts.height ?? Math.round((opts.width * 9) / 16);
		log(
			`  ${cappedDuration.toFixed(2)}s · ${totalFrames} frames at ${opts.fps} fps · ${opts.width}×${height}` +
				(opts.endTime != null ? ` (capped from ${duration.toFixed(2)}s)` : '')
		);

		if (opts.prewarm) {
			await prewarmPass(page, cappedDuration, opts);
		}

		const { proc, exit } = spawnFfmpeg(opts);
		await capturePass(page, cappedDuration, opts, proc.stdin);
		log('encoding video…');
		await exit;

		const { size } = await stat(opts.output);
		log(`done · ${opts.output} (${fmtBytes(size)})`);
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
