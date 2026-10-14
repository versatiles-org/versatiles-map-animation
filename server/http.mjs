/**
 * The small pieces of HTTP the server needs and Node.js leaves to us:
 * cookies, request bodies, and files sent in full or in byte ranges (which
 * Safari needs to play a video at all).
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

export const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.mp4': 'video/mp4',
	'.mov': 'video/quicktime',
	'.mkv': 'video/x-matroska'
};

/** The cookies of a request, as name → value. */
export function parseCookies(header) {
	/** @type {Record<string, string>} */
	const cookies = {};
	for (const part of String(header ?? '').split(';')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		const name = part.slice(0, eq).trim();
		if (!name) continue;
		try {
			cookies[name] = decodeURIComponent(part.slice(eq + 1).trim());
		} catch {
			cookies[name] = part.slice(eq + 1).trim();
		}
	}
	return cookies;
}

/** The body of a request as text; at most `limit` bytes, or an error with `status` 413. */
export function readBody(req, limit = 1_000_000) {
	return new Promise((resolve, reject) => {
		let size = 0;
		/** @type {Buffer[]} */
		const chunks = [];
		req.on('data', (/** @type {Buffer} */ chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(Object.assign(new Error('Request too large'), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

export function sendJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		'Content-Type': MIME['.json'],
		'Content-Length': Buffer.byteLength(body),
		'Cache-Control': 'no-store'
	});
	res.end(body);
}

export function sendText(res, status, text) {
	res.writeHead(status, {
		'Content-Type': MIME['.txt'],
		'Content-Length': Buffer.byteLength(text)
	});
	res.end(text);
}

export function redirect(res, location, headers = {}) {
	res.writeHead(303, { Location: location, ...headers });
	res.end();
}

/**
 * The byte range a `Range` header asks for in a file of `size` bytes:
 * `{ start, end }` (both inclusive), `null` for none or one we ignore (the
 * whole file is sent then), or `'unsatisfiable'`.
 */
export function parseRange(header, size) {
	const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
	if (!m || (m[1] === '' && m[2] === '')) return null;
	let start;
	let end;
	if (m[1] === '') {
		// The last n bytes.
		start = Math.max(0, size - Number(m[2]));
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
	}
	if (start >= size || start > end) return 'unsatisfiable';
	return { start, end };
}

/**
 * Send a file, or the part of it a `Range` header asks for. `download` is
 * the name to save it as; without, the browser shows it. Resolves `false`
 * if there is no such file.
 */
export async function sendFile(req, res, path, { download, cache = 'private, max-age=3600' } = {}) {
	let info;
	try {
		info = await stat(path);
	} catch {
		return false;
	}
	if (!info.isFile()) return false;
	const headers = {
		'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
		'Accept-Ranges': 'bytes',
		'Last-Modified': info.mtime.toUTCString(),
		'Cache-Control': cache,
		...(download && {
			'Content-Disposition': `attachment; filename="${download.replace(/[^\w.-]/g, '_')}"`
		})
	};
	const range = parseRange(req.headers.range, info.size);
	if (range === 'unsatisfiable') {
		res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
		res.end();
		return true;
	}
	const { start, end } = range ?? { start: 0, end: info.size - 1 };
	res.writeHead(range ? 206 : 200, {
		...headers,
		'Content-Length': info.size === 0 ? 0 : end - start + 1,
		...(range && { 'Content-Range': `bytes ${start}-${end}/${info.size}` })
	});
	if (req.method === 'HEAD' || info.size === 0) {
		res.end();
		return true;
	}
	await new Promise((resolve) => {
		const stream = createReadStream(path, { start, end });
		stream.on('error', () => res.destroy());
		res.on('close', () => {
			stream.destroy();
			resolve(undefined);
		});
		stream.pipe(res);
	});
	return true;
}
