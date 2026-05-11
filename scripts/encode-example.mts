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
 * The URL codec doesn't preserve `Animation.defaultAnnotation` yet (UX-only
 * feature; see the comment in `src/lib/url_state/index.ts`), so we bake the
 * per-animation defaults into each annotation before encoding. The embedded
 * version then renders with the intended style even though the wire format
 * drops the template.
 */

import { EXAMPLE_ANIMATION } from '../src/lib/example_animation.ts';
import { decodeAnimation, encodeAnimation } from '../src/lib/url_state/index.ts';
import {
	ANNOTATION_FIELD_DEFAULTS,
	type Annotation,
	type AnnotationStyle
} from '../src/lib/types.ts';

/**
 * Inline copy of `resolveAnnotation` so this script doesn't pull in
 * `animation.svelte.ts` (which depends on Svelte's `$state` runtime). Keep
 * in sync with the canonical version there.
 */
function resolveAnnotation(ann: Annotation, defaults: Partial<AnnotationStyle>): Annotation {
	const out: Record<string, unknown> = { ...ANNOTATION_FIELD_DEFAULTS };
	for (const k in defaults) {
		const v = (defaults as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	for (const k in ann) {
		const v = (ann as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	return out as Annotation;
}

const baked: typeof EXAMPLE_ANIMATION = {
	...EXAMPLE_ANIMATION,
	annotations: EXAMPLE_ANIMATION.annotations.map((a) =>
		resolveAnnotation(a, EXAMPLE_ANIMATION.defaultAnnotation)
	),
	defaultAnnotation: {}
};

const hash = encodeAnimation(baked);
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
console.log('first annotation:', JSON.stringify(decoded?.annotations[0], null, 2));
