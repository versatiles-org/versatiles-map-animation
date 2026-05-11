/**
 * Shared helpers used by the three annotation-panel sub-components
 * (`MarkerList`, `MarkerEditor`, `DefaultStyleEditor`). Pure functions and
 * one-shot constants — no state, no Svelte runes — so this can live in a
 * plain `.ts` and import cheaply from each.
 */

import {
	ANNOTATION_LABEL_FONTS,
	DEFAULT_ANNOTATION_COLOR,
	fontFamilyOf,
	fontVariantLabel,
	type Annotation,
	type AnnotationLabelFont,
	type LabelPosition
} from './types';

export { fontVariantLabel };

/** Strip the `symbol-` / `icon-` prefix from a sprite id for UI display. */
export function shortName(icon: string): string {
	return icon.replace(/^symbol-/, '').replace(/^icon-/, '');
}

/**
 * Pick a halo colour with the opposite brightness so the label stays
 * legible regardless of the user's chosen text color. Mirrors `MapStage`
 * so the picker preview matches what the map actually renders.
 */
export function haloAuto(hex: string): string {
	const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return '#ffffff';
	const n = parseInt(m[1], 16);
	const r = (n >> 16) & 0xff;
	const g = (n >> 8) & 0xff;
	const b = n & 0xff;
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return lum > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Coerce a CSS hex string to the strict `#rrggbb` form `<input type="color">`
 * requires. Falls back to the default annotation colour rather than snapping
 * the picker to black on garbage input.
 */
export function normalizeHex(c: string): string {
	const six = /^#([0-9a-fA-F]{6})$/.exec(c.trim());
	if (six) return '#' + six[1].toLowerCase();
	const three = /^#([0-9a-fA-F]{3})$/.exec(c.trim());
	if (three) {
		const [r, g, b] = three[1];
		return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
	}
	return DEFAULT_ANNOTATION_COLOR;
}

/**
 * Generic field binders parameterised by the patch target — the sub-component
 * supplies a `doPatch` (which may write to a selected annotation OR to the
 * default-style block) and the returned helpers produce per-field handlers.
 */
export function makeOnText(doPatch: (p: Partial<Annotation>) => void) {
	return <K extends keyof Annotation>(key: K) =>
		(e: Event) =>
			doPatch({ [key]: (e.currentTarget as HTMLInputElement).value } as Partial<Annotation>);
}
export function makeOnNum(doPatch: (p: Partial<Annotation>) => void) {
	return <K extends keyof Annotation>(key: K) =>
		(e: Event) =>
			doPatch({
				[key]: Number((e.currentTarget as HTMLInputElement).value)
			} as Partial<Annotation>);
}

/**
 * 3×3 grid of label-position options. The dot in the center represents the
 * icon; each surrounding slot is one cardinal/diagonal placement.
 */
export const POSITION_GRID: { label: string; value: LabelPosition }[] = [
	{ label: '↖', value: 'top-left' },
	{ label: '↑', value: 'top' },
	{ label: '↗', value: 'top-right' },
	{ label: '←', value: 'left' },
	{ label: '·', value: 'center' },
	{ label: '→', value: 'right' },
	{ label: '↙', value: 'bottom-left' },
	{ label: '↓', value: 'bottom' },
	{ label: '↘', value: 'bottom-right' }
];

/**
 * Group all 187 fonts by family for the `<optgroup>`-based `<select>`. The
 * upstream font list interleaves families lexicographically, so we collect
 * by family into a plain object and preserve first-encounter family order.
 */
export const FONT_GROUPS: { family: string; fonts: AnnotationLabelFont[] }[] = (() => {
	const order: string[] = [];
	const byFamily: Record<string, AnnotationLabelFont[]> = {};
	for (const f of ANNOTATION_LABEL_FONTS) {
		const fam = fontFamilyOf(f);
		if (!(fam in byFamily)) {
			byFamily[fam] = [];
			order.push(fam);
		}
		byFamily[fam].push(f);
	}
	return order.map((family) => ({ family, fonts: byFamily[family] }));
})();

/** Title-case a font family identifier (`fira_sans_condensed` → `Fira Sans Condensed`). */
export function familyLabel(family: string): string {
	return family
		.split('_')
		.map((s) => s[0].toUpperCase() + s.slice(1))
		.join(' ');
}
