// @ts-check
/**
 * Offline renderer for versatiles-map-animation.
 *
 * Drives the static /view page frame-by-frame in headless Chromium with
 * software-WebGL (SwiftShader), captures each frame as PNG, and pipes the
 * stream into ffmpeg, which encodes it in the chosen format (see
 * `formats.mjs`; H.264 in MP4 by default). A virtual clock (Playwright's
 * page.clock) keeps MapLibre's internal animations (label fades, transitions)
 * synchronised with the keyframe playhead so per-frame settle time is
 * decoupled from animation time.
 *
 * Usage:
 *   node render.mjs --hash <code>           --output out.mp4
 *   node render.mjs --url 'https://…#kf=…'  --output out.mp4
 *   node render.mjs --hash AVYw… --width 1920 --fps 30 --quality high --output out.mp4
 *   node render.mjs --hash AVYw… --format ffv1 --output out.mkv
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import {
	DEFAULT_FORMAT,
	DEFAULT_PRESET,
	DEFAULT_QUALITY,
	encodingArgs,
	FORMATS,
	QUALITIES,
	validateEncoding
} from './formats.mjs';
import {
	chromiumArgs,
	isSoftwareRenderer,
	lacksGpuDrivers,
	noGpuDriversMessage,
	noGpuMessage
} from './gpu.mjs';

const ALLOWED_WIDTHS = [640, 1280, 1920, 3840];
const DEFAULT_OPTS = {
	width: 1280,
	// Optional explicit pixel height. When omitted, defaults to width * 9/16
	// (legacy 16:9 behaviour). The editor always passes both `--width` and
	// `--height` derived from the chosen composition aspect ratio.
	height: null,
	fps: 30,
	// Output format and, for `mp4`, its quality — see `formats.mjs`. `crf`
	// and `preset` are the expert overrides of `quality`; `null` = not given.
	format: DEFAULT_FORMAT,
	quality: undefined,
	crf: null,
	preset: null,
	// Draw WebGL on a GPU instead of in software — see `gpu.mjs`.
	gpu: false,
	frameTimeoutMs: 30_000,
	prewarm: true,
	endTime: null,
	verbose: false,
	// Motion blur: render `motionBlur` sub-frames per output frame and let
	// ffmpeg average them together. 1 = off (current crisp behaviour). 4–8
	// typical. Render time scales linearly: --motion-blur 8 is 8× slower.
	motionBlur: 1,
	// Shutter angle in degrees: how much of one output-frame's duration
	// the simulated shutter is open for. 180° is the classic cinematic
	// shutter (sub-frames span half a frame interval; the other half is a
	// dark inter-frame gap). 360° fills the entire frame interval (heavier
	// blur). Only meaningful when motionBlur > 1.
	shutterAngle: 180
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
			case '--format':
				out.format = next();
				break;
			case '--quality':
				out.quality = next();
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
			case '--motion-blur':
				out.motionBlur = parseInt(next(), 10);
				break;
			case '--shutter-angle':
				out.shutterAngle = parseFloat(next());
				break;
			case '--end-time':
				out.endTime = parseFloat(next());
				break;
			case '--gpu':
				out.gpu = true;
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
		'  --format <name>        output format (default "' + DEFAULT_FORMAT + '"):',
		...Object.entries(FORMATS).map(
			([name, f]) => `                           ${name.padEnd(10)} ${f.extension}  ${f.summary}`
		),
		'  --quality <level>      for --format mp4: ' +
			Object.entries(QUALITIES)
				.map(([name, crf]) => `${name} (CRF ${crf})`)
				.join(', ') +
			`; default ${DEFAULT_QUALITY}`,
		'  --crf <n>              for --format mp4: exact x264 CRF instead of --quality,',
		'                          0..51, lower = higher quality',
		`  --preset <name>        for --format mp4: x264 preset (default "${DEFAULT_PRESET}")`,
		'  --frame-timeout <ms>   per-frame settle timeout (default 30000)',
		'  --motion-blur <n>      render N sub-frames per output frame and average them',
		'                          for accumulation-buffer motion blur. 1 (default) = off,',
		'                          4–8 typical. Render time scales N× per frame.',
		'  --shutter-angle <deg>  shutter angle for motion blur (default 180 — cinematic).',
		'                          180° spans half a frame duration; 360° spans the whole.',
		'                          Only meaningful with --motion-blur > 1.',
		'  --gpu                  draw on a GPU instead of in software — several times faster.',
		'                          In Docker on Linux, start the container with access to it:',
		'                          `--gpus all` (NVIDIA) or `--device /dev/dri` (Intel, AMD).',
		'  --no-prewarm           skip the initial trajectory walk that pre-fills tile cache',
		'  --output <path>        output file (required); its ending has to match the format',
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
	// With motion blur, we stream N sub-frames per output frame at `fps × N`
	// and ffmpeg averages them — see `motionBlurFilters` in formats.mjs.
	const samples = Math.max(1, opts.motionBlur);
	const args = [
		'-y',
		'-loglevel',
		VERBOSE ? 'info' : 'error',
		'-f',
		'image2pipe',
		'-framerate',
		String(opts.fps * samples),
		'-i',
		'pipe:0',
		...encodingArgs(opts),
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
	let timer;
	try {
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
			new Promise((_res, rej) => {
				timer = setTimeout(
					() => rej(new Error(`frame settle timeout after ${timeoutMs}ms`)),
					timeoutMs
				);
			})
		]);
	} finally {
		// A timer left running keeps the process alive: without this the
		// renderer sat idle for up to two minutes after "done".
		clearTimeout(timer);
	}
}

/**
 * Find out which renderer WebGL really ended up on, before anything else is
 * loaded. Asking for a GPU is not the same as getting one: without a usable
 * driver the browser draws in software after all, several times slower, or
 * does not get WebGL going at all and the map would never appear. Either
 * way it is better to stop here with an explanation than to let a render
 * crawl or hang.
 */
async function checkWebglRenderer(browser, opts) {
	const page = await browser.newPage();
	const probe = page.evaluate(() => {
		const gl = document.createElement('canvas').getContext('webgl2');
		if (!gl) return null;
		const info = gl.getExtension('WEBGL_debug_renderer_info');
		return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
	});
	let timer;
	const renderer = await Promise.race([
		probe.catch(() => null),
		new Promise((res) => {
			timer = setTimeout(() => res(null), 20_000);
		})
	]);
	clearTimeout(timer);
	// A browser stuck on a broken graphics stack may not close a page either.
	page.close().catch(() => {});
	if (!opts.gpu) {
		debug(`WebGL renderer: ${renderer}`);
		return;
	}
	if (isSoftwareRenderer(renderer)) {
		throw new Error(noGpuMessage(renderer, { inContainer: existsSync('/.dockerenv') }));
	}
	log(`  drawing on the GPU: ${renderer}`);
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

/**
 * Returns a function that captures the page as a PNG buffer.
 *
 * Playwright's `page.screenshot()` compresses the PNG as small as it can,
 * which for a full-HD satellite frame costs more time than drawing it on a
 * GPU. The PNGs here only live for the moment it takes to pipe them into
 * ffmpeg, so their size does not matter: Chromium's `optimizeForSpeed`
 * writes the same pixels with light compression in less than half the
 * time. That switch is only reachable through the DevTools protocol; if a
 * browser does not offer it, capturing falls back to `page.screenshot()`.
 */
async function createCapturer(page) {
	const slow = () => page.screenshot({ type: 'png' });
	let cdp;
	try {
		cdp = await page.context().newCDPSession(page);
	} catch (err) {
		debug(`fast capture unavailable (${err.message}), using page.screenshot`);
		return slow;
	}
	let fast = true;
	return async () => {
		if (fast) {
			try {
				const { data } = await cdp.send('Page.captureScreenshot', {
					format: 'png',
					optimizeForSpeed: true
				});
				return Buffer.from(data, 'base64');
			} catch (err) {
				fast = false;
				debug(`fast capture failed (${err.message}), using page.screenshot`);
			}
		}
		return slow();
	};
}

async function capturePass(page, duration, opts, ffmpegStdin) {
	const total = Math.max(2, Math.round(duration * opts.fps));

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
	// With motion blur, each output frame is built from `samples` sub-frames
	// evenly spaced across one shutter-open window. ffmpeg averages them
	// back together (see `spawnFfmpeg`). samples=1 means a single
	// instantaneous capture per output frame (current crisp default).
	//
	// `shutterRatio` is the fraction of one output-frame duration that the
	// simulated shutter is open. 0.5 = 180° (classic cinematic, half-open
	// half-closed); 1.0 = 360° (open the whole interval). Sub-frames are
	// distributed across [t_i, t_i + shutterRatio/fps).
	const samples = Math.max(1, opts.motionBlur);
	const shutterRatio = opts.shutterAngle / 360;
	const progress = new Progress(total, 'rendering frames');
	// Where the time of this pass goes, for the summary printed at the end:
	// drawing (seek + wait until the map has settled) and capturing (the
	// screenshot: read-back, PNG encoding, transfer from the browser).
	const timing = { drawMs: 0, captureMs: 0, captures: 0, pngBytes: 0 };
	const capture = await createCapturer(page);
	for (let i = 0; i < total; i++) {
		// If ffmpeg has died, bail out instead of looping through all 700+
		// remaining frames writing PNGs into a dead pipe. The exit promise
		// (awaited just below in main) will surface the real ffmpeg error.
		if (!ffmpegStdin.writable || ffmpegStdin.destroyed) {
			progress.finish();
			throw new Error(`ffmpeg pipe closed early (after frame ${i})`);
		}
		for (let j = 0; j < samples; j++) {
			// Sub-frame offset inside one shutter-open window. samples=1
			// degenerates to t = i / fps (the original behaviour).
			const t = Math.min(duration, (i + (j * shutterRatio) / samples) / opts.fps);
			const drawStart = performance.now();
			await page.evaluate((t) => /** @type {any} */ (window).__renderer.seekTo(t), t);
			try {
				await waitForFrameReady(page, opts.frameTimeoutMs);
			} catch (err) {
				const label =
					samples > 1
						? `frame ${i + 1}/${total} (sub ${j + 1}/${samples})`
						: `frame ${i + 1}/${total}`;
				log(`! ${label} timeout (t=${t.toFixed(3)}): ${err.message}`);
			}
			const captureStart = performance.now();
			const png = await capture();
			timing.drawMs += captureStart - drawStart;
			timing.captureMs += performance.now() - captureStart;
			timing.captures++;
			timing.pngBytes += png.length;
			ffmpegStdin.write(png);
		}
		progress.update(i + 1);
	}
	progress.finish();
	ffmpegStdin.end();
	return timing;
}

/**
 * One line per phase: how long it took, its share of the whole run, and
 * for the per-frame phases the average per captured frame. This is what
 * tells whether a faster GPU, a faster capture path or a faster encoder
 * preset would actually help.
 */
function logTiming(phases, totalMs, timing) {
	log('timing:');
	for (const [label, ms, perCapture] of phases) {
		const share = `${Math.round((ms / totalMs) * 100)}%`.padStart(4);
		const each =
			perCapture && timing.captures > 0
				? `  (${(ms / timing.captures).toFixed(0)} ms per frame)`
				: '';
		log(`  ${label.padEnd(26)} ${(ms / 1000).toFixed(1).padStart(7)} s ${share}${each}`);
	}
	log(`  ${'total'.padEnd(26)} ${(totalMs / 1000).toFixed(1).padStart(7)} s`);
	if (timing.captures > 0) {
		log(
			`  ${timing.captures} frames captured, ${fmtBytes(timing.pngBytes / timing.captures)} per PNG on average`
		);
	}
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
	if (!Number.isInteger(opts.motionBlur) || opts.motionBlur < 1 || opts.motionBlur > 32) {
		throw new Error(`--motion-blur must be an integer in 1..32, got ${opts.motionBlur}`);
	}
	if (!Number.isFinite(opts.shutterAngle) || opts.shutterAngle <= 0 || opts.shutterAngle > 360) {
		throw new Error(`--shutter-angle must be a number in (0, 360], got ${opts.shutterAngle}`);
	}
	if (!opts.output) throw new Error('--output is required');
	validateEncoding(opts);
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

	if (opts.gpu && lacksGpuDrivers()) throw new Error(noGpuDriversMessage());
	const browser = await chromium.launch({ args: chromiumArgs({ gpu: opts.gpu }) });

	try {
		log('preparing renderer…');
		const startedAt = performance.now();
		await checkWebglRenderer(browser, opts);
		const { ctx, page, duration } = await setupPage(browser, opts, hash);
		const setupMs = performance.now() - startedAt;

		const cappedDuration = opts.endTime != null ? Math.min(duration, opts.endTime) : duration;
		const totalFrames = Math.max(2, Math.ceil(cappedDuration * opts.fps) + 1);
		const height = opts.height ?? Math.round((opts.width * 9) / 16);
		log(
			`  ${cappedDuration.toFixed(2)}s · ${totalFrames} frames at ${opts.fps} fps · ${opts.width}×${height}` +
				(opts.motionBlur > 1
					? ` · motion blur ${opts.motionBlur}× @ ${opts.shutterAngle}° shutter ` +
						`(${totalFrames * opts.motionBlur} sub-frames)`
					: '') +
				(opts.endTime != null ? ` (capped from ${duration.toFixed(2)}s)` : '')
		);

		const prewarmStart = performance.now();
		if (opts.prewarm) {
			await prewarmPass(page, cappedDuration, opts);
		}
		const prewarmMs = performance.now() - prewarmStart;

		const { proc, exit } = spawnFfmpeg(opts);
		const timing = await capturePass(page, cappedDuration, opts, proc.stdin);
		log('encoding video…');
		const encodeStart = performance.now();
		await exit;
		// ffmpeg encodes while frames are still being captured, so only what
		// is left over after the last frame shows up as its own phase.
		const encodeMs = performance.now() - encodeStart;
		logTiming(
			[
				['loading the page', setupMs, false],
				['warming the tile cache', prewarmMs, false],
				['drawing frames', timing.drawMs, true],
				['capturing frames', timing.captureMs, true],
				['encoding after last frame', encodeMs, false]
			],
			performance.now() - startedAt,
			timing
		);

		const { size } = await stat(opts.output);
		log(`done · ${opts.output} (${fmtBytes(size)})`);
		await ctx.close();
	} finally {
		// With a broken graphics stack (`--gpu` without a GPU) the browser can
		// take forever to shut down; don't let that hold up the error message.
		let timer;
		await Promise.race([
			browser.close().catch(() => {}),
			new Promise((res) => {
				timer = setTimeout(res, 5000);
			})
		]);
		clearTimeout(timer);
		if (server) await server.close();
	}
}

main().catch((err) => {
	process.stderr.write(`[renderer] error: ${err.message}\n`);
	// The stack repeats the message; it only helps when debugging.
	if (VERBOSE && err.stack) process.stderr.write(err.stack + '\n');
	process.exit(1);
});
