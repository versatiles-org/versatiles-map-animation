/**
 * Decode a URL-hash payload and print a bit-cost tree.
 *
 * Usage:
 *   npm run inspect -- '<hash>'
 *   npm run inspect -- '<full-url-with-hash>'
 *   echo '<hash>' | npm run inspect
 *
 * Examples:
 *   npm run inspect -- 'AVYwwcnDgAOpi_xtYMyLSDIWRAFfkF3ALuNzC9wkRcDawXcA'
 *   npm run inspect -- 'http://localhost:5173/#kf=AVYw...'
 */
import { base64UrlToBytes, formatInspection } from '../src/lib/codec.ts';
import { decodeAnimation, inspectAnimation } from '../src/lib/url_state.ts';

function extractHash(input: string): string {
	const trimmed = input.trim();
	// Accept a full URL (with #kf=...).
	const hashIdx = trimmed.indexOf('#');
	if (hashIdx >= 0) {
		const hash = trimmed.slice(hashIdx + 1);
		const params = new URLSearchParams(hash);
		const v = params.get('kf');
		if (v) return v;
		// Or just `#<value>` without the `kf=` prefix.
		return hash;
	}
	// Or a `kf=...` query-style fragment.
	if (trimmed.startsWith('kf=')) return trimmed.slice(3);
	return trimmed;
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function main() {
	let raw: string | undefined;
	if (process.argv.length > 2) {
		raw = process.argv.slice(2).join(' ');
	} else if (!process.stdin.isTTY) {
		raw = await readStdin();
	}
	if (!raw) {
		console.error(
			'Usage: npm run inspect -- <hash-or-url>\n' + '   or: echo <hash> | npm run inspect'
		);
		process.exit(1);
	}

	const hash = extractHash(raw);
	const anim = decodeAnimation(hash);
	if (!anim) {
		// Diagnose: peek at the first byte so the user can see why.
		try {
			const bytes = base64UrlToBytes(hash);
			const tag = bytes[0];
			const firstHex = Array.from(bytes.slice(0, 8))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join(' ');
			console.error(
				`Could not decode hash (length=${hash.length}, ${bytes.length} bytes, tag=0x${tag.toString(16)})\n` +
					`first bytes: ${firstHex}`
			);
		} catch (err) {
			console.error(`Could not decode hash (length=${hash.length}): ${(err as Error).message}`);
		}
		process.exit(1);
	}

	const tree = inspectAnimation(anim);

	const url = `https://example.invalid/#kf=${hash}`;
	console.log(`encoded length : ${hash.length} chars`);
	console.log(`URL example    : ${url.length} chars total`);
	console.log(`keyframes      : ${anim.keyframes.length}`);
	console.log(`style          : ${anim.style}`);
	console.log(`terrain        : ${anim.terrain}`);
	console.log('');
	console.log(formatInspection(tree));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
