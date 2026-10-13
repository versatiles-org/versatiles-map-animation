import { describe, expect, it } from 'vitest';
import {
	familyLabel,
	FONT_GROUPS,
	haloAuto,
	makeOnNum,
	makeOnText,
	normalizeHex,
	POSITION_GRID,
	shortName
} from './annotation_panel_helpers';
import { ANNOTATION_LABEL_FONTS, DEFAULT_ANNOTATION_COLOR, LABEL_POSITIONS } from './types';
import type { Annotation } from './types';

describe('shortName', () => {
	it('drops the sprite prefix', () => {
		expect(shortName('symbol-marker')).toBe('marker');
		expect(shortName('icon-airport')).toBe('airport');
		expect(shortName('plain')).toBe('plain');
	});
});

describe('haloAuto', () => {
	it('picks the opposite brightness', () => {
		expect(haloAuto('#ffffff')).toBe('#000000');
		expect(haloAuto('#FFEE00')).toBe('#000000');
		expect(haloAuto('#000000')).toBe('#ffffff');
		expect(haloAuto(' #cc0000 ')).toBe('#ffffff');
	});

	it('falls back to white for anything that is not #rrggbb', () => {
		for (const bad of ['', 'red', '#fff', '#12345g']) expect(haloAuto(bad)).toBe('#ffffff');
	});
});

describe('normalizeHex', () => {
	it('gives the #rrggbb form a colour input needs', () => {
		expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
		expect(normalizeHex(' #AbC ')).toBe('#aabbcc');
	});

	it('falls back to the default colour instead of black', () => {
		for (const bad of ['', 'blue', '#12', '#1234567', 'rgb(0,0,0)']) {
			expect(normalizeHex(bad)).toBe(DEFAULT_ANNOTATION_COLOR);
		}
	});
});

describe('field binders', () => {
	const event = (value: string) => ({ currentTarget: { value } }) as unknown as Event;

	it('patch the field with the text of the input', () => {
		const patches: Partial<Annotation>[] = [];
		const onText = makeOnText<Partial<Annotation>>((p) => patches.push(p));
		onText('label')(event('Zermatt'));
		expect(patches).toEqual([{ label: 'Zermatt' }]);
	});

	it('patch the field with the number of the input', () => {
		const patches: Partial<Annotation>[] = [];
		const onNum = makeOnNum<Partial<Annotation>>((p) => patches.push(p));
		onNum('iconSize')(event('1.5'));
		onNum('rotation')(event(''));
		expect(patches).toEqual([{ iconSize: 1.5 }, { rotation: 0 }]);
	});
});

describe('POSITION_GRID', () => {
	it('offers every label position once, the icon in the middle', () => {
		expect(POSITION_GRID).toHaveLength(9);
		expect(POSITION_GRID.map((p) => p.value).sort()).toEqual([...LABEL_POSITIONS].sort());
		expect(POSITION_GRID[4].value).toBe('center');
	});
});

describe('FONT_GROUPS', () => {
	it('holds every font once, grouped by family', () => {
		const all = FONT_GROUPS.flatMap((g) => g.fonts);
		expect([...all].sort()).toEqual([...ANNOTATION_LABEL_FONTS].sort());
		expect(new Set(FONT_GROUPS.map((g) => g.family)).size).toBe(FONT_GROUPS.length);
		for (const { family, fonts } of FONT_GROUPS) {
			for (const font of fonts) expect(font.startsWith(family)).toBe(true);
		}
	});

	it('names a family in title case', () => {
		expect(familyLabel('fira_sans_condensed')).toBe('Fira Sans Condensed');
		expect(familyLabel('lato')).toBe('Lato');
	});
});
