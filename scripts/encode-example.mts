/**
 * Encode the editor's built-in `EXAMPLE_ANIMATION` to the base64-url hash
 * format that the embed iframe consumes, and print it to stdout. Run with:
 *
 *     npx tsx scripts/encode-example.mts
 *
 * The output is the value that goes after `view#kf=` in `static/embed-demo.html`
 * (and in any `<iframe src="…">` snippet generated from the example). Whenever
 * the example changes, re-run this script and paste the new hash into the
 * demo file.
 *
 * `Animation.defaultAnnotation` is now preserved on the wire (V1 options
 * bit 2), so the encoded hash carries the per-animation style template
 * alongside thin annotations — no pre-baking needed.
 */

import { EXAMPLE_ANIMATION } from '../src/lib/example_animation.ts';
import { decodeAnimation, encodeAnimation } from '../src/lib/url_state/index.ts';

const hash = encodeAnimation(EXAMPLE_ANIMATION);
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
