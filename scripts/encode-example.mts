/**
 * Encode one of the editor's examples (`src/lib/examples/*.json`) to the
 * base64-url hash format that the embed iframe consumes, and print it to
 * stdout. Run with:
 *
 *     npx tsx scripts/encode-example.mts            # the Corsica example
 *     npx tsx scripts/encode-example.mts alps       # another one, by file name
 *
 * The output is the value that goes after `view#kf=` in `static/embed-demo.html`
 * (and in any `<iframe src="…">` snippet generated from the example). Whenever
 * the example changes, re-run this script and paste the new hash into the
 * demo file.
 *
 * `Animation.defaultAnnotation` is now preserved on the wire (options
 * bit 2), so the encoded hash carries the per-animation style template
 * alongside thin annotations — no pre-baking needed.
 */

import { readFileSync } from 'node:fs';
import { validateAnimation } from '../src/lib/json_io.ts';
import { decodeAnimation, encodeAnimation } from '../src/lib/url_state/index.ts';

// Read straight from the folder: `src/lib/examples/index.ts` collects the
// files with a Vite feature that is not there when this runs under tsx.
const name = process.argv[2] ?? 'corsica';
const file = new URL(`../src/lib/examples/${name}.json`, import.meta.url);
const animation = validateAnimation(JSON.parse(readFileSync(file, 'utf8')));

const hash = encodeAnimation(animation);
console.log('--- HASH (paste after `view#kf=` in static/embed-demo.html) ---');
console.log(hash);
console.log();
console.log('--- LENGTH ---');
console.log(hash.length, 'chars');
console.log();
console.log('--- ROUND-TRIP CHECK ---');
const decoded = decodeAnimation(hash);
console.log('decoded keyframes:', decoded?.keyframes.length);
console.log('decoded annotations:', decoded?.annotations.length);
console.log('decoded defaultAnnotation:', JSON.stringify(decoded?.defaultAnnotation, null, 2));
console.log('first annotation:', JSON.stringify(decoded?.annotations[0], null, 2));
